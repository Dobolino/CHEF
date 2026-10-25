import { importMenu, validateDocument } from './data/validate.js';
import { stableJSON, parseJSON } from './data/json.js';
import { shoppingList, formatQuantity } from './data/units.js';
import { compileGraph } from './planning/graph.js';
import { plan, readiness, runtimeLocks } from './planning/scheduler.js';
import { newSession, reduceSession, hasProgress, timerRows, isComplete } from './session/state.js';
import { timerRemainingMs } from './session/timers.js';
import { createStore, inspectBackup } from './session/store.js';
import * as views from './ui/views.js';
import * as browser from './platform/browser.js';

const $ = id => document.getElementById(id);
browser.configureDeviceInsets();
browser.lockTouchZoom();
const header = document.querySelector('.topbar');
const stickySizes = new ResizeObserver(() => {
  document.documentElement.style.setProperty('--header-height', `${header.getBoundingClientRect().height}px`);
  document.documentElement.style.setProperty('--timer-height', `${$('timerRail').getBoundingClientRect().height}px`);
});
stickySizes.observe(header, { box: 'border-box' });
stickySizes.observe($('timerRail'), { box: 'border-box' });
let store;
try { store = createStore(localStorage); } catch { store = createStore({ getItem() { throw new Error('Browserspeicher ist nicht zugänglich.'); } }); }
let graph = null, forecast = null, graphSignature = '', validation = { errors: [], blockers: [], warnings: [] }, planError = '', graphError = '';
let timelineOrder = [];
let timerTargetId = null;
let selectedTaskId = null, pendingImport = null, toastTimeout, renderFrame = 0, alarmId = null, alarmLegacy = false;
let alarmInterval = null, registration = null, lastForecastAt = 0, speech = null, pendingConfirm = null, lastRenderedRoute = null;
const railNodes = new Map();
const route = () => {
  const value = location.hash.slice(1).split('/')[0];
  return ({ mise: 'prep', overview: 'overview', shopping: 'prep', prep: 'prep', cook: 'cook', archive: 'archive', plan: 'plan', finish: 'finish' })[value] || 'overview';
};
function navigate(next) {
  browser.stopSpeaking();
  if (location.hash === `#${next}`) render(); else location.hash = next;
  window.scrollTo(0, 0);
}
function toast(message, error = false) {
  clearTimeout(toastTimeout); $('toast').hidden = false; $('toast').textContent = message;
  $('toast').classList.toggle('error-toast', error);
  toastTimeout = setTimeout(() => { $('toast').hidden = true; }, error ? 10000 : 5000);
}
function guarded(callback) {
  return Promise.resolve().then(callback).catch(error => { toast(error.message || 'Die Aktion ist fehlgeschlagen.', true); return false; });
}
function confirm(title, body, label = 'Bestätigen', danger = false) {
  if (pendingConfirm) return Promise.resolve(false);
  $('confirmTitle').textContent = title; $('confirmBody').textContent = body;
  $('confirmAccept').textContent = label; $('confirmAccept').className = danger ? 'danger' : 'primary';
  return new Promise(resolve => { pendingConfirm = resolve; $('confirmDialog').showModal(); });
}
$('confirmDialog').addEventListener('close', () => {
  const resolve = pendingConfirm; pendingConfirm = null; resolve?.($('confirmDialog').returnValue === 'accept');
});
$('confirmDialog').addEventListener('cancel', () => { $('confirmDialog').returnValue = 'cancel'; });
function scheduleRender() { if (!renderFrame) renderFrame = requestAnimationFrame(() => { renderFrame = 0; render(); }); }
store.subscribe(scheduleRender);

function prepare() {
  const current = store.state.current;
  if (!current) { graph = forecast = null; graphSignature = ''; timelineOrder = []; return; }
  const signature = stableJSON(current.document);
  if (signature !== graphSignature) {
    graphSignature = signature; graph = null; forecast = null; selectedTaskId = null; graphError = ''; timelineOrder = [];
    validation = validateDocument(current.document);
    if (!validation.errors.length && !validation.blockers.length) {
      try { graph = compileGraph(current.document); } catch (error) { graphError = error.message; }
      if (graph) {
        // Keep completed and parallel steps in their original positions as the live forecast changes.
        try { timelineOrder = plan(graph).entries.map(entry => entry.taskId); }
        catch { timelineOrder = graph.tasks.map(task => task.id); }
      }
    }
  }
  forecast = null; planError = graphError;
  if (graph) {
    try { forecast = plan(graph, { session: current.session }); lastForecastAt = Date.now(); }
    catch (error) { planError = error.message; }
  }
}
function render() {
  prepare();
  const current = store.state.current, page = route();
  document.body.dataset.view = page;
  const focusCooking = page === 'cook' && graph && !store.loadError && !isComplete(graph, current.session);
  document.body.dataset.cooking = focusCooking ? 'focus' : '';
  document.documentElement.dataset.cooking = focusCooking ? 'focus' : '';
  if (!focusCooking && $('cookStepsDialog').open) $('cookStepsDialog').close();
  if (page === 'cook' && graph && !graph.byId.has(selectedTaskId)) selectedTaskId = currentTask()?.id;
  const focus = document.activeElement;
  const focusId = focus?.id;
  const focusAction = focus?.dataset.action, focusTask = focus?.dataset.id;
  const previousTimelineTask = $('viewRoot').querySelector('.timeline-step[aria-current="step"]')?.dataset.id;
  const openDetails = lastRenderedRoute === page ? [...$('viewRoot').querySelectorAll('details[open]')].map(d => d.dataset.detailKey || [...$('viewRoot').querySelectorAll('details')].indexOf(d)) : [];
  const scrollPositions = lastRenderedRoute === page ? [...$('viewRoot').querySelectorAll('[data-scroll-key]')].map(node => ({ key: node.dataset.scrollKey, top: node.scrollTop, left: node.scrollLeft })) : [];
  lastRenderedRoute = page;
  if (store.loadError) {
    $('viewRoot').innerHTML = `<div class="error"><h1>Gespeicherte Daten brauchen Aufmerksamkeit.</h1><p>${views.esc(store.loadError)}</p><p>Der gespeicherte Stand wurde nicht überschrieben. Sichere ihn vor einer Wiederherstellung.</p><div class="actions">${button('raw-backup', 'Gespeicherte Daten sichern')}${button('repair-storage', 'Wiederherstellung öffnen')}</div></div>`;
  } else if (page === 'archive') $('viewRoot').innerHTML = views.archiveView(store.state);
  else if (!current) $('viewRoot').innerHTML = views.emptyMenu();
  else if (page === 'prep') $('viewRoot').innerHTML = views.prepView(current, graph, forecast, validation);
  else if (page === 'cook') $('viewRoot').innerHTML = views.cookView(current, graph, forecast, selectedTaskId, browser.voiceAvailable(), validation, timelineOrder);
  else if (page === 'plan') $('viewRoot').innerHTML = views.planView(current, graph, forecast, planError);
  else if (page === 'finish') $('viewRoot').innerHTML = views.finishView(current, graph);
  else $('viewRoot').innerHTML = views.menuView(current, graph, forecast, validation);
  if (planError && current && !['archive', 'plan'].includes(page)) {
    const error = document.createElement('div'); error.className = 'warning'; error.textContent = planError; $('viewRoot').prepend(error);
  }
  for (const key of openDetails) {
    const details = [...$('viewRoot').querySelectorAll('details')];
    const node = typeof key === 'number' ? details[key] : details.find(d => d.dataset.detailKey === key);
    if (node) node.open = true;
  }
  for (const { key, top, left } of scrollPositions) {
    const node = [...$('viewRoot').querySelectorAll('[data-scroll-key]')].find(node => node.dataset.scrollKey === key);
    if (node) { node.scrollTop = top; node.scrollLeft = left; }
  }
  if (page === 'cook' && previousTimelineTask !== selectedTaskId) $('viewRoot').querySelector('.timeline-step[aria-current="step"]')?.scrollIntoView({ block: 'nearest', inline: 'center' });
  if ($('cookStepsDialog').open) renderCookSteps();
  for (const a of document.querySelectorAll('.navigation a')) a.setAttribute('aria-current', a.hash === `#${page === 'plan' ? 'cook' : page === 'finish' ? 'cook' : page}` ? 'page' : 'false');
  document.title = `CHEF · ${({ overview: 'Wochenmenü', prep: 'Vorbereiten', cook: 'Kochen', archive: 'Archiv', plan: 'Ablaufplan', finish: 'Portionieren' })[page]}`;
  // Preserve explicit controls after state changes, never steal focus from a dialog.
  if (!$('confirmDialog').open && !$('alarmDialog').open && focus?.closest('#viewRoot')) {
    let target = focus?.classList.contains('timeline-step') && previousTimelineTask !== selectedTaskId
      ? $('viewRoot').querySelector('.timeline-step[aria-current="step"]') : focusId ? document.getElementById(focusId) : null;
    if (!target && focusAction) target = [...$('viewRoot').querySelectorAll('[data-action]')].find(b => b.dataset.action === focusAction && b.dataset.id === focusTask);
    target?.focus({ preventScroll: true });
  }
  renderTimers(); updateConnection(); updateWake(); updateVersionButton(); syncAlarm();
}
function button(action, label) { return `<button data-action="${action}">${label}</button>`; }
function renderCookSteps() {
  if (!graph || !store.state.current) return;
  const content = $('cookStepsContent'), top = content.scrollTop;
  const focusedTask = content.contains(document.activeElement) ? document.activeElement.dataset.id : null;
  const completedOpen = content.querySelector('details')?.open;
  content.innerHTML = views.cookStepsView(store.state.current, graph, forecast);
  if (completedOpen && content.querySelector('details')) content.querySelector('details').open = true;
  content.scrollTop = top;
  if (focusedTask) [...content.querySelectorAll('[data-id]')].find(node => node.dataset.id === focusedTask)?.focus({ preventScroll: true });
}
$('cookStepsDialog').addEventListener('close', () => {
  if (!$('cookStepsDialog').open) $('cookStepsContent').replaceChildren();
  syncAlarm();
});
function currentTask() {
  const session = store.state.current?.session;
  return graph?.byId.get(selectedTaskId) || graph?.tasks.find(t => ['running', 'elapsed'].includes(session?.tasks[t.id]?.status))
    || forecast?.entries.map(e => graph.byId.get(e.taskId)).find(t => readiness(graph, session, t.id).ready) || graph?.tasks[0];
}
function act(action) {
  if (!store.state.current) throw new Error('Kein Menü geladen.');
  const current = store.state.current;
  const updated = reduceSession(graph, current.session, action);
  if (updated === current.session) return;
  store.commit(next => { next.current.session = updated; });
}
function devicesForTask(taskId) {
  if (!graph || !store.state.current) return '';
  const ancestors = id => {
    const result = new Set(), todo = [id];
    while (todo.length) { const current = todo.pop(); if (result.has(current)) continue; result.add(current); todo.push(...(graph.byId.get(current)?.dependsOn || [])); }
    return result;
  };
  const before = ancestors(taskId);
  const relevant = new Set(graph.holds.filter(h => before.has(h.fromTask) && ancestors(h.throughTask).has(taskId)).map(h => h.id));
  const allocations = runtimeLocks(graph, store.state.current.session).filter(l => relevant.has(l.holdId));
  return [...new Set(allocations.map(a => { const r = graph.kitchen.resources.find(r => r.id === a.resourceId); return r?.name || (r ? views.resourceName(r) : a.resourceId); }))].join(' · ');
}
function renderTimers() {
  const current = store.state.current;
  const rows = current ? timerRows(current.session, graph) : [];
  const keys = new Set(rows.map(t => `${t.legacy ? 'legacy:' : ''}${t.id}`));
  for (const [key, node] of railNodes) if (!keys.has(key)) { node.remove(); railNodes.delete(key); }
  for (const row of rows) {
    const key = `${row.legacy ? 'legacy:' : ''}${row.id}`;
    let node = railNodes.get(key);
    if (!node) {
      node = document.createElement('button'); node.type = 'button'; node.className = 'timer-chip';
      node.dataset.timerId = row.id; node.dataset.legacy = String(row.legacy);
      node.innerHTML = '<span class="timer-label"><span></span><small></small></span><span class="countdown mono" aria-hidden="true"></span>';
      $('timerRail').appendChild(node); railNodes.set(key, node);
    }
    node.firstElementChild.firstElementChild.textContent = row.label;
    node.querySelector('small').textContent = `${row.recipeNames.join(' + ')}${row.legacy ? '' : ` · ${devicesForTask(row.id) || (row.mode === 'passive' ? 'Wartezeit' : 'Handarbeit')}`}`;
    node.classList.toggle('elapsed', row.state === 'elapsed');
    node.classList.toggle('paused', row.state === 'paused');
    node.setAttribute('aria-label', `${row.label}. ${row.state === 'elapsed' ? 'Abgelaufen' : row.state === 'paused' ? 'Timer pausiert' : 'Timer läuft'}. ${row.legacy ? 'Zum Quittieren öffnen' : 'Schritt öffnen'}.`);
  }
  $('timerRail').hidden = rows.length === 0; updateCountdowns();
}
function updateCountdowns() {
  const session = store.state.current?.session; if (!session) return;
  for (const [key, node] of railNodes) {
    const legacy = key.startsWith('legacy:'), id = legacy ? key.slice(7) : key;
    const timer = legacy ? session.legacyTimers[id] : session.timers[id];
    if (timer) node.querySelector('.countdown').textContent = timer.state === 'elapsed' ? 'Prüfen' : views.countdown(timerRemainingMs(timer) / 1000);
  }
  for (const output of document.querySelectorAll('[data-main-timer]')) {
    const timer = session.timers[output.dataset.mainTimer];
    if (timer) output.textContent = timer.state === 'elapsed' ? 'Zeit vorbei' : views.countdown(timerRemainingMs(timer) / 1000);
  }
}
function elapsedRows() { return store.state.current ? timerRows(store.state.current.session, graph).filter(t => t.state === 'elapsed') : []; }
function syncAlarm() {
  const pending = elapsedRows();
  if (!pending.length) {
    if ($('alarmDialog').open) $('alarmDialog').close(); alarmId = null;
    clearInterval(alarmInterval); alarmInterval = null; return;
  }
  if (!alarmInterval) { browser.beep(); alarmInterval = setInterval(browser.beep, 1400); }
  if ($('cookStepsDialog').open) $('cookStepsDialog').close();
  if (document.querySelector('dialog[open]:not(#alarmDialog)')) return;
  const row = pending.find(t => t.id === alarmId && t.legacy === alarmLegacy) || pending[0];
  alarmId = row.id; alarmLegacy = row.legacy;
  $('alarmTitle').textContent = row.label; $('alarmRecipe').textContent = row.recipeNames.join(' + ');
  $('ackAllTimers').hidden = pending.length < 2;
  if (!$('alarmDialog').open) $('alarmDialog').showModal();
}
$('alarmDialog').addEventListener('cancel', event => { event.preventDefault(); toast('Den betroffenen Timer ausdrücklich quittieren.'); });
$('ackTimer').addEventListener('click', () => guarded(() => { browser.unlockAudio(); act({ type: alarmLegacy ? 'ACK_LEGACY' : 'ACK', id: alarmId }); }));
$('ackAllTimers').addEventListener('click', () => guarded(() => {
  const pending = elapsedRows();
  store.commit(next => { for (const row of pending) next.current.session = reduceSession(graph, next.current.session, { type: row.legacy ? 'ACK_LEGACY' : 'ACK', id: row.id }); });
}));
function updateConnection() { $('connectionStatus').textContent = navigator.onLine ? 'Lokal gespeichert' : 'Offline'; $('connectionStatus').classList.toggle('warn', !navigator.onLine); }
function updateWake() {
  const active = store.state.current && hasProgress(store.state.current.session) && !isComplete(graph, store.state.current.session);
  if (active && document.visibilityState === 'visible') void browser.keepAwake(message => { $('wakeStatus').textContent = message; });
  else { void browser.releaseWake(); $('wakeStatus').textContent = ''; }
}
async function startTask(id) {
  if (!graph) throw new Error('Zuerst fehlende Angaben ergänzen.');
  selectedTaskId = id; act({ type: 'START', id, startTimer: false });
}
function startTimer(id, seconds) {
  if (!Number.isInteger(seconds) || seconds < 1 || seconds > 86400) throw new Error('Eine Timerdauer zwischen einer Sekunde und 24 Stunden wählen.');
  let session = store.state.current.session;
  if (!['running', 'elapsed'].includes(session.tasks[id]?.status)) session = reduceSession(graph, session, { type: 'START', id, startTimer: false });
  session = reduceSession(graph, session, { type: 'RESTART_TIMER', id, seconds });
  store.commit(next => { next.current.session = session; });
  browser.unlockAudio(); selectedTaskId = id;
}
function editTimer(id) {
  const task = graph?.byId.get(id); if (!task) throw new Error('Schritt fehlt.');
  timerTargetId = id;
  const timer = store.state.current.session.timers[id];
  const seconds = timer?.durationSeconds || (task.untimed ? 0 : task.durationSeconds);
  $('timerMinutes').value = Math.floor(seconds / 60); $('timerSeconds').value = seconds % 60;
  $('timerDialogNote').textContent = timer ? 'Die neue Dauer startet diesen Timer neu. Abbrechen behält den bisherigen Timer.' : 'Du bestimmst die Dauer. Der Timer startet erst mit deiner Bestätigung.';
  $('timerDialog').showModal(); $('timerMinutes').focus(); $('timerMinutes').select();
}
$('timerForm').addEventListener('submit', event => {
  event.preventDefault(); void guarded(() => {
    const seconds = Number($('timerMinutes').value) * 60 + Number($('timerSeconds').value);
    startTimer(timerTargetId, seconds); $('timerDialog').close(); syncAlarm();
  });
});
function browseTask(delta) {
  if (!graph) return;
  const index = timelineOrder.indexOf(currentTask()?.id);
  selectedTaskId = timelineOrder[Math.max(0, Math.min(timelineOrder.length - 1, index + delta))];
  navigate('cook');
}
function markAllReady() {
  store.commit(next => {
    for (const item of shoppingList(next.current.document)) next.current.checks.ready[item.key] = true;
    for (const resource of next.current.document.kitchen.resources) next.current.checks.equipment[resource.id] = true;
  });
}
function nextReady() {
  prepare(); const session = store.state.current?.session;
  const ordered = forecast?.entries.map(e => graph.byId.get(e.taskId)) || graph?.tasks || [];
  selectedTaskId = ordered.find(t => readiness(graph, session, t.id).ready)?.id
    || graph?.tasks.find(t => ['running', 'elapsed'].includes(session.tasks[t.id]?.status))?.id
    || graph?.tasks.find(t => session.tasks[t.id]?.status !== 'completed')?.id;
  if (isComplete(graph, session)) navigate('finish'); else { navigate('cook'); render(); $('viewRoot').querySelector('.cook-primary')?.focus({ preventScroll: true }); }
}
async function completeTask(id) {
  const current = store.state.current, task = graph.byId.get(id), timer = current.session.timers[id];
  let confirmEarly = false;
  if (task.mode === 'passive' && timerRemainingMs(timer) > 0) {
    confirmEarly = await confirm(timer.state === 'paused' ? 'Timer ist pausiert' : 'Timer läuft noch', 'Die Restzeit ist noch offen. Nur vorzeitig abschließen, wenn der Garzustand oder die Voraussetzung tatsächlich geprüft und erfüllt ist.', 'Geprüft & erledigt');
    if (!confirmEarly) return;
  }
  act({ type: 'COMPLETE', id, confirmEarly }); nextReady();
}
function showPreview(result) {
  pendingImport = result;
  const { document, errors, blockers, warnings } = result;
  $('importPreview').innerHTML = `${document && !errors.length ? `<p><strong>${document.recipes.length} Gerichte</strong> · ${document.selection.reduce((n, s) => n + s.servings, 0)} Rezeptportionen</p><ul>${document.recipes.map(r => `<li>${views.esc(r.name)} · Basis ${r.baseServings} Portionen</li>`).join('')}</ul>` : '<p>Die Datei enthält noch kein gültiges Menü.</p>'}${views.issues(result)}${!errors.length ? `<div class="notice">${blockers.length ? 'Als Entwurf importierbar. Fehlende Angaben anschließend im Menü ergänzen.' : 'Daten sind zur Planung bereit.'} Das bisherige Menü wird samt Fortschritt im Archiv erhalten.</div>` : ''}`;
  $('acceptImport').disabled = errors.length > 0;
  $('acceptImport').textContent = blockers.length ? 'Als Entwurf übernehmen' : 'Menü übernehmen';
  $('importDialog').showModal();
}
function previewText(text) {
  try { showPreview(importMenu(text)); }
  catch (error) { showPreview({ document: null, errors: [{ code: 'PARSE', path: '/', message: error.message }], blockers: [], warnings: [] }); }
}
async function loadDemo() {
  const response = await fetch('recipes.json', { cache: 'no-store' });
  if (!response.ok) throw new Error('Beispielmenü konnte nicht geladen werden.');
  previewText(await response.text());
}
$('acceptImport').addEventListener('click', () => guarded(async () => {
  if (store.state.current && timerRows(store.state.current.session, graph).length && !await confirm('Laufende Timer archivieren?', 'Timer des bisherigen Kochabends werden gesichert, lösen im Archiv aber keine Alarme aus. Laufende Kochvorgänge vorher beenden oder im bisherigen Menü bleiben.', 'Timer archivieren & wechseln')) return;
  if (pendingImport?.backup) {
    store.restoreBackup(pendingImport.backup); pendingImport = null; $('importDialog').close(); navigate('overview'); toast('Datensicherung wiederhergestellt. Der vorherige aktuelle Stand wurde zusätzlich archiviert.'); return;
  }
  if (!pendingImport?.document || pendingImport.errors.length) return;
  store.activate(pendingImport.document); pendingImport = null; $('importDialog').close(); navigate('overview');
  toast('Menü übernommen. Der vorherige Stand liegt im Archiv.');
}));
$('fileInput').addEventListener('change', event => guarded(async () => {
  const file = event.target.files[0]; if (!file) return;
  if (file.size > 10 * 1024 * 1024) throw new Error('Die Datei ist zu groß. Rezeptmenüs bis 1 MB, Sicherungen bis 10 MB werden unterstützt.');
  const text = await file.text(); event.target.value = '';
  const source = parseJSON(text, { maxBytes: 10 * 1024 * 1024 });
  if (source?.kind === 'chef-backup') {
    const incoming = inspectBackup(source); pendingImport = { backup: source };
    $('importPreview').innerHTML = `<p>Vollständige Datensicherung mit ${incoming.archive.length} Archivständen${incoming.current ? ' und einem aktuellen Menü' : ''}.</p><div class="warning">Gespeicherte Timer behalten ihre absoluten Endzeiten. Der bisherige aktuelle Stand wird zusätzlich archiviert.</div>`;
    $('acceptImport').disabled = false; $('acceptImport').textContent = 'Sicherung wiederherstellen'; $('importDialog').showModal();
  } else previewText(text);
}));
$('validateEditor').addEventListener('click', () => { $('editorDialog').close(); previewText($('jsonEditor').value); });
document.addEventListener('click', event => {
  const closer = event.target.closest('[data-close]'); if (closer) { $(closer.dataset.close).close(); syncAlarm(); return; }
  const routeButton = event.target.closest('[data-route]'); if (routeButton) { navigate(routeButton.dataset.route); return; }
  const timer = event.target.closest('[data-timer-id]');
  if (timer) {
    if (timer.dataset.legacy === 'true') {
      const old = store.state.current.session.legacyTimers[timer.dataset.timerId];
      if (old.state === 'elapsed') { alarmId = timer.dataset.timerId; alarmLegacy = true; syncAlarm(); }
      else void guarded(async () => { if (await confirm('Übernommenen Timer beenden?', 'Damit endet nur die Timerüberwachung. Den tatsächlichen Kochvorgang prüfen und beenden. Der alte Fortschritt bleibt in der Datensicherung enthalten.', 'Timer beenden')) act({ type: 'ACK_LEGACY', id: timer.dataset.timerId }); });
    }
    else { selectedTaskId = timer.dataset.timerId; navigate('cook'); }
    return;
  }
  const target = event.target.closest('[data-action]'); if (!target) return;
  const id = target.dataset.id;
  void guarded(async () => {
    switch (target.dataset.action) {
      case 'import': $('fileInput').click(); break;
      case 'demo': await loadDemo(); break;
      case 'edit': $('jsonEditor').value = JSON.stringify(store.state.current?.document || {}, null, 2); $('editorDialog').showModal(); break;
      case 'export': browser.download('chef-menue.json', store.state.current.document); break;
      case 'backup': browser.download('chef-datensicherung.json', { kind: 'chef-backup', version: 2, state: store.state }); toast('Datensicherung heruntergeladen.'); break;
      case 'prompt': {
        const response = await fetch('PROMPT_RECIPES.md'); if (!response.ok) throw new Error('Rezept-Prompt fehlt.');
        await browser.shareText(await response.text()); toast('Rezept-Prompt kopiert, geteilt oder heruntergeladen.'); break;
      }
      case 'clear': if (await confirm('Menü archivieren?', 'Das aktuelle Menü und sein Fortschritt bleiben im Archiv erhalten. Archivierte Timer lösen keine Alarme aus; laufende Kochvorgänge vorher beenden.', 'Archivieren')) { store.clearCurrent(); navigate('overview'); } break;
      case 'restart': if (await confirm('Neuen Kochabend beginnen?', 'Der aktuelle Stand samt Timer-Endzeiten wird archiviert. Archivierte Timer lösen keine Alarme aus; laufende Kochvorgänge vorher beenden. Der neue Kochabend beginnt bei null.', 'Archivieren & neu starten')) { store.startAgain(); selectedTaskId = null; navigate('overview'); } break;
      case 'portion': store.changeDocument(doc => { const item = doc.selection.find(s => s.recipeId === id); item.servings = Math.max(1, Math.min(100, item.servings + Number(target.dataset.delta))); }); break;
      case 'show-missing': {
        if (route() !== 'overview') {
          const changed = new Promise(resolve => window.addEventListener('hashchange', resolve, { once: true }));
          navigate('overview'); await changed;
        } else render();
        const field = document.querySelector('[data-required-time]');
        if (field) { field.closest('details').open = true; field.scrollIntoView({ block: 'center' }); field.focus({ preventScroll: true }); }
        else { $('jsonEditor').value = JSON.stringify(store.state.current.document, null, 2); $('editorDialog').showModal(); }
        break;
      }
      case 'all-ready': markAllReady(); toast('Zutaten und Geräte als bereit bestätigt.'); break;
      case 'start-task': await startTask(id); break;
      case 'start-timer': {
        const task = graph.byId.get(id);
        if (task.untimed) editTimer(id); else startTimer(id, task.durationSeconds);
        break;
      }
      case 'timer-settings': editTimer(id); break;
      case 'pause-timer': act({ type: 'PAUSE_TIMER', id }); break;
      case 'resume-timer': browser.unlockAudio(); act({ type: 'RESUME_TIMER', id }); break;
      case 'previous-task': browseTask(-1); break;
      case 'following-task': browseTask(1); break;
      case 'complete-task': await completeTask(id); break;
      case 'next-ready': nextReady(); break;
      case 'cook-steps': renderCookSteps(); $('cookStepsDialog').showModal(); break;
      case 'select-task': $('cookStepsDialog').close(); selectedTaskId = id; navigate('cook'); break;
      case 'adjust-timer': act({ type: 'ADJUST', id, seconds: Number(target.dataset.seconds) }); break;
      case 'skip-task':
        if (await confirm('Für später überspringen?', 'Abhängige Schritte bleiben gesperrt. Vor dem Abschluss musst du diesen Schritt nachholen.', 'Für später markieren')) { act({ type: 'SKIP', id }); nextReady(); } break;
      case 'restore-task': act({ type: 'RESTORE', id }); break;
      case 'speak': browser.speak(`${graph.byId.get(id).instruction} ${graph.byId.get(id).uses.map(u => `${formatQuantity(u.quantity)} ${u.name}`).join('. ')}`); break;
      case 'voice':
        speech = browser.listen(command => void guarded(async () => {
          if (/^(wiederholen|vorlesen)$/.test(command)) browser.speak(graph.byId.get(id).instruction);
          else if (/^(erledigt|fertig)$/.test(command)) await completeTask(id);
          else if (/^(weiter|nächster schritt)$/.test(command)) browseTask(1);
          else if (/^(eine minute mehr|timer plus eine minute)$/.test(command)) act({ type: 'ADJUST', id, seconds: 60 });
          else toast('Nicht erkannt. Nutze die Tasten oder einen angezeigten Befehl.');
        }), message => { speech = null; if (message) toast(message, true); }); toast('Mikrofon aktiv. Jetzt einen Befehl sprechen.'); break;
      case 'favorite': store.commit(next => { const entry = next.archive.find(a => a.id === id); entry.favorite = !entry.favorite; }); break;
      case 'restore-archive': if (await confirm('Gespeicherten Stand fortsetzen?', 'Timer behalten ihre absoluten Endzeiten. Der aktuelle Stand wird ins Archiv getauscht und dort nicht weiter überwacht. Laufende Kochvorgänge vorher beenden.', 'Wiederherstellen')) { store.restore(id); navigate('overview'); } break;
      case 'reuse-archive': if (await confirm('Als neuen Kochabend laden?', 'Rezepte und Portionen werden übernommen. Der aktuelle Stand wird archiviert; seine Timer lösen dort keine Alarme mehr aus. Laufende Kochvorgänge vorher beenden.', 'Neu laden')) { store.activate(store.state.archive.find(a => a.id === id).snapshot.document); navigate('overview'); } break;
      case 'delete-archive': if (await confirm('Archivierten Stand entfernen?', 'Diese lokale Archivkopie wird entfernt. Lade vorher eine Datensicherung herunter, wenn du sie behalten möchtest.', 'Entfernen', true)) store.commit(next => { next.archive = next.archive.filter(a => a.id !== id); }); break;
      case 'raw-backup': {
        const raw = { current: localStorage.getItem('chef.workspace.v2'), legacyRecipes: localStorage.getItem('batchcooking_recipes'), legacyCook: localStorage.getItem('batchcooking_cook_state') };
        browser.download('chef-wiederherstellung.json', raw); break;
      }
      case 'repair-storage':
        if (await confirm('Beschädigten Stand sichern und neu öffnen?', 'Der bisherige Rohstand wird zusätzlich unter einem Wiederherstellungsschlüssel aufbewahrt. Anschließend kannst du gültige Rezeptdaten importieren.', 'Sichern & neu öffnen')) {
          const raw = localStorage.getItem('chef.workspace.v2');
          if (raw != null) localStorage.setItem(`chef.recovery.${Date.now()}`, raw);
          localStorage.setItem('chef.workspace.v2', JSON.stringify({ version: 2, current: null, archive: [], initialized: true })); location.reload();
        } break;
    }
  });
});
document.addEventListener('change', event => {
  const target = event.target;
  void guarded(() => {
    if (target.dataset.selectRecipe) {
      store.changeDocument(doc => {
        if (target.checked) { const r = doc.recipes.find(r => r.id === target.dataset.selectRecipe); doc.selection.push({ recipeId: r.id, servings: r.baseServings }); }
        else { if (doc.selection.length === 1) throw new Error('Mindestens ein Gericht auswählen.'); doc.selection = doc.selection.filter(s => s.recipeId !== target.dataset.selectRecipe); }
      });
    } else if (target.dataset.combineRecipe) store.changeDocument(doc => {
      const r = doc.recipes.find(r => r.id === target.dataset.combineRecipe); r.packaging ||= { containersPerServing: 1 };
      if (target.value) r.packaging.combineWithRecipeId = target.value; else delete r.packaging.combineWithRecipeId;
    });
    else if (target.dataset.taskTime) store.changeDocument(doc => {
      const task = doc.recipes.find(r => r.id === target.dataset.recipe).tasks.find(t => t.id === target.dataset.taskTime);
      if (!target.value && task.mode === 'active') { task.duration = null; return; }
      const seconds = Math.round(Number(target.value) * 60);
      if (!target.value || seconds < 1 || seconds > 86400) throw new Error('Eine Zeit zwischen einer Sekunde und 24 Stunden angeben.');
      task.duration = { ...(task.duration || { scaling: 'fixed' }), seconds };
    });
    else if (target.dataset.ready) store.commit(next => { next.current.checks.ready[target.dataset.ready] = target.checked; });
    else if (target.dataset.equipment) store.commit(next => { next.current.checks.equipment[target.dataset.equipment] = target.checked; });
    else if (target.hasAttribute('data-session-note')) act({ type: 'NOTE', value: target.value });
    else if (target.dataset.packMass) {
      const value = target.value ? Number(target.value) : null;
      if (value != null && (!Number.isFinite(value) || value <= 0 || value > 1000000)) throw new Error('Gesamtgewicht als positive Grammzahl angeben.');
      act({ type: 'PACKING', recipeId: target.dataset.packMass, value: { massG: value } });
    } else if (target.dataset.packed) act({ type: 'PACKING', recipeId: target.dataset.packed, value: { packed: target.checked } });
    else if (target.dataset.packDate) {
      const value = target.value ? new Date(target.value).getTime() : null;
      if (value != null && (!Number.isFinite(value) || value > Date.now() + 60000)) throw new Error('Ein tatsächliches Datum bis heute angeben.');
      const existing = store.state.current.session.packing[target.dataset.recipe] || {};
      if (target.dataset.packDate === 'thawedAt' && existing.frozenAt && value < existing.frozenAt) throw new Error('Auftauen kann nicht vor dem Einfrieren liegen.');
      act({ type: 'PACKING', recipeId: target.dataset.recipe, value: { [target.dataset.packDate]: value } });
    }
  }).then(result => { if (result === false) scheduleRender(); });
});
document.addEventListener('keydown', event => {
  if (route() !== 'cook' || event.altKey || event.ctrlKey || event.metaKey || event.target.closest('input,textarea,select,dialog')) return;
  if (!['ArrowLeft', 'ArrowRight'].includes(event.key) || !graph) return;
  event.preventDefault(); browseTask(event.key === 'ArrowRight' ? 1 : -1);
});
let touch = null;
$('viewRoot').addEventListener('touchstart', event => { if (event.touches.length === 1 && route() === 'cook' && !event.target.closest('button,input,textarea,select,a,summary,.cook-route')) touch = { x: event.touches[0].clientX, y: event.touches[0].clientY }; else touch = null; }, { passive: true });
$('viewRoot').addEventListener('touchend', event => {
  if (!touch || !graph || document.querySelector('dialog[open]')) return;
  const dx = event.changedTouches[0].clientX - touch.x, dy = event.changedTouches[0].clientY - touch.y; touch = null;
  if (Math.abs(dx) < 90 || Math.abs(dx) < Math.abs(dy) * 2) return;
  browseTask(dx < 0 ? 1 : -1);
}, { passive: true });
window.addEventListener('hashchange', () => { render(); $('main').focus({ preventScroll: true }); });
window.addEventListener('online', updateConnection); window.addEventListener('offline', updateConnection);
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'visible') { tick(); updateWake(); }
  else { browser.stopSpeaking(); speech?.abort(); }
});
window.addEventListener('storage', event => { if (event.key === 'chef.workspace.v2') toast('Die Daten wurden in einem anderen Tab geändert. Diesen Tab neu laden, bevor du weiterkochst.', true); });
function tick() {
  try { if (store.state.current && !store.loadError) act({ type: 'TICK' }); }
  catch (error) { toast(error.message, true); }
  updateCountdowns(); syncAlarm();
  if (graph && Date.now() - lastForecastAt > 15000) {
    try { forecast = plan(graph, { session: store.state.current.session }); lastForecastAt = Date.now();
      for (const span of document.querySelectorAll('[data-live-eta]')) span.textContent = views.remainingTimeText(forecast, store.state.current.session);
    } catch { /* A skipped prerequisite is explained in the full view. */ }
  }
}
function updateVersionButton() {
  const active = store.state.current && hasProgress(store.state.current.session) && !isComplete(graph, store.state.current.session);
  $('updateApp').disabled = !!active; $('updateApp').textContent = active ? 'Nach dem Kochen aktualisieren' : 'Aktualisieren';
}
$('updateApp').addEventListener('click', () => { if (!$('updateApp').disabled) registration?.waiting?.postMessage({ type: 'ACTIVATE_UPDATE' }); });
async function registerWorker() {
  if (!('serviceWorker' in navigator)) return;
  try {
    registration = await navigator.serviceWorker.register('sw.js');
    const show = () => { if (registration.waiting) { $('updateBanner').hidden = false; updateVersionButton(); } };
    show(); registration.addEventListener('updatefound', () => registration.installing?.addEventListener('statechange', show));
    let refreshing = false;
    navigator.serviceWorker.addEventListener('controllerchange', () => { if (!refreshing && $('updateBanner').hidden === false) { refreshing = true; location.reload(); } });
  } catch { toast('Offline-Vorbereitung ist fehlgeschlagen. Die App funktioniert online weiter.', true); }
}

async function boot() {
  if (!store.loadError && !store.state.initialized) {
    try {
      const response = await fetch('recipes.json'); if (!response.ok) throw new Error('Beispielmenü konnte nicht geladen werden.');
      const result = importMenu(await response.text()); if (result.errors.length) throw new Error(result.errors[0].message);
      store.activate(result.document);
    } catch (error) { toast(error.message, true); }
  }
  render(); tick(); if (store.migrated) toast('Rezepte und Fortschritt übernommen. Du kannst direkt kochen; Handarbeit ohne Zeit bestätigst du selbst.');
  setInterval(tick, 1000); await registerWorker();
}
void boot();
