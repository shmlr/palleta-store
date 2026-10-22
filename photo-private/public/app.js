'use strict';
const $ = id => document.getElementById(id);
const state = { user: null, upload: null, previewUrl: null, busy: false };

function notice(message, bad = false) {
  const box = $('notice');
  box.className = bad ? 'error' : 'ok';
  box.textContent = message;
}

async function api(path, options = {}) {
  const response = await fetch(path, { credentials: 'same-origin', cache: 'no-store', ...options });
  const content = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(content.error || 'Не удалось выполнить запрос');
  return content;
}

function button(text, className = 'secondary', handler) {
  const el = document.createElement('button');
  el.type = 'button';
  el.textContent = text;
  el.className = className;
  if (handler) el.onclick = handler;
  return el;
}

async function prepareImage(file) {
  if (!file || !file.type.startsWith('image/')) throw new Error('Выберите изображение');
  if (file.size > 20 * 1024 * 1024) throw new Error('Исходное фото должно быть не более 20 МБ');
  const url = URL.createObjectURL(file);
  try {
    const image = new Image();
    image.src = url;
    await image.decode();
    const canvas = document.createElement('canvas');
    canvas.width = canvas.height = 1200;
    const context = canvas.getContext('2d');
    if (!context) throw new Error('Обработка изображений недоступна');
    context.fillStyle = '#ffffff';
    context.fillRect(0, 0, 1200, 1200);
    const fit = Math.min(1056 / image.naturalWidth, 1056 / image.naturalHeight);
    const w = Math.max(1, Math.round(image.naturalWidth * fit));
    const h = Math.max(1, Math.round(image.naturalHeight * fit));
    context.drawImage(image, (1200 - w) / 2, (1200 - h) / 2, w, h);
    let blob = await new Promise(resolve => canvas.toBlob(resolve, 'image/webp', 0.86));
    if (!blob || blob.type !== 'image/webp') blob = await new Promise(resolve => canvas.toBlob(resolve, 'image/jpeg', 0.85));
    if (!blob) throw new Error('Не удалось подготовить фотографию');
    if (blob.size > 6 * 1024 * 1024) throw new Error('После обработки файл превышает 6 МБ');
    return blob;
  } finally {
    URL.revokeObjectURL(url);
  }
}

async function choose(file) {
  try {
    $('submitPhoto').disabled = true;
    notice('Подготовка фотографии…');
    const blob = await prepareImage(file);
    if (state.previewUrl) URL.revokeObjectURL(state.previewUrl);
    state.previewUrl = URL.createObjectURL(blob);
    state.upload = blob;
    $('previewImage').src = state.previewUrl;
    $('previewImage').hidden = false;
    $('previewHint').hidden = true;
    $('submitPhoto').disabled = false;
    notice('Фото готово. Проверьте правильность товара и кадра.');
  } catch (error) {
    notice(error.message, true);
  }
}

async function send(event) {
  event.preventDefault();
  if (state.busy || !state.upload) return;
  state.busy = true;
  $('submitPhoto').disabled = true;
  try {
    const data = new FormData();
    data.set('sku', $('sku').value.trim());
    data.set('product', $('product').value.trim());
    data.set('kind', $('kind').value);
    data.set('notes', $('notes').value.trim());
    data.set('photo', state.upload, state.upload.type === 'image/webp' ? 'photo.webp' : 'photo.jpg');
    await api('/api/submissions', { method: 'POST', body: data });
    $('photoForm').reset();
    state.upload = null;
    if (state.previewUrl) URL.revokeObjectURL(state.previewUrl);
    state.previewUrl = null;
    $('previewImage').hidden = true;
    $('previewImage').removeAttribute('src');
    $('previewHint').hidden = false;
    notice('Отправлено в общую очередь. Публикация на сайте не выполнялась.');
    showTab('queue');
  } catch (error) {
    $('submitPhoto').disabled = false;
    notice(error.message + '. Фотография сохранена в форме: попробуйте ещё раз.', true);
  } finally {
    state.busy = false;
  }
}

function showTab(name) {
  $('newPanel').hidden = name !== 'new';
  $('queuePanel').hidden = name !== 'queue';
  $('tabNew').classList.toggle('active', name === 'new');
  $('tabQueue').classList.toggle('active', name === 'queue');
  if (name === 'queue') refresh();
}

function label(status) {
  return ({ pending: 'На проверке', approved: 'Утверждено для каталога', redo: 'Переснять' })[status] || 'Неизвестно';
}

async function decide(id, decision) {
  const comment = decision === 'redo' ? prompt('Укажите причину пересъёмки') : '';
  if (decision === 'redo' && (comment === null || !comment.trim())) return;
  if (decision === 'approve' && !confirm('Утвердить фото для внутреннего каталога? Это НЕ публикует его на сайте.')) return;
  try {
    await api('/api/submissions/' + encodeURIComponent(id) + '/decision', {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ decision, comment: comment || '' }),
    });
    notice(decision === 'approve' ? 'Фотография утверждена' : 'Возвращено на пересъёмку');
    await refresh();
  } catch (error) {
    notice(error.message, true);
  }
}

function line(content) {
  const p = document.createElement('p');
  p.textContent = content;
  return p;
}

function renderRows(rows) {
  const root = $('cards');
  root.replaceChildren();
  const waiting = rows.filter(r => r.status === 'pending').length;
  $('count').textContent = waiting ? '(' + waiting + ')' : '';
  if (!rows.length) {
    root.append(line('Пока нет фотографий. Снимите первый товар.'));
    return;
  }
  for (const record of rows) {
    const card = document.createElement('article');
    card.className = 'photo-card';
    const image = document.createElement('img');
    image.alt = 'Фотография: ' + record.product;
    image.loading = 'lazy';
    image.src = '/api/submissions/' + encodeURIComponent(record.id) + '/image';
    card.append(image);
    const metadata = document.createElement('div');
    metadata.className = 'meta';
    const tag = document.createElement('span');
    tag.className = 'chip';
    tag.textContent = label(record.status);
    metadata.append(tag);
    const h3 = document.createElement('h3');
    h3.textContent = record.product;
    metadata.append(h3);
    metadata.append(line('Код: ' + record.sku + ' · ' + new Date(record.createdAt).toLocaleString('ru-RU')));
    metadata.append(line('Фото: ' + ({ front: 'Главная', back: 'Оборот', detail: 'Деталь', weight: 'Весовое' })[record.kind]));
    if (state.user.role === 'reviewer') metadata.append(line('Сотрудник: ' + record.employee));
    if (record.notes) metadata.append(line('Комментарий: ' + record.notes));
    if (record.reviewNote) metadata.append(line('Решение: ' + record.reviewNote));
    if (record.status === 'pending' && state.user.role === 'reviewer') {
      const buttons = document.createElement('div');
      buttons.className = 'controls';
      buttons.append(button('Утвердить', 'secondary approve', () => decide(record.id, 'approve')));
      buttons.append(button('Переснять', 'secondary redo', () => decide(record.id, 'redo')));
      metadata.append(buttons);
    }
    card.append(metadata);
    root.append(card);
  }
}

async function refresh() {
  try {
    const result = await api('/api/submissions');
    renderRows(result.rows || []);
    if (result.limited) notice('Показана ограниченная часть архива. Для роста потребуется пагинация.', true);
  } catch (error) {
    $('cards').replaceChildren(line(error.message));
    notice(error.message, true);
  }
}

async function init() {
  for (const [id, name] of [['cameraInput', 'takePhoto'], ['galleryInput', 'choosePhoto']]) {
    $(name).onclick = () => $(id).click();
    $(id).onchange = event => { if (event.target.files[0]) choose(event.target.files[0]); event.target.value = ''; };
  }
  $('photoForm').addEventListener('submit', send);
  $('tabNew').onclick = () => showTab('new');
  $('tabQueue').onclick = () => showTab('queue');
  $('refresh').onclick = refresh;
  try {
    state.user = await api('/api/me');
    $('identity').textContent = state.user.role === 'reviewer' ? 'Проверяющий · ' + state.user.email : 'Сотрудник · ' + state.user.email;
    $('queueHelp').textContent = state.user.role === 'reviewer' ? 'Вы видите фотографии всех сотрудников.' : 'Здесь отображаются только ваши снимки.';
    await refresh();
    notice('');
  } catch (error) {
    notice('Авторизация не завершена. Проверьте вход через Cloudflare Access. ' + error.message, true);
    $('submitPhoto').disabled = true;
    $('newPanel').hidden = true;
    $('queuePanel').hidden = true;
  }
}

init();
