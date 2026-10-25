import test from 'node:test';
import assert from 'node:assert/strict';
import { compileGraph } from '../src/planning/graph.js';
import { readiness, plan, runtimeLocks } from '../src/planning/scheduler.js';
import { newSession, reduceSession, isComplete, timerRows } from '../src/session/state.js';
import { createStore, STORAGE_KEY } from '../src/session/store.js';
import { timerRemainingMs } from '../src/session/timers.js';
import { packingPlan } from '../src/ui/views.js';
import { menu, recipe, task, hold, memoryStorage } from './helpers.js';

function fixture() {
  const doc = menu([recipe('a', [task('start', 2), task('wait', 20, { mode: 'passive', deps: ['start'] }), task('pack', 1, { deps: ['wait'] })], [hold('pot', 'pot', 'start', 'pack')])]);
  return { doc, graph: compileGraph(doc) };
}
test('manual timer start, pause and reload preserve remaining time, resources and recipe data', () => {
  const doc = menu([recipe('a', [task('work', 60)]), recipe('b', [task('other', 10)])]);
  const graph = compileGraph(doc), storage = memoryStorage(), store = createStore(storage); store.activate(doc);
  let s = reduceSession(graph, store.state.current.session, { type: 'START', id: 'a/work', startTimer: false }, 1000);
  assert.equal(s.timers['a/work'], undefined);
  s = reduceSession(graph, s, { type: 'RESTART_TIMER', id: 'a/work', seconds: 60 }, 1000);
  s = reduceSession(graph, s, { type: 'PAUSE_TIMER', id: 'a/work' }, 16000);
  store.commit(next => { next.current.session = s; });
  const reloaded = createStore(storage); assert.equal(reloaded.loadError, null);
  s = reloaded.state.current.session;
  assert.equal(s.timers['a/work'].state, 'paused'); assert.equal(s.timers['a/work'].endsAt, null);
  assert.equal(timerRemainingMs(s.timers['a/work'], 3600000), 45000);
  assert.equal(reduceSession(graph, s, { type: 'TICK' }, 3600000), s);
  assert.equal(readiness(graph, s, 'b/other').ready, false);
  assert.equal(plan(graph, { session: s, now: 3600000 }).entries.find(e => e.taskId === 'a/work').end, 45);
  s = reduceSession(graph, s, { type: 'RESUME_TIMER', id: 'a/work' }, 3600000);
  assert.equal(s.timers['a/work'].endsAt, 3645000);
  s = reduceSession(graph, s, { type: 'TICK' }, 3645000);
  assert.equal(s.timers['a/work'].state, 'elapsed'); assert.equal(s.tasks['a/work'].status, 'elapsed');
  assert.equal(store.state.current.document.recipes[0].tasks[0].duration.seconds, 60);
});
test('timer adjustments stay paused and an unfinished paused cook still requires completion confirmation', () => {
  const { doc, graph } = fixture(); let s = newSession();
  s = reduceSession(graph, s, { type: 'START', id: 'a/start', startTimer: false }, 0);
  s = reduceSession(graph, s, { type: 'COMPLETE', id: 'a/start' }, 1000);
  s = reduceSession(graph, s, { type: 'START', id: 'a/wait' }, 1000);
  s = reduceSession(graph, s, { type: 'PAUSE_TIMER', id: 'a/wait' }, 6000);
  s = reduceSession(graph, s, { type: 'ADJUST', id: 'a/wait', seconds: 60 }, 1000000);
  assert.equal(s.timers['a/wait'].state, 'paused'); assert.equal(s.timers['a/wait'].remainingMs, 75000);
  assert.throws(() => reduceSession(graph, s, { type: 'COMPLETE', id: 'a/wait' }, 2000000), /bestätigen/);
  s = reduceSession(graph, s, { type: 'COMPLETE', id: 'a/wait', confirmEarly: true }, 2000000);
  const storage = memoryStorage(), store = createStore(storage); store.activate(doc); store.commit(next => { next.current.session = s; });
  assert.equal(createStore(storage).loadError, null);
  assert.equal(s.timers['a/wait'].state, 'acknowledged');
});
test('invalid paused backup leaves the current data intact; pausing an expired timer does not suppress its alarm', () => {
  const { doc, graph } = fixture(), storage = memoryStorage(), store = createStore(storage); store.activate(doc);
  let s = reduceSession(graph, newSession(), { type: 'START', id: 'a/start' }, 0);
  s = reduceSession(graph, s, { type: 'PAUSE_TIMER', id: 'a/start' }, 2000);
  assert.equal(s.timers['a/start'].state, 'elapsed');
  assert.throws(() => reduceSession(graph, s, { type: 'RESUME_TIMER', id: 'a/start' }, 2001));
  const before = storage.getItem(STORAGE_KEY), bad = structuredClone({ kind: 'chef-backup', version: 2, state: store.state });
  bad.state.current.session.timers.bad = { state: 'paused', endsAt: null, durationSeconds: 60, remainingMs: -1 };
  assert.throws(() => store.restoreBackup(bad), /Timer/);
  assert.equal(storage.getItem(STORAGE_KEY), before);
});
test('untimed handwork survives reload without an alarm and retains resources until completion', () => {
  const a = recipe('a', [task('chop', 1, { duration: null }), task('wait', 60, { mode: 'passive', deps: ['chop'] })], [hold('board', 'board', 'chop', 'chop')]);
  const doc = menu([a, recipe('b', [task('other', 1)])]);
  const storage = memoryStorage(), store = createStore(storage); store.activate(doc);
  const graph = compileGraph(doc);
  store.commit(next => { next.current.session = reduceSession(graph, next.current.session, { type: 'START', id: 'a/chop' }, 1000); });
  let s = createStore(storage).state.current.session;
  assert.equal(s.tasks['a/chop'].status, 'running');
  assert.equal(s.timers['a/chop'], undefined);
  assert.equal(timerRows(s, graph).length, 0);
  s = reduceSession(graph, s, { type: 'TICK' }, 99999999);
  assert.equal(s.tasks['a/chop'].status, 'running');
  assert.equal(readiness(graph, s, 'a/wait').ready, false);
  assert.equal(readiness(graph, s, 'b/other').ready, false);
  assert.ok(runtimeLocks(graph, s).some(l => l.resourceId === 'board-1'));
  assert.ok(plan(graph, { session: s }).entries.every(e => Number.isFinite(e.end)));
  s = reduceSession(graph, s, { type: 'COMPLETE', id: 'a/chop' }, 99999999);
  assert.equal(readiness(graph, s, 'a/wait').ready, true);
  assert.equal(readiness(graph, s, 'b/other').ready, true);
  assert.equal(runtimeLocks(graph, s).length, 0);
  s = reduceSession(graph, s, { type: 'START', id: 'a/wait' }, 99999999);
  assert.equal(s.timers['a/wait'].endsAt, 100059999);
  assert.equal(doc.recipes[0].tasks[0].duration, null);
});
test('absolute timer deadlines survive serialization and acknowledgement is individual', () => {
  const { graph } = fixture(); let s = newSession();
  s = reduceSession(graph, s, { type: 'START', id: 'a/start' }, 1000);
  assert.equal(s.timers['a/start'].endsAt, 3000);
  s = JSON.parse(JSON.stringify(s));
  s = reduceSession(graph, s, { type: 'TICK' }, 4000);
  assert.equal(s.tasks['a/start'].status, 'elapsed'); assert.equal(isComplete(graph, s), false);
  s = reduceSession(graph, s, { type: 'ACK', id: 'a/start' }, 4000);
  assert.equal(s.timers['a/start'].state, 'acknowledged'); assert.equal(readiness(graph, s, 'a/wait').ready, false);
  s = reduceSession(graph, s, { type: 'COMPLETE', id: 'a/start' }, 4000);
  assert.equal(readiness(graph, s, 'a/wait').ready, true);
});
test('passive time cannot be completed early without explicit confirmation', () => {
  const { graph } = fixture(); let s = newSession();
  s = reduceSession(graph, s, { type: 'START', id: 'a/start' }, 0);
  s = reduceSession(graph, s, { type: 'COMPLETE', id: 'a/start' }, 1000);
  s = reduceSession(graph, s, { type: 'START', id: 'a/wait' }, 1000);
  assert.throws(() => reduceSession(graph, s, { type: 'COMPLETE', id: 'a/wait' }, 2000));
  s = reduceSession(graph, s, { type: 'COMPLETE', id: 'a/wait', confirmEarly: true }, 2000);
  assert.equal(s.tasks['a/wait'].status, 'completed');
});
test('extending an expired timer re-arms only that timer', () => {
  const graph = compileGraph(menu([recipe('a', [task('one', 1, { mode: 'passive' }), task('two', 1, { mode: 'passive' })])]));
  let s = newSession(); for (const id of ['a/one', 'a/two']) s = reduceSession(graph, s, { type: 'START', id }, 0);
  s = reduceSession(graph, s, { type: 'TICK' }, 2000);
  s = reduceSession(graph, s, { type: 'ACK', id: 'a/one' }, 2000);
  assert.equal(s.timers['a/two'].state, 'elapsed');
  s = reduceSession(graph, s, { type: 'ADJUST', id: 'a/one', seconds: 60 }, 2000);
  assert.equal(s.timers['a/one'].state, 'running'); assert.equal(s.timers['a/one'].endsAt, 61000);
});
test('skipped prerequisites do not unlock dependent tasks or mark the meal complete', () => {
  const { graph } = fixture(); const s = reduceSession(graph, newSession(), { type: 'SKIP', id: 'a/start' });
  assert.equal(readiness(graph, s, 'a/wait').ready, false); assert.equal(isComplete(graph, s), false);
  assert.throws(() => plan(graph, { session: s }));
  assert.equal(readiness(graph, reduceSession(graph, s, { type: 'RESTORE', id: 'a/start' }), 'a/start').ready, true);
});
test('reload forecast preserves existing resource pins and remaining deadlines', () => {
  const { graph } = fixture(); let s = newSession();
  s = reduceSession(graph, s, { type: 'START', id: 'a/start' }, 1000);
  s = reduceSession(graph, s, { type: 'COMPLETE', id: 'a/start' }, 2000);
  s = reduceSession(graph, s, { type: 'START', id: 'a/wait' }, 2000);
  const p = plan(graph, { session: JSON.parse(JSON.stringify(s)), now: 12000 });
  assert.equal(p.entries.find(e => e.taskId === 'a/wait').end, 10);
  assert.equal(p.reservations.find(r => r.holdId === 'a/hold:pot').resourceId, 'pot-1');
});
test('failed persistence or invalid import leaves the old snapshot unchanged', () => {
  const storage = memoryStorage(), store = createStore(storage), { doc } = fixture(); store.activate(doc);
  const before = storage.getItem(STORAGE_KEY), current = store.state;
  storage.setItem = () => { throw new Error('quota'); };
  assert.throws(() => store.activate(doc), /Speichern fehlgeschlagen/);
  assert.equal(storage.getItem(STORAGE_KEY), before); assert.equal(store.state, current);
  const invalid = structuredClone(doc); invalid.recipes[0].name = null;
  assert.throws(() => store.activate(invalid)); assert.equal(store.state, current);
});
test('stale tabs cannot silently overwrite a newer session', () => {
  const storage = memoryStorage(), a = createStore(storage), { doc } = fixture(); a.activate(doc);
  const b = createStore(storage); a.commit(next => { next.current.session.note = 'new'; });
  assert.throws(() => b.commit(next => { next.current.session.note = 'old'; }), /anderen Tab/);
  assert.equal(JSON.parse(storage.getItem(STORAGE_KEY)).current.session.note, 'new');
});
test('archive preserves timer deadlines, restore swaps current snapshot, new session resets safely', () => {
  const storage = memoryStorage(), store = createStore(storage), { doc, graph } = fixture(); store.activate(doc);
  store.commit(next => { next.current.session = reduceSession(graph, next.current.session, { type: 'START', id: 'a/start' }, 1000); });
  store.startAgain(); assert.equal(store.state.archive.length, 1); assert.equal(store.state.current.session.timers['a/start'], undefined);
  store.restore(store.state.archive[0].id); assert.equal(store.state.current.session.timers['a/start'].endsAt, 3000);
  assert.equal(createStore(storage).loadError, null);
});
test('backup can restore all data while retaining the current snapshot', () => {
  const storage = memoryStorage(), store = createStore(storage), { doc } = fixture(); store.activate(doc);
  const backup = { kind: 'chef-backup', version: 2, state: structuredClone(store.state) };
  store.clearCurrent(); store.restoreBackup(backup); assert.equal(store.state.current.document.recipes[0].id, 'a');
  assert.equal(createStore(storage).loadError, null);
});
test('editing a begun session is blocked and view changes do not mutate state', () => {
  const storage = memoryStorage(), store = createStore(storage), { doc, graph } = fixture(); store.activate(doc);
  store.commit(next => { next.current.session = reduceSession(graph, next.current.session, { type: 'START', id: 'a/start' }, 1000); });
  assert.throws(() => store.changeDocument(d => { d.selection[0].servings = 8; }), /Während/);
  assert.equal(store.state.current.document.selection[0].servings, 4);
});
test('shared meal boxes count leftovers and separate components without double-counting shared boxes', () => {
  const main = recipe('main', [task('one', 1)]), side = recipe('side', [task('one', 1)]);
  side.packaging.combineWithRecipeId = 'main'; side.packaging.separateComponents = ['Sauce'];
  const d = menu([main, side]); d.selection[1].servings = 6;
  const packing = packingPlan(d); assert.equal(packing[0].containers, 4); assert.equal(packing[1].containers, 2); assert.equal(packing[1].shared, 4);
});
