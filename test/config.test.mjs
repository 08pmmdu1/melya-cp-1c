import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseJsonc, locateTopLevel, upsertMcp } from '../src/config.js';

test('parseJsonc: комментарии и висячие запятые', () => {
  const src = `{
    // линейный
    "a": 1, /* блочный */
    "b": [1, 2,],
    "c": { "d": "стр,ока}", },
  }`;
  assert.deepEqual(parseJsonc(src), { a: 1, b: [1, 2], c: { d: 'стр,ока}' } });
});

test('upsertMcp: заменяет существующий блок mcp', () => {
  const src = `{
  "provider": { "x": 1 },
  "mcp": {
    "old": { "type": "local" }
  },
  "permission": {}
}
`;
  const out = upsertMcp(src, { a: { type: 'local' } });
  const parsed = parseJsonc(out);
  assert.deepEqual(parsed.mcp, { a: { type: 'local' } });
  assert.deepEqual(parsed.provider, { x: 1 });
  assert.deepEqual(parsed.permission, {});
});

test('upsertMcp: добавляет mcp, когда его нет', () => {
  const out = upsertMcp('{\n  "a": 1\n}', { b: 2 });
  assert.deepEqual(parseJsonc(out), { a: 1, mcp: { b: 2 } });
});

test('upsertMcp: пустой объект', () => {
  const out = upsertMcp('{}', { b: 2 });
  assert.deepEqual(parseJsonc(out), { mcp: { b: 2 } });
});

test('upsertMcp: комментарии не теряются', () => {
  const src = `{\n  // provider\n  "provider": {}, // keep\n  "z": [1, 2],\n}`;
  const out = upsertMcp(src, { m: 1 });
  assert.match(out, /\/\/ provider/);
  assert.match(out, /\/\/ keep/);
  assert.deepEqual(parseJsonc(out), { provider: {}, z: [1, 2], mcp: { m: 1 } });
});

test('upsertMcp: сохраняет отступ в 4 пробела', () => {
  const src = `{\n    "a": 1\n}\n`;
  const out = upsertMcp(src, { m: { n: 1 } });
  assert.match(out, /\n    "mcp": \{\n        "m": \{\n            "n": 1\n        \}\n    \}/);
  assert.deepEqual(parseJsonc(out), { a: 1, mcp: { m: { n: 1 } } });
});

test('locateTopLevel: находит корень и свойства', () => {
  const src = `{ "a": {"b": 1}, "c": [1,2] }`;
  const loc = locateTopLevel(src);
  assert.ok(loc.rootOpen >= 0 && loc.rootClose > loc.rootOpen);
  assert.deepEqual(loc.props.map((p) => p.key), ['a', 'c']);
});
