const { test } = require('node:test');
const assert = require('node:assert');
const { resolveEffective, fractionToPdfRect } = require('../src/main/placement');

test('resolveEffective returns global when no override', () => {
  const g = { xFrac: 0.1, yFrac: 0.2, wFrac: 0.3 };
  assert.deepStrictEqual(resolveEffective(g, undefined), { xFrac: 0.1, yFrac: 0.2, wFrac: 0.3 });
});

test('resolveEffective returns null when deleted', () => {
  assert.strictEqual(resolveEffective({ xFrac: 0.1, yFrac: 0.2, wFrac: 0.3 }, { deleted: true }), null);
});

test('resolveEffective returns override when present', () => {
  const g = { xFrac: 0.1, yFrac: 0.2, wFrac: 0.3 };
  const o = { xFrac: 0.5, yFrac: 0.6, wFrac: 0.2 };
  assert.deepStrictEqual(resolveEffective(g, o), o);
});

test('fractionToPdfRect flips origin to bottom-left and keeps aspect', () => {
  // page 200x100 pts, image aspect 2 (wide). wFrac .5 => width 100, height 50.
  // xFrac .25 => x 50. yFrac .1 (top) => y = 100 - 10 - 50 = 40.
  const r = fractionToPdfRect({ xFrac: 0.25, yFrac: 0.1, wFrac: 0.5 }, 200, 100, 2);
  assert.deepStrictEqual(r, { x: 50, y: 40, width: 100, height: 50 });
});

test('fractionToPdfRect handles tall image aspect', () => {
  // page 100x200, aspect 0.5 (tall). wFrac .5 => width 50, height 100.
  // yFrac 0 (top) => y = 200 - 0 - 100 = 100.
  const r = fractionToPdfRect({ xFrac: 0, yFrac: 0, wFrac: 0.5 }, 100, 200, 0.5);
  assert.deepStrictEqual(r, { x: 0, y: 100, width: 50, height: 100 });
});
