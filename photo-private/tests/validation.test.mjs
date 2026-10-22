import test from 'node:test';
import assert from 'node:assert/strict';
import { sameOrigin, imageType, isId } from '../src/validation.js';

test('image signature checks real bytes, not filename', () => {
  assert.equal(imageType(Uint8Array.of(0xff, 0xd8, 0xff, 0xe0)), 'image/jpeg');
  assert.equal(imageType(Uint8Array.of(137,80,78,71,13,10,26,10)), 'image/png');
  const webp = new TextEncoder().encode('RIFF1234WEBP');
  assert.equal(imageType(webp), 'image/webp');
  assert.equal(imageType(new TextEncoder().encode('<svg>bad</svg>')), null);
  assert.equal(imageType(Uint8Array.of(0, 0, 0, 0)), null);
});

test('identifiers are UUIDs, not untrusted path fragments', () => {
  assert.equal(isId('550e8400-e29b-41d4-a716-446655440000'), true);
  assert.equal(isId('../images/private'), false);
  assert.equal(isId('anything'), false);
  assert.equal(isId('550e8400-e29b-41d4-a716-446655440000/extra'), false);
});

test('mutating requests must have exact same-origin Origin header', () => {
  const req = (origin) => ({
    url: 'https://photo.palleta.store/api/submissions',
    headers: { get: (name) => name === 'origin' ? origin : null },
  });
  assert.equal(sameOrigin(req('https://photo.palleta.store')), true);
  assert.equal(sameOrigin(req('https://evil.example')), false);
  assert.equal(sameOrigin(req('https://photo.palleta.store.evil.example')), false);
  assert.equal(sameOrigin(req(null)), false);
});
