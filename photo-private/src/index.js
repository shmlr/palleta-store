import { createRemoteJWKSet, jwtVerify } from 'jose';
import { sameOrigin, imageType, isId } from './validation.js';

const MAX_IMAGE_BYTES = 6 * 1024 * 1024;
const CATEGORIES = new Set(['front', 'back', 'detail', 'weight']);
const DECISIONS = new Set(['approve', 'redo']);
const utf8 = new TextEncoder();

function reply(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      'content-type': 'application/json; charset=utf-8',
      'cache-control': 'private, no-store',
      'x-content-type-options': 'nosniff',
    },
  });
}

function fail(message, status = 400) {
  return reply({ error: message }, status);
}

const keysByDomain = new Map();

async function authenticated(request, env) {
  if (!env.TEAM_DOMAIN || !env.POLICY_AUD) throw new Error('ACCESS_NOT_CONFIGURED');
  const domain = env.TEAM_DOMAIN.replace(/^https?:\/\//, '').replace(/\/$/, '').toLowerCase();
  if (!/^[a-z0-9-]+\.cloudflareaccess\.com$/.test(domain)) throw new Error('ACCESS_NOT_CONFIGURED');
  const token = request.headers.get('Cf-Access-Jwt-Assertion');
  if (!token) return null;
  let jwks = keysByDomain.get(domain);
  if (!jwks) {
    jwks = createRemoteJWKSet(new URL('https://' + domain + '/cdn-cgi/access/certs'));
    keysByDomain.set(domain, jwks);
  }
  try {
    const { payload } = await jwtVerify(token, jwks, {
      issuer: 'https://' + domain,
      audience: env.POLICY_AUD,
      algorithms: ['RS256'],
    });
    const email = typeof payload.email === 'string' ? payload.email.trim().toLowerCase() : '';
    if (!email || email.length > 254) return null;
    const reviewers = new Set((env.REVIEWER_EMAILS || '').split(',').map(v => v.trim().toLowerCase()).filter(Boolean));
    return { email, role: reviewers.has(email) ? 'reviewer' : 'employee' };
  } catch {
    return null;
  }
}

async function readRecord(bucket, id) {
  const object = await bucket.get('submissions/' + id + '.json');
  if (!object) return null;
  try { return JSON.parse(await object.text()); } catch { return null; }
}

function canRead(user, record) {
  return user.role === 'reviewer' || record.employee === user.email;
}

async function listRecords(env, user) {
  let cursor = undefined;
  const keys = [];
  do {
    const page = await env.PHOTOS.list({ prefix: 'submissions/', cursor, limit: 500 });
    for (const obj of page.objects) keys.push(obj.key);
    if (keys.length >= 1500) break;
    cursor = page.truncated ? page.cursor : undefined;
  } while (cursor);
  const records = [];
  for (let i = 0; i < keys.length; i += 25) {
    const current = await Promise.all(keys.slice(i, i + 25).map(async k => {
      const id = k.slice('submissions/'.length).replace(/\.json$/, '');
      return isId(id) ? readRecord(env.PHOTOS, id) : null;
    }));
    for (const row of current) if (row && canRead(user, row)) records.push(row);
  }
  records.sort((a, b) => (b.createdAt || '').localeCompare(a.createdAt || ''));
  return { rows: records.slice(0, 300), limited: keys.length >= 1500 };
}

async function savePhoto(request, env, user) {
  const headerSize = Number(request.headers.get('content-length') || 0);
  if (headerSize > MAX_IMAGE_BYTES + 30000) return fail('Файл слишком большой', 413);
  if (!(request.headers.get('content-type') || '').includes('multipart/form-data')) return fail('Ожидается фотография', 415);
  const form = await request.formData();
  const file = form.get('photo');
  if (!file || typeof file.arrayBuffer !== 'function') return fail('Фотография отсутствует');
  if (!file.size || file.size > MAX_IMAGE_BYTES) return fail('Фотография должна быть не более 6 МБ', 413);
  const sku = String(form.get('sku') || '').trim();
  const product = String(form.get('product') || '').trim();
  const notes = String(form.get('notes') || '').trim();
  const type = String(form.get('kind') || 'front');
  if (!sku || sku.length > 80 || !/^[\p{L}\p{N}._\- ]+$/u.test(sku)) return fail('Нужен корректный код товара');
  if (!product || product.length > 200) return fail('Введите наименование');
  if (notes.length > 500) return fail('Комментарий слишком длинный');
  if (!CATEGORIES.has(type)) return fail('Неизвестный вид снимка');
  const bytes = new Uint8Array(await file.arrayBuffer());
  const mediaType = imageType(bytes);
  if (!mediaType) return fail('Допускаются JPEG, PNG или WebP');
  const id = crypto.randomUUID();
  const now = new Date().toISOString();
  const record = { id, sku, product, notes, kind: type, employee: user.email,
    status: 'pending', createdAt: now, updatedAt: now, reviewer: null, reviewNote: '',
    mime: mediaType, published: false };
  await env.PHOTOS.put('images/' + id, bytes, { httpMetadata: { contentType: mediaType } });
  try {
    await env.PHOTOS.put('submissions/' + id + '.json', utf8.encode(JSON.stringify(record)), {
      httpMetadata: { contentType: 'application/json' },
    });
  } catch (error) {
    await env.PHOTOS.delete('images/' + id);
    throw error;
  }
  return reply({ record }, 201);
}

async function getImage(env, user, id) {
  const record = await readRecord(env.PHOTOS, id);
  if (!record || !canRead(user, record)) return fail('Не найдено', 404);
  const file = await env.PHOTOS.get('images/' + id);
  if (!file) return fail('Снимок не найден', 404);
  return new Response(file.body, {
    headers: {
      'content-type': record.mime,
      'cache-control': 'private, no-store',
      'x-content-type-options': 'nosniff',
      'content-security-policy': "default-src 'none'; sandbox",
    },
  });
}

async function decide(request, env, user, id) {
  if (user.role !== 'reviewer') return fail('Требуется роль проверяющего', 403);
  const record = await readRecord(env.PHOTOS, id);
  if (!record) return fail('Карточка не найдена', 404);
  if (record.status !== 'pending') return fail('Карточка уже проверена', 409);
  const body = await request.json().catch(() => null);
  const decision = body && body.decision;
  const comment = String(body && body.comment || '').trim();
  if (!DECISIONS.has(decision)) return fail('Неизвестное решение');
  if (decision === 'redo' && comment.length < 3) return fail('Укажите причину пересъёмки');
  if (comment.length > 500) return fail('Комментарий слишком длинный');
  record.status = decision === 'approve' ? 'approved' : 'redo';
  record.reviewer = user.email;
  record.reviewNote = comment;
  record.updatedAt = new Date().toISOString();
  await env.PHOTOS.put('submissions/' + id + '.json', utf8.encode(JSON.stringify(record)), {
    httpMetadata: { contentType: 'application/json' },
  });
  return reply({ record });
}

export default {
  async fetch(request, env) {
    try {
      if (!env.PHOTOS || !env.ASSETS) return fail('Не настроено хранилище', 503);
      const user = await authenticated(request, env);
      if (!user) return fail('Вход обязателен', 401);
      const url = new URL(request.url);
      const path = url.pathname;
      if (path === '/api/me' && request.method === 'GET') return reply(user);
      if (path === '/api/submissions' && request.method === 'GET') return reply(await listRecords(env, user));
      if (path === '/api/submissions' && request.method === 'POST') {
        if (!sameOrigin(request)) return fail('Недопустимый источник запроса', 403);
        return savePhoto(request, env, user);
      }
      const hit = path.match(/^\/api\/submissions\/([^/]+)(?:\/(image|decision))?$/);
      if (hit && isId(hit[1])) {
        if (hit[2] === 'image' && request.method === 'GET') return getImage(env, user, hit[1]);
        if (hit[2] === 'decision' && request.method === 'POST') {
          if (!sameOrigin(request)) return fail('Недопустимый источник запроса', 403);
          return decide(request, env, user, hit[1]);
        }
      }
      if (path.startsWith('/api/')) return fail('Маршрут не найден', 404);
      if (request.method !== 'GET' && request.method !== 'HEAD') return fail('Метод запрещён', 405);
      const asset = await env.ASSETS.fetch(request);
      const headers = new Headers(asset.headers);
      headers.set('cache-control', 'private, no-store');
      headers.set('x-content-type-options', 'nosniff');
      headers.set('referrer-policy', 'no-referrer');
      headers.set('content-security-policy', "default-src 'self'; img-src 'self' blob: data:; script-src 'self'; style-src 'self' 'unsafe-inline'; connect-src 'self'; object-src 'none'; base-uri 'none'; frame-ancestors 'none'");
      return new Response(asset.body, { status: asset.status, statusText: asset.statusText, headers });
    } catch (error) {
      if (error.message === 'ACCESS_NOT_CONFIGURED') return fail('Не настроена обязательная авторизация Cloudflare Access', 503);
      return fail('Ошибка сервера; попробуйте повторно', 500);
    }
  },
};
