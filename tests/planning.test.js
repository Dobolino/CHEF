import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { compileGraph } from '../src/planning/graph.js';
import { plan } from '../src/planning/scheduler.js';
import { normalizeQuantity } from '../src/data/units.js';
import { menu, recipe, task, hold } from './helpers.js';

function assertValid(graph, result) {
  const entries = new Map(result.entries.map(e => [e.taskId, e]));
  assert.equal(entries.size, graph.tasks.length);
  for (const t of graph.tasks) {
    assert.ok(Number.isFinite(entries.get(t.id).end));
    for (const dep of t.dependsOn) assert.ok(entries.get(t.id).start >= entries.get(dep).end, `${dep} before ${t.id}`);
  }
  const times = [...new Set(result.entries.flatMap(e => [e.start, e.end]))];
  for (const at of times) {
    const active = result.entries.filter(e => e.start <= at && at < e.end && graph.byId.get(e.taskId).mode === 'active');
    assert.ok(active.length <= graph.kitchen.cooks, `person capacity at ${at}`);
  }
  for (const resource of graph.kitchen.resources) {
    const bookings = result.reservations.filter(b => b.resourceId === resource.id);
    for (const b of bookings) { assert.notEqual(b.end, null); assert.ok(b.end >= b.start); }
    for (const at of [...new Set(bookings.flatMap(b => [b.start, b.end]))]) {
      const overlap = bookings.filter(b => b.start <= at && at < b.end);
      assert.ok(overlap.reduce((n, b) => n + b.units, 0) <= resource.capacity, `equipment capacity ${resource.id}`);
      const configurations = new Set(overlap.filter(b => b.ovenSettings).map(b => JSON.stringify(b.ovenSettings)));
      assert.ok(configurations.size <= 1, 'one temperature/mode per oven');
    }
  }
}
function rice(id) {
  return recipe(id, [task('start', 120), task('simmer', 1080, { mode: 'passive', deps: ['start'] }), task('pack', 60, { deps: ['simmer'], phase: 'pack' })],
    [hold('pot', 'pot', 'start', 'pack'), hold('hob', 'hob', 'start', 'simmer')]);
}
test('rice completion requires cooking plus serving, including device changes', () => {
  const g = compileGraph(menu([rice('a')])), p = plan(g);
  assert.equal(p.totalSeconds, 1260); assertValid(g, p);
});
test('two recipes overlap passive time with adequate global equipment', () => {
  const g = compileGraph(menu([rice('a'), rice('b')])), p = plan(g);
  assert.ok(p.totalSeconds < 2520); assertValid(g, p);
});
test('one pot forces reuse only after food is removed', () => {
  const d = menu([rice('a'), rice('b')]); d.kitchen.resources = d.kitchen.resources.filter(r => r.id !== 'pot-2');
  const g = compileGraph(d), p = plan(g); assert.equal(p.totalSeconds, 2520); assertValid(g, p);
});
test('one oven cannot simultaneously run incompatible temperatures despite spare rack capacity', () => {
  const oven = (id, seconds, temperatureC) => recipe(id, [task('bake', seconds, { mode: 'passive' })], [hold('oven', 'oven', 'bake', 'bake', { ovenSettings: { temperatureC, mode: 'fan' } })]);
  const g = compileGraph(menu([oven('a', 1800, 180), oven('b', 1200, 230)])), p = plan(g);
  assert.equal(p.totalSeconds, 3000); assertValid(g, p);
  const d = menu([oven('a', 1800, 180), oven('b', 1200, 180)]), shared = compileGraph(d);
  assert.equal(plan(shared).totalSeconds, 1800); assertValid(shared, plan(shared));
});
test('separate ovens may run independent temperatures', () => {
  const d = menu([recipe('a', [task('bake', 100, { mode: 'passive' })], [hold('oven', 'oven', 'bake', 'bake', { ovenSettings: { temperatureC: 180, mode: 'fan' } })]),
    recipe('b', [task('bake', 90, { mode: 'passive' })], [hold('oven', 'oven', 'bake', 'bake', { ovenSettings: { temperatureC: 230, mode: 'fan' } })])]);
  d.kitchen.resources.push({ id: 'oven-2', kind: 'oven', capacity: 1, supportedModes: ['fan'] });
  const g = compileGraph(d); assert.equal(plan(g).totalSeconds, 100); assertValid(g, plan(g));
});
test('attention capacity is global and configurable', () => {
  const d = menu([recipe('a', [task('one', 60)]), recipe('b', [task('one', 60)])]);
  assert.equal(plan(compileGraph(d)).totalSeconds, 120);
  d.kitchen.cooks = 2; const g = compileGraph(d); assert.equal(plan(g).totalSeconds, 60); assertValid(g, plan(g));
});
test('safe serial candidate resolves a hold-and-wait greedy deadlock', () => {
  const tasks = [task('start', 1), task('wait', 10, { mode: 'passive', deps: ['start'] }), task('end', 1, { deps: ['wait'] })];
  const a = recipe('a', tasks, [hold('pot', 'pot', 'start', 'end'), hold('pan', 'pan', 'end', 'end')]);
  const b = recipe('b', structuredClone(tasks), [hold('pan', 'pan', 'start', 'end'), hold('pot', 'pot', 'end', 'end')]);
  const d = menu([a, b]); d.kitchen.resources = d.kitchen.resources.filter(r => r.id !== 'pot-2');
  const g = compileGraph(d), p = plan(g); assert.equal(p.totalSeconds, 24); assertValid(g, p);
});
test('compatible prep merges with exact scaled allocations and conserved quantities', () => {
  const onion = (id, value, unit) => recipe(id, [task('chop', 60, { phase: 'prep', uses: [{ ingredientId: 'onion', role: 'prepare' }], prep: {
    ingredientId: 'onion', operation: 'dice', resultSpec: '5-mm', hygieneGroup: 'produce', mergeAllowed: true } })],
  [hold('board', 'board', 'chop', 'chop')], [{ id: 'onion', foodId: 'onion', name: 'Zwiebel', quantity: { kind: 'exact', value, unit } }]);
  const d = menu([onion('a', 100, 'g'), onion('b', .2, 'kg')]); d.selection[1].servings = 8;
  const g = compileGraph(d); assert.equal(g.tasks.length, 1); assert.equal(g.tasks[0].recipeIds.length, 2);
  assert.equal(g.tasks[0].uses.reduce((n, u) => n + normalizeQuantity(u.quantity).value, 0), 500);
  assertValid(g, plan(g));
  d.recipes[1].tasks[0].prep.resultSpec = '10-mm'; assert.equal(compileGraph(d).tasks.length, 2);
});
test('batch capacity expands repeated tasks with conserved ingredient amounts', () => {
  const t = task('fry', 100, { duration: { seconds: 100, scaling: 'batches', batchCapacityServings: 4 }, uses: [{ ingredientId: 'water', role: 'transfer' }] });
  const d = menu([recipe('a', [t])]); d.selection[0].servings = 9;
  const g = compileGraph(d); assert.equal(g.tasks.length, 3); assert.equal(plan(g).totalSeconds, 300);
  assert.equal(g.tasks.reduce((n, t) => n + t.uses[0].quantity.value, 0), 225); assertValid(g, plan(g));
});
test('three-recipe demo includes shared onions and a locked-board cleaning task', () => {
  const d = JSON.parse(fs.readFileSync(new URL('../recipes.json', import.meta.url), 'utf8'));
  const g = compileGraph(d), p = plan(g); assert.ok(g.tasks.some(t => t.recipeIds.length > 1));
  assert.ok(g.tasks.some(t => t.id.endsWith('~clean'))); assertValid(g, p);
  assert.deepEqual(p, plan(g));
});
test('small generated DAGs preserve dependencies and attention constraints', () => {
  for (let size = 2; size < 18; size++) {
    const tasks = Array.from({ length: size }, (_, i) => task(`task-${i}`, (i * 17 % 20) + 1, { mode: i % 3 ? 'active' : 'passive', deps: i > 1 ? [`task-${Math.floor(i / 2) - 1}`] : [] }));
    const g = compileGraph(menu([recipe('a', tasks)])); assertValid(g, plan(g));
  }
});
