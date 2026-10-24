import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { compileGraph } from '../src/planning/graph.js';
import { readiness } from '../src/planning/scheduler.js';
import { validateDocument, importMenu } from '../src/data/validate.js';
import { reduceSession, newSession } from '../src/session/state.js';
import { createStore, inspectBackup } from '../src/session/store.js';
import { keepAwake, releaseWake } from '../src/platform/browser.js';
import { menu, recipe, task, hold, memoryStorage } from './helpers.js';

test('dirty hands and the actual shared knife remain unavailable until cleaning is confirmed', () => {
  const raw = task('raw', 60, { phase: 'prep', uses: [{ ingredientId: 'water', role: 'prepare' }], prep: { ingredientId: 'water', operation: 'dice', resultSpec: '20-mm', hygieneGroup: 'rawMeat', mergeAllowed: false } });
  const doc = menu([recipe('a', [raw], [hold('board', 'board', 'raw', 'raw'), hold('knife', 'knife', 'raw', 'raw')]),
    recipe('b', [task('veg', 60)], [hold('board', 'board', 'veg', 'veg'), hold('knife', 'knife', 'veg', 'veg')])]);
  doc.kitchen.resources.push({ id: 'board-2', kind: 'board', capacity: 1 }, { id: 'knife-1', kind: 'knife', capacity: 1 });
  assert.equal(validateDocument(doc).errors.length, 0);
  const graph = compileGraph(doc); let session = newSession();
  session = reduceSession(graph, session, { type: 'START', id: 'a/raw' }, 0);
  session = reduceSession(graph, session, { type: 'COMPLETE', id: 'a/raw' }, 1000);
  assert.equal(readiness(graph, session, 'b/veg').ready, false);
  assert.match(readiness(graph, session, 'b/veg').reason, /reinigen/);
  session = reduceSession(graph, session, { type: 'START', id: 'a/raw~clean' }, 1000);
  session = reduceSession(graph, session, { type: 'COMPLETE', id: 'a/raw~clean' }, 2000);
  assert.equal(readiness(graph, session, 'b/veg').ready, true);
});
test('scaled volume and declared oven mode are checked before scheduling', () => {
  const doc = menu([recipe('a', [task('one', 1)], [hold('pot', 'pot', 'one', 'one', { minVolumeMlAtBase: 3000 })])]);
  doc.selection[0].servings = 8;
  assert.ok(validateDocument(doc).blockers.some(e => e.code === 'RESOURCE_UNAVAILABLE'));
  doc.recipes[0].reservations = [hold('oven', 'oven', 'one', 'one', { ovenSettings: { temperatureC: 200, mode: 'grill' } })];
  assert.ok(validateDocument(doc).blockers.some(e => e.code === 'RESOURCE_UNAVAILABLE'));
});
test('backup runtime fields cannot inject HTML through portion weights or favorite attributes', () => {
  const storage = memoryStorage(), store = createStore(storage); store.activate(menu([recipe('a', [task('one', 1)])]));
  const backup = { kind: 'chef-backup', version: 2, state: structuredClone(store.state) };
  backup.state.current.session.packing.a = { massG: '\"><img src=x>' };
  assert.throws(() => inspectBackup(backup), /Portionsgewicht/);
  backup.state.current.session.packing = {};
  backup.state.archive.push({ id: 'one', savedAt: 1, favorite: '" onclick="x', snapshot: backup.state.current });
  assert.throws(() => inspectBackup(backup), /Archivstand/);
});
test('legacy partial amounts inherit canonical units without losing the original text', () => {
  const old = JSON.parse(fs.readFileSync(new URL('../examples/legacy-menu.json', import.meta.url), 'utf8'));
  delete old.recipes[0].steps[0].uses[2].unit;
  const result = importMenu(JSON.stringify(old));
  assert.deepEqual(result.errors, []);
  const task = result.document.recipes[0].tasks.find(t => t.id === 'hb-s1');
  assert.equal(task.uses[2].quantity.unit, 'tsp'); assert.equal(task.sourceText, old.recipes[0].steps[0].text);
});
test('old storage keys and timer deadlines survive migration without an assumed new plan', () => {
  const storage = memoryStorage();
  const source = fs.readFileSync(new URL('../examples/legacy-menu.json', import.meta.url), 'utf8'), old = JSON.parse(source);
  storage.setItem('batchcooking_recipes', source);
  const sig = `${old.week}|${old.recipes.map(r => r.id).join('+')}`, deadline = Date.now() + 60000;
  const progress = JSON.stringify({ sig, checked: { 'hb-mep-1': true }, timers: { 'hb-s1': { endsAt: deadline, duration: 900 } } });
  storage.setItem('batchcooking_cook_state', progress);
  const store = createStore(storage);
  assert.equal(store.loadError, null); assert.equal(store.state.current.session.legacyTimers['hb-s1'].endsAt, deadline);
  assert.equal(store.state.current.legacyProgress.checked['hb-mep-1'], true);
  assert.equal(storage.getItem('batchcooking_cook_state'), progress);
  assert.ok(validateDocument(store.state.current.document).blockers.length);
});
test('concurrent wake-lock requests share one request and denied requests are handled', async () => {
  const original = Object.getOwnPropertyDescriptor(globalThis, 'navigator');
  let resolve, calls = 0;
  class Lock extends EventTarget { released = false; async release() { this.released = true; this.dispatchEvent(new Event('release')); } }
  const lock = new Lock();
  Object.defineProperty(globalThis, 'navigator', { configurable: true, value: { wakeLock: { request: () => { calls++; return new Promise(r => { resolve = r; }); } } } });
  try {
    const a = keepAwake(() => {}), b = keepAwake(() => {}); resolve(lock); await Promise.all([a, b]);
    assert.equal(calls, 1); assert.equal(lock.released, false); await releaseWake(); assert.equal(lock.released, true);
    navigator.wakeLock.request = () => Promise.reject(new Error('denied'));
    await Promise.all([keepAwake(() => {}), keepAwake(() => {})]);
  } finally { await releaseWake(); Object.defineProperty(globalThis, 'navigator', original); }
});
