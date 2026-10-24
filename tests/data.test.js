import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { importMenu, validateDocument } from '../src/data/validate.js';
import { parseJSON } from '../src/data/json.js';
import { shoppingList, formatQuantity, scaleQuantity } from '../src/data/units.js';
import { menu, recipe, task } from './helpers.js';

test('curated three-recipe demo is valid and ready', () => {
  const v = importMenu(fs.readFileSync(new URL('../recipes.json', import.meta.url), 'utf8'));
  assert.equal(v.document.recipes.length, 3); assert.deepEqual(v.errors, []); assert.deepEqual(v.blockers, []);
});
test('legacy import preserves amounts and allows manual prep without inventing recipe times', () => {
  const v = importMenu(fs.readFileSync(new URL('../examples/legacy-menu.json', import.meta.url), 'utf8'));
  assert.deepEqual(v.errors, []); assert.deepEqual(v.blockers, []);
  assert.ok(v.warnings.some(b => b.code === 'UNTIMED_ACTIVE'));
  assert.equal(v.document.recipes[0].ingredients[0].quantity.value, 750);
  assert.equal(v.document.recipes[0].tasks.find(t => t.id === 'hb-mep-1').duration, null);
});
test('unknown active times can run manually, while passive cooking times still block', () => {
  const d = menu([recipe('a', [task('one', 1)])]);
  d.recipes[0].tasks[0].duration = null;
  assert.equal(validateDocument(d).blockers.length, 0);
  assert.ok(validateDocument(d).warnings.some(e => e.code === 'UNTIMED_ACTIVE'));
  d.recipes[0].tasks[0].mode = 'passive';
  assert.ok(validateDocument(d).blockers.some(e => e.code === 'UNKNOWN_DURATION'));
});
test('unknown versions, duplicate keys and malformed JSON are rejected', () => {
  for (const json of ['{"a":1,"a":2}', '{"a":1,"\\u0061":2}', '{"a":NaN}', '{"a":1e400}', '[1,]', '01', '\u00a0{}', '{"a":truefalse}']) assert.throws(() => parseJSON(json), json);
  assert.throws(() => importMenu('{"schemaVersion":"99","recipes":[]}'));
});
test('parser keeps prototype-named keys inert and rejects excessive nesting', () => {
  const parsed = parseJSON('{"__proto__":{"polluted":true}}');
  assert.equal(Object.getPrototypeOf(parsed), null); assert.equal({}.polluted, undefined);
  assert.throws(() => parseJSON('['.repeat(90) + '0' + ']'.repeat(90)));
});
test('schema rejects missing units, numeric text, negative times and unknown fields', () => {
  const original = menu([recipe('a', [task('one', 1)])]);
  for (const change of [
    d => { delete d.recipes[0].ingredients[0].quantity.unit; },
    d => { d.recipes[0].ingredients[0].quantity.value = '1/2'; },
    d => { d.recipes[0].tasks[0].duration.seconds = -1; },
    d => { d.recipes[0].tasks[0].duration.seconds = '20 min'; },
    d => { d.recipes[0].typo = true; },
    d => { d.recipes[0].nutrition = { basis: 'perServing', energyKcal: '<img src=x>' }; }
  ]) { const d = structuredClone(original); change(d); assert.ok(validateDocument(d).errors.length); }
});
test('semantics reject cycles, duplicate IDs and dangling ingredient references', () => {
  const d = menu([recipe('a', [task('one', 1), task('two', 1, { deps: ['one'] })])]);
  d.recipes[0].tasks[0].dependsOn = ['two'];
  assert.ok(validateDocument(d).errors.some(e => e.code === 'DEPENDENCY_CYCLE'));
  d.recipes[0].tasks[0].dependsOn = [];
  d.recipes[0].tasks[1].uses = [{ ingredientId: 'missing', role: 'consume' }];
  assert.ok(validateDocument(d).errors.some(e => e.code === 'UNKNOWN_INGREDIENT'));
  d.recipes[0].tasks[1].id = 'one';
  assert.ok(validateDocument(d).errors.some(e => e.code === 'DUPLICATE_ID'));
});
test('unknown amount blocks planning, optional amount warns, missing nutrition stays absent', () => {
  const d = menu([recipe('a', [task('one', 1)])]);
  d.recipes[0].ingredients[0].quantity = { kind: 'unknown', note: 'Fehlt' };
  assert.ok(validateDocument(d).blockers.some(e => e.code === 'UNKNOWN_QUANTITY'));
  d.recipes[0].ingredients[0].optional = true;
  assert.equal(validateDocument(d).blockers.length, 0);
  assert.ok(validateDocument(d).warnings.some(e => e.code === 'UNKNOWN_QUANTITY'));
  assert.equal(d.recipes[0].nutrition, undefined);
});
test('ingredient consumption cannot exceed declared amount', () => {
  const d = menu([recipe('a', [task('one', 1, { uses: [{ ingredientId: 'water', role: 'consume', fraction: .7 }] }), task('two', 1, { uses: [{ ingredientId: 'water', role: 'consume', fraction: .7 }] })])]);
  assert.ok(validateDocument(d).errors.some(e => e.code === 'EXCESS_CONSUMPTION'));
});
test('different base servings scale before merging; mass and volume stay separate', () => {
  const onion = (value, unit) => [{ id: 'onion', foodId: 'onion', name: 'Zwiebel', quantity: { kind: 'exact', value, unit } }];
  const a = recipe('a', [task('one', 1)], [], onion(100, 'g')); a.baseServings = 2;
  const b = recipe('b', [task('one', 1)], [], onion(.2, 'kg'));
  const d = menu([a, b]); d.selection.forEach(s => s.servings = 4);
  assert.equal(shoppingList(d)[0].quantity.value, 400);
  b.ingredients.push({ id: 'liquid', foodId: 'onion', name: 'Zwiebel', quantity: { kind: 'exact', value: 50, unit: 'ml' } });
  assert.equal(shoppingList(d).length, 2);
});
test('fractions are numeric quantities, never a regex rewrite of instructions', () => {
  assert.equal(formatQuantity(scaleQuantity({ kind: 'exact', value: .5, unit: 'tsp' }, 2)), '1 TL');
  const d = menu([recipe('a', [task('one', 1, { instruction: '1/2 TL im Originaltext' })])]);
  d.selection[0].servings = 8;
  assert.equal(d.recipes[0].tasks[0].instruction, '1/2 TL im Originaltext');
});
