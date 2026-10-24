import { formatQuantity, number, shoppingList } from '../data/units.js';
import { readiness } from '../planning/scheduler.js';
import { hasProgress, isComplete } from '../session/state.js';

export const esc = value => String(value ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
export const COLORS = ['#4c8dff', '#ff5c5c', '#35d0ba', '#d5a5ff', '#ffd27b', '#91d5ff'];
export const duration = seconds => {
  if (seconds < 60) return `${Math.max(0, Math.ceil(seconds))} Sek.`;
  const minutes = Math.ceil(seconds / 60), hours = Math.floor(minutes / 60), rest = minutes % 60;
  return hours ? `${hours} Std.${rest ? ` ${rest} Min.` : ''}` : `${minutes} Min.`;
};
export const countdown = seconds => { const s = Math.max(0, Math.ceil(seconds)); return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`; };
const taskDuration = task => task.untimed ? 'ohne Zeitvorgabe' : duration(task.durationSeconds);
export const date = timestamp => Number.isFinite(timestamp) ? new Intl.DateTimeFormat('de-CH', { dateStyle: 'medium', timeStyle: 'short' }).format(timestamp) : 'noch nicht abgeschlossen';
const action = (name, label, attrs = '', style = '') => `<button data-action="${name}" ${attrs} class="${style}">${label}</button>`;
const link = (route, label, style = '') => `<button data-route="${route}" class="${style}">${label}</button>`;
const heading = (eyebrow, title, subtitle, actions = '') => `<div class="heading"><div><div class="eyebrow">${esc(eyebrow)}</div><h1>${esc(title)}</h1><p>${esc(subtitle)}</p></div><div class="actions">${actions}</div></div>`;
const recipeColor = (document, id) => COLORS[Math.max(0, document.recipes.findIndex(r => r.id === id)) % COLORS.length];
export function issues(result) {
  const manual = result.warnings.some(i => i.code === 'UNTIMED_ACTIVE');
  const items = [...result.errors, ...result.blockers, ...result.warnings.filter(i => i.code !== 'UNTIMED_ACTIVE')];
  if (!manual && !items.length) return '';
  return `<div class="${result.errors.length ? 'error' : items.length ? 'warning' : 'notice'}">${manual ? '<p>Handarbeit ohne Zeitvorgabe bestätigst du mit „Erledigt“. Die Gesamtdauer ist dann nur grob geschätzt.</p>' : ''}${items.length ? `<ul class="issues">${items.slice(0, 30).map(i => `<li>${esc(i.message)}</li>`).join('')}</ul>` : ''}</div>`;
}
export function emptyMenu() {
  return heading('Wochenmenü', 'Was kochst du am Sonntag?', 'Rezepte laden, Portionen wählen und gemeinsam planen.') +
    `<div class="empty"><h2>Dein nächster Kochabend beginnt hier.</h2><p>Lade das Beispielmenü mit drei Gerichten oder importiere deine eigene Rezeptdatei.</p><div class="actions">${action('demo', 'Beispielmenü laden', '', 'primary')}${action('import', 'Rezepte importieren')}</div></div>`;
}
export function menuView(current, graph, forecast, validation) {
  const doc = current.document, selected = new Map(doc.selection.map(s => [s.recipeId, s.servings])), progress = hasProgress(current.session);
  const total = doc.selection.reduce((n, s) => n + s.servings, 0);
  return heading(doc.week || 'Wochenmenü', doc.title || 'Deine Woche ist vorbereitet.', 'Gerichte und Portionen wählen. Danach direkt loskochen.') +
    `<div class="summary"><div><strong>${forecast ? `≈ ${duration(forecast.totalSeconds)} ${progress ? 'geschätzt übrig' : 'bis zum Portionieren'}` : graph ? 'Dein Kochablauf ist bereit' : 'Noch Angaben ergänzen'}</strong><p>${doc.selection.length} Gerichte · ${total} Rezeptportionen · ${doc.kitchen.cooks} ${doc.kitchen.cooks === 1 ? 'Person kocht' : 'Personen kochen'}</p></div><div class="actions">${graph ? link('cook', progress ? 'Weiterkochen →' : 'Kochen starten →', 'primary') : action('show-missing', 'Fehlende Angaben ergänzen', '', 'primary')}</div></div>` +
    issues(validation) + (current.legacyProgress ? `<details class="notice"><summary>Gesicherter Kochfortschritt aus der Altversion</summary><p>${Object.keys(current.legacyProgress.checked || {}).length} Häkchen und der frühere Seitenstand sind zusätzlich gesichert. Über „Alle Daten sichern“ lassen sie sich exportieren. Der gemeinsame Ablauf beginnt mit den übernommenen Rezepten; alte Häkchen gelten nicht automatisch als erledigte neue Aufgaben.</p></details>` : '') + (progress ? `<div class="notice">Dein Kochvorgang bleibt gespeichert. Für Änderungen an Rezepten oder Portionen zuerst ${action('restart', 'archivieren und neu starten')}.</div>` : '') +
    `<div class="recipes">${doc.recipes.map((recipe, index) => {
      const servings = selected.get(recipe.id) ?? recipe.baseServings, nutrition = recipe.nutrition || {};
      return `<article class="recipe ${selected.has(recipe.id) ? '' : 'excluded'}" style="--recipe-color:${recipeColor(doc, recipe.id)}"><div class="recipe-body">
       <div class="recipe-top"><label class="select-recipe"><input type="checkbox" data-select-recipe="${esc(recipe.id)}" ${selected.has(recipe.id) ? 'checked' : ''} ${progress ? 'disabled' : ''}>GERICHT ${index + 1}</label><span class="pill">${recipe.storage?.freezable === true ? '❄ Einfrierbar' : recipe.storage?.freezable === false ? 'Frisch genießen' : 'Lagerung offen'}</span></div>
       <h2>${esc(recipe.name)}</h2><div class="portion-line"><span>Portionen für dieses Gericht</span><div class="stepper">${action('portion', '−', `data-id="${esc(recipe.id)}" data-delta="-1" aria-label="Weniger Portionen für ${esc(recipe.name)}" ${progress || !selected.has(recipe.id) || servings <= 1 ? 'disabled' : ''}`)}<output class="mono" aria-live="polite">${servings}</output>${action('portion', '+', `data-id="${esc(recipe.id)}" data-delta="1" aria-label="Mehr Portionen für ${esc(recipe.name)}" ${progress || !selected.has(recipe.id) || servings >= 100 ? 'disabled' : ''}`)}</div></div>
       <div class="macros"><div><strong class="mono">${nutrition.energyKcal == null ? '–' : number(nutrition.energyKcal)}</strong><small>kcal / Portion</small></div><div><strong class="mono">${nutrition.proteinG == null ? '–' : `${number(nutrition.proteinG)} g`}</strong><small>Protein / Portion</small></div></div>
       <p class="recipe-note">${esc(recipe.storage?.notes?.[0] || 'Keine geprüfte Aufbewahrungsdauer hinterlegt.')}</p><div class="recipe-foot"><span>Rezeptbasis: ${recipe.baseServings} Portionen</span><span>${recipe.ingredients.length} Zutaten · ${recipe.tasks.length} Aufgaben</span></div>
       <details ${selected.has(recipe.id) && recipe.tasks.some(t => !t.duration && t.mode === 'passive') ? 'open' : ''}><summary>Details, Zeiten & Behälter</summary><p>Weitere Nährwerte pro Portion: KH ${nutrition.carbsG == null ? '–' : `${number(nutrition.carbsG)} g`} · Fett ${nutrition.fatG == null ? '–' : `${number(nutrition.fatG)} g`} · Ballaststoffe ${nutrition.fiberG == null ? '–' : `${number(nutrition.fiberG)} g`}</p>
        <label class="field">Gemeinsam in die Boxen von<select data-combine-recipe="${esc(recipe.id)}" ${progress ? 'disabled' : ''}><option value="">Eigenständiges Gericht</option>${doc.recipes.filter(r => r.id !== recipe.id && selected.has(r.id) && !r.packaging?.combineWithRecipeId).map(r => `<option value="${esc(r.id)}" ${recipe.packaging?.combineWithRecipeId === r.id ? 'selected' : ''}>${esc(r.name)}</option>`).join('')}</select></label>
        <p>Zeiten für Handarbeit sind optional. Koch-, Back- und Wartezeiten brauchen eine Angabe für den Timer.</p>${recipe.tasks.map(t => `<div class="task-time-row"><label for="time-${esc(recipe.id)}-${esc(t.id)}">${esc(t.shortLabel || t.instruction)}<small> · ${t.mode === 'passive' ? 'Wartezeit' : 'Handarbeit'}</small></label><input id="time-${esc(recipe.id)}-${esc(t.id)}" data-task-time="${esc(t.id)}" data-recipe="${esc(recipe.id)}" ${!t.duration && t.mode === 'passive' ? 'data-required-time aria-invalid="true"' : ''} type="number" min="0.02" max="1440" step="any" value="${t.duration ? numberForInput(t.duration.seconds / 60) : ''}" placeholder="${t.mode === 'active' ? 'optional' : 'Min.'}" ${progress ? 'disabled' : ''}><small>Min.</small></div>`).join('')}
       </details></div></article>`;
    }).join('')}</div>` +
    (doc.weekNote ? `<div class="notice"><strong>Vor dem Start</strong><p>${esc(doc.weekNote)}</p></div>` : '') +
    `<details class="tools"><summary>Rezepte & Daten verwalten</summary><div class="actions">${action('import', 'JSON importieren')}${action('edit', 'Rezeptdaten bearbeiten')}${action('export', 'Menü exportieren')}${action('backup', 'Alle Daten sichern')}${action('prompt', 'Rezept-Prompt kopieren')}${action('demo', 'Beispielmenü laden')}${action('clear', 'Menü archivieren', '', 'danger')}</div></details>`;
}
function numberForInput(value) { return String(Math.round(value * 100) / 100); }
export function prepView(current, graph, forecast, validation) {
  const list = shoppingList(current.document), resources = current.document.kitchen.resources;
  const done = list.filter(i => current.checks.ready[i.key]).length + resources.filter(r => current.checks.equipment[r.id]).length;
  const total = list.length + resources.length;
  return heading('Vorbereiten · optional', 'Alles griffbereit.', 'Zutaten und Geräte nachsehen oder freiwillig abhaken. Du kannst jederzeit direkt mit dem Kochen beginnen.', link('cook', 'Direkt zum Kochen →', 'primary')) +
    `<div class="split"><div><div class="section-head"><h2>Geräte & Arbeitsplätze</h2></div><div class="checklist">${resources.map(r => `<div class="checkrow"><label><input type="checkbox" data-equipment="${esc(r.id)}" ${current.checks.equipment[r.id] ? 'checked' : ''}><span class="checktext">${esc(r.name || resourceName(r))}<small>${r.volumeMl ? `${number(r.volumeMl / 1000)} Liter` : r.kind === 'oven' ? `${r.capacity} Einschübe · ${(r.supportedModes || []).map(modeName).join(', ')}` : 'bereitgestellt'}</small></span></label></div>`).join('')}</div><div class="section-head"><h2>Zutaten bereitstellen</h2></div><div class="checklist">${list.map(i => `<div class="checkrow"><label><input type="checkbox" data-ready="${esc(i.key)}" ${current.checks.ready[i.key] ? 'checked' : ''}><span class="checktext">${esc(i.name)}</span><span class="quantity mono">${esc(formatQuantity(i.quantity))}</span></label></div>`).join('')}</div></div>
    <aside class="panel sticky"><span class="pill">${done} / ${total} bereit</span><h2 class="spaced">Bereit für den Herd?</h2><p>${forecast ? `Der gesamte Ablauf bis zum Portionieren dauert geschätzt ${duration(forecast.totalSeconds)}. Darin sind Vorbereitung und Wartezeiten enthalten.` : 'Fehlende Angaben ergänzen, damit ein belastbarer Plan entsteht.'}</p><div class="progress" role="progressbar" aria-label="Bereitgestellt" aria-valuenow="${total ? Math.round(done / total * 100) : 0}" aria-valuemin="0" aria-valuemax="100"><span style="width:${total ? done / total * 100 : 0}%"></span></div><div class="actions">${action('all-ready', 'Alles steht bereit', '', 'success')}${link('cook', 'Zum Kochmodus →', 'primary')}${link('plan', 'Gemeinsamen Zeitplan ansehen')}</div>${issues(validation)}</aside></div>`;
}
export const resourceName = r => ({ pot: 'Topf', pan: 'Pfanne', hob: 'Herdplatte', oven: 'Ofen', tray: 'Blech', board: 'Schneidebrett', knife: 'Messer', worktop: 'Arbeitsfläche', coolingSpace: 'Kühlplatz' }[r.kind] || r.kind) + ` · ${r.id}`;
const modeName = mode => ({ fan: 'Umluft', topBottom: 'Ober-/Unterhitze', grill: 'Grill' }[mode] || mode);
export function completedCount(graph, session) { return graph?.tasks.filter(t => session.tasks[t.id]?.status === 'completed').length || 0; }
function taskState(task, session) {
  const status = session.tasks[task.id]?.status;
  return { completed: 'Erledigt', skipped: 'Übersprungen', running: 'Läuft', elapsed: 'Prüfen & bestätigen' }[status] || (task.mode === 'passive' ? 'Wartezeit' : 'Handarbeit');
}
function taskRows(tasks, session, graph) {
  return tasks.map((t, index) => `<div class="task-item ${session.tasks[t.id]?.status === 'completed' ? 'done' : ''}"><span class="idx mono">${session.tasks[t.id]?.status === 'completed' ? '✓' : String(index + 1).padStart(2, '0')}</span>${action('select-task', `${esc(t.shortLabel)}<small>${esc(t.recipeNames.join(' + '))} · ${taskDuration(t)} · ${esc(taskState(t, session))}</small>`, `data-id="${esc(t.id)}"`)}</div>`).join('');
}
export function cookView(current, graph, forecast, selectedTaskId, voice, validation) {
  const session = current.session;
  if (!graph) return heading('Kochen', 'Noch kurz ergänzen.', 'Ergänze die markierten Angaben, damit dein Ablauf starten kann.') + issues(validation) + action('show-missing', 'Fehlende Angaben ergänzen', '', 'primary');
  if (isComplete(graph, session)) return heading('Geschafft', 'Dein Menü ist gekocht.', 'Alle Aufgaben sind ausdrücklich abgeschlossen.') + `<div class="summary"><div><strong>Jetzt portionieren und beschriften.</strong><p>Zubereitet: ${date(session.cookedAt)}</p></div>${link('finish', 'Behälter & Lagerung →', 'success')}</div>`;
  const pending = forecast?.entries.map(e => graph.byId.get(e.taskId)) || graph.tasks;
  const task = graph.byId.get(selectedTaskId) || pending.find(t => readiness(graph, session, t.id).ready) || pending[0] || graph.tasks[0];
  const record = session.tasks[task.id], timer = session.timers[task.id], available = readiness(graph, session, task.id);
  const completed = record?.status === 'completed', skipped = record?.status === 'skipped', running = record && ['running', 'elapsed'].includes(record.status);
  return heading('Kochmodus', 'Jetzt kochen.', `${completedCount(graph, session)} von ${graph.tasks.length} Aufgaben erledigt`,
    `${link('plan', 'Alle Schritte')}${link('prep', 'Zutaten nachsehen')}`) + `<p class="muted" data-live-eta>${forecast ? `≈ ${duration(forecast.totalSeconds)} geschätzt übrig` : ''}</p>` +
    `<div class="cook-layout"><div><article class="cook-card" style="--recipe-color:${recipeColor(current.document, task.recipeIds[0])}"><div class="cook-head"><span class="pill ${record?.status === 'elapsed' ? 'warn' : ''}">${esc(taskState(task, session))}</span><div class="actions">${action('speak', 'Vorlesen', `data-id="${esc(task.id)}"`)}${voice ? action('voice', 'Sprachbefehl', `data-id="${esc(task.id)}"`) : ''}</div></div><span class="tag">${esc(task.recipeNames.join(' + '))}${task.batchCount > 1 ? ` · Durchgang ${task.batchIndex}/${task.batchCount}` : ''}</span><h2 class="cook-instruction">${esc(task.instruction)}</h2>${task.sourceText ? `<div class="notice">Originalanleitung aus dem Altformat. Mengen im Text gelten für die Rezeptbasis; verwende für deine Portionen die angezeigten Mengen-Chips.</div>` : ''}
      ${task.uses.length ? `<div class="ingredient-chips">${task.uses.map(u => `<span class="ingredient-chip"><strong>${esc(formatQuantity(u.quantity))}</strong> ${esc(u.name)}${task.recipeIds.length > 1 ? `<small>für ${esc(current.document.recipes.find(r => r.id === u.recipeId)?.name)}</small>` : ''}${u.note ? `<small>${esc(u.note)}</small>` : ''}</span>`).join('')}</div>` : ''}
      ${task.tip ? `<details><summary>Tipp & Hinweise</summary><p>${esc(task.tip)}</p></details>` : ''}
      ${!running && !completed && !skipped && !available.ready ? `<div class="notice">${esc(available.reason)}</div>` : ''}
      ${running ? `${timer ? `<div class="timer-controls"><output class="big-timer mono" data-main-timer="${esc(task.id)}" aria-label="Restzeit">${countdown((timer?.endsAt - Date.now()) / 1000)}</output>${action('adjust-timer', '−1 Min.', `data-id="${esc(task.id)}" data-seconds="-60"`)}${action('adjust-timer', '+1 Min.', `data-id="${esc(task.id)}" data-seconds="60"`)}</div>` : '<div class="notice">Ohne Zeitvorgabe: Führe den Schritt in deinem Tempo aus und bestätige ihn anschließend.</div>'}<p class="muted">${task.mode === 'passive' ? 'Der Timer erinnert ans Prüfen. Geräte werden erst nach dem vorgesehenen Abschlussschritt frei.' : timer ? 'Handarbeit bleibt aktiv, bis du sie bestätigst. Der Timer ist eine Orientierung.' : 'Handarbeit bleibt aktiv, bis du sie bestätigst.'}</p>${action('complete-task', task.mode === 'passive' ? 'Geprüft & erledigt ✓' : 'Erledigt & weiter ✓', `data-id="${esc(task.id)}"`, 'primary cook-primary')}${task.mode === 'passive' ? action('next-ready', 'Währenddessen weiter →', '', 'full spaced') : ''}`
        : completed ? `<div class="notice">Dieser Schritt ist abgeschlossen.</div>${action('next-ready', 'Nächsten verfügbaren Schritt zeigen', '', 'primary cook-primary')}`
        : skipped ? `<div class="warning">Übersprungen. Abhängige Schritte warten weiter, bis du diesen Schritt nachholst.</div>${action('restore-task', 'Schritt wieder öffnen', `data-id="${esc(task.id)}"`, 'primary cook-primary')}`
        : `${action('start-task', task.mode === 'passive' ? `Timer starten · ${duration(task.durationSeconds)}` : task.untimed ? 'Schritt starten' : `Schritt starten · ${duration(task.durationSeconds)}`, `data-id="${esc(task.id)}" ${available.ready ? '' : 'disabled'}`, 'primary cook-primary')}<div class="actions spaced">${action('skip-task', 'Für später überspringen', `data-id="${esc(task.id)}"`, 'ghost')}</div>`}
     </article>${voice ? `<details><summary>Sprachbefehle</summary><p>„Wiederholen“, „erledigt“, „weiter“, „eine Minute mehr“. Die Erkennung wird nur per Tastendruck aktiviert. Je nach Browser verarbeitet ein externer Spracherkennungsdienst das Mikrofon-Audio.</p></details>` : ''}
     <label class="field spaced">Notiz zum Kochabend<textarea data-session-note rows="3" maxlength="2000">${esc(session.note)}</textarea></label></div>
     <aside class="panel"><h2>Dein Ablauf</h2><div class="progress"><span style="width:${completedCount(graph, session) / graph.tasks.length * 100}%"></span></div>${taskRows(pending.filter(t => session.tasks[t.id]?.status !== 'completed').slice(0, 7), session, graph)}<div class="actions spaced">${link('plan', 'Alle Aufgaben ansehen')}${link('finish', 'Abschluss prüfen')}</div></aside></div>`;
}
export function planView(current, graph, forecast, error) {
  if (!graph || !forecast) return heading('Ablaufplan', 'Plan noch nicht verfügbar.', error || 'Ergänze fehlende Angaben im Menü.') + link('overview', 'Zum Menü', 'primary');
  return heading('Gemeinsamer Ablauf', `≈ ${duration(forecast.totalSeconds)} ${hasProgress(current.session) ? 'ab jetzt' : 'insgesamt'}`, 'Gleichzeitige Zeitbereiche laufen parallel. Tatsächliche Starts und Bestätigungen bestimmen die Kochzeit.', link('cook', 'Zum Kochmodus', 'primary')) +
    `<div class="notice">${graph.tasks.some(t => t.untimed) ? 'Handarbeit ohne Zeitvorgabe läuft ohne Timer. Der Zeitplan enthält dafür grobe Richtwerte; du bestätigst jeden Schritt selbst. ' : ''}${graph.tasks.filter(t => t.recipeIds.length > 1).length} gemeinsame Vorbereitungen. ${graph.kitchen.cooks} ${graph.kitchen.cooks === 1 ? 'Person' : 'Personen'}. Zeiten sind Schätzungen; warme Geräte bleiben bis zu ihrer Freigabe belegt.</div><ol class="schedule-list">${forecast.entries.map(entry => {
      const t = graph.byId.get(entry.taskId), record = current.session.tasks[t.id];
      return `<li><span class="time mono">${countdown(entry.start)}<br>– ${countdown(entry.end)}</span><div>${action('select-task', `${esc(t.shortLabel)}<small>${esc(t.recipeNames.join(' + '))} · ${t.mode === 'passive' ? 'Wartezeit' : 'Handarbeit'}${record ? ` · ${esc(taskState(t, current.session))}` : ''}</small>`, `data-id="${esc(t.id)}"`)}${t.dependsOn.length ? `<small>Nach: ${t.dependsOn.map(id => esc(graph.byId.get(id).shortLabel)).join(' · ')}</small>` : ''}</div></li>`;
    }).join('')}</ol><details><summary>Erledigte Schritte</summary>${taskRows(graph.tasks.filter(t => current.session.tasks[t.id]?.status === 'completed'), current.session, graph)}</details>`;
}
export function archiveView(state) {
  const entries = [...state.archive].sort((a, b) => Number(b.favorite) - Number(a.favorite) || b.savedAt - a.savedAt);
  return heading('Menüarchiv', 'Gute Kochabende wiederholen.', 'Menüs samt Fortschritt bleiben lokal erhalten. Wiederherstellen tauscht den aktuellen Stand ins Archiv.', action('backup', 'Alle Daten sichern')) +
    (entries.length ? entries.map(entry => `<article class="archive-card"><div class="heading"><div><span class="eyebrow">${date(entry.savedAt)}</span><h2>${esc(entry.snapshot.document.title || entry.snapshot.document.week || 'Wochenmenü')}</h2></div>${action('favorite', entry.favorite ? '★ Favorit' : '☆ Merken', `data-id="${esc(entry.id)}" aria-pressed="${entry.favorite}"`)}</div><p>${entry.snapshot.document.recipes.map(r => esc(r.name)).join(' · ')}</p><p>${entry.snapshot.document.selection.reduce((n, s) => n + s.servings, 0)} Rezeptportionen · ${hasProgress(entry.snapshot.session) ? 'mit gespeichertem Fortschritt' : 'noch nicht begonnen'}</p><div class="actions">${action('restore-archive', 'Stand wiederherstellen', `data-id="${esc(entry.id)}"`, 'primary')}${action('reuse-archive', 'Als neuen Kochabend laden', `data-id="${esc(entry.id)}"`)}${action('delete-archive', 'Entfernen', `data-id="${esc(entry.id)}"`, 'danger')}</div></article>`).join('') : '<div class="empty"><h2>Hier wächst deine Sammlung.</h2><p>Beim Übernehmen eines neuen Menüs wird dein aktueller Stand automatisch archiviert.</p></div>');
}
export function packingPlan(document) {
  const selections = new Map(document.selection.map(s => [s.recipeId, s.servings]));
  return document.selection.map(selection => {
    const recipe = document.recipes.find(r => r.id === selection.recipeId), target = recipe.packaging?.combineWithRecipeId;
    const shared = target ? Math.min(selection.servings, selections.get(target) || 0) : 0;
    const own = selection.servings - shared;
    return { recipe, servings: selection.servings, shared, target: document.recipes.find(r => r.id === target),
      containers: own * (recipe.packaging?.containersPerServing || 1), separate: recipe.packaging?.separateComponents || [] };
  });
}
export function finishView(current, graph) {
  const completed = isComplete(graph, current.session), packing = packingPlan(current.document);
  if (!completed) return heading('Abschluss', 'Es sind noch Schritte offen.', 'Der Kochvorgang ist erst fertig, wenn alle erforderlichen Aufgaben bestätigt sind.') +
    `<div class="warning">${graph ? `${graph.tasks.length - completedCount(graph, current.session)} Aufgaben sind noch nicht abgeschlossen.` : 'Ein vollständiger Plan fehlt.'} Laufende oder quittierte Timer ersetzen keine Schrittbestätigung.</div>${link('cook', 'Weiterkochen →', 'primary')}`;
  return heading('Portionieren & aufbewahren', 'Gut gekocht. Gut vorbereitet.', `Abgeschlossen am ${date(current.session.cookedAt)}. ${packing.reduce((n, p) => n + p.containers, 0)} Hauptbehälter plus separate Komponenten.`,
    action('restart', 'Neuen Kochabend beginnen')) + packing.map(p => {
      const stored = current.session.packing[p.recipe.id] || {};
      const storage = p.recipe.storage || {}, refrigerated = storage.refrigerated;
      return `<article class="panel packing-card"><span class="pill">${p.servings} Portionen</span><h2 class="spaced">${esc(p.recipe.name)}</h2><p>${p.shared ? `${p.shared} Portionen in die Boxen von ${esc(p.target.name)} geben. ${p.containers ? `${p.containers} weitere Behälter für die übrigen Portionen.` : ''}` : `In ${p.containers} Behälter aufteilen.`}</p>${p.separate.length ? `<p>${p.separate.map(c => `${esc(c)}: ${p.servings} separate Becher`).join(' · ')}</p>` : ''}
       <div class="form-grid"><label class="field">Gekochtes Gesamtgewicht (g)<input type="number" min="1" max="1000000" step="any" data-pack-mass="${esc(p.recipe.id)}" value="${stored.massG || ''}" placeholder="optional"></label><div class="field"><span>Gewicht je Portion</span><strong class="mono">${stored.massG ? `${number(stored.massG / p.servings)} g` : '–'}</strong></div></div>
       <label class="checkrow"><input type="checkbox" data-packed="${esc(p.recipe.id)}" ${stored.packed ? 'checked' : ''}>Portioniert und beschriftet</label>
       <p>${storage.freezable === true ? '❄ Laut Rezept zum Einfrieren geeignet.' : storage.freezable === false ? 'Laut Rezept nicht zum Einfrieren vorgesehen.' : 'Gefriereignung ist nicht angegeben.'}</p>
       ${storage.notes?.map(note => `<p>${esc(note)}</p>`).join('') || ''}
       ${refrigerated ? `<div class="notice">Rezeptangabe: höchstens ${duration(refrigerated.maxHours * 3600)} nach Zubereitung, rechnerisch bis ${date(current.session.cookedAt + refrigerated.maxHours * 3600000)}. Nur unter diesen Bedingungen: ${esc(refrigerated.conditions)}<p>Quelle: ${esc(refrigerated.source)} · geprüft ${esc(refrigerated.reviewedAt)}</p></div>` : '<p class="muted">Keine geprüfte Kühlschrankdauer hinterlegt. Es wird kein Haltbarkeitsdatum geschätzt.</p>'}
       ${storage.frozen ? `<p>Gefroren laut Rezept höchstens ${storage.frozen.maxHours} Stunden: ${esc(storage.frozen.conditions)}. Quelle: ${esc(storage.frozen.source)}.</p>` : ''}
       <div class="form-grid"><label class="field">Eingefroren am<input type="datetime-local" data-pack-date="frozenAt" data-recipe="${esc(p.recipe.id)}" value="${localDate(stored.frozenAt)}"></label><label class="field">Aufgetaut am<input type="datetime-local" data-pack-date="thawedAt" data-recipe="${esc(p.recipe.id)}" value="${localDate(stored.thawedAt)}"></label></div><p class="muted">Datumsangaben dokumentieren die Lagerung. Daraus wird keine neue Haltbarkeit nach dem Auftauen abgeleitet.</p></article>`;
    }).join('');
}
function localDate(timestamp) { if (!Number.isFinite(timestamp)) return ''; const d = new Date(timestamp); return new Date(timestamp - d.getTimezoneOffset() * 60000).toISOString().slice(0, 16); }
