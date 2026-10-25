import { importMenu, validateDocument } from '../data/validate.js';
import { newSession, hasProgress } from './state.js';
import { validTimer } from './timers.js';

export const STORAGE_KEY = 'chef.workspace.v2';
export function snapshot(document) {
  return { document, session: newSession(), checks: { bought: {}, pantry: {}, ready: {}, equipment: {} }, createdAt: Date.now() };
}
export function inspectBackup(backup) {
  if (backup?.kind !== 'chef-backup' || backup.version !== 2 || backup.state?.version !== 2 || !Array.isArray(backup.state.archive) || backup.state.archive.length > 30) throw new Error('Keine unterstützte CHEF-Datensicherung.');
  for (const entry of backup.state.archive) if (!entry || typeof entry.id !== 'string' || typeof entry.favorite !== 'boolean' || !Number.isFinite(entry.savedAt) || !entry.snapshot) throw new Error('Ein Archivstand ist ungültig.');
  const snapshots = [backup.state.current, ...backup.state.archive.map(a => a.snapshot)].filter(Boolean);
  for (const current of snapshots) {
    const validation = validateDocument(current.document);
    if (validation.errors.length) throw new Error(`Ungültiges Menü in der Datensicherung: ${validation.errors[0].message}`);
    const session = current.session;
    const object = value => !!value && typeof value === 'object' && !Array.isArray(value);
    if (!session || !object(session.tasks) || !object(session.timers) || !object(session.bindings) || !object(session.packing) || !object(session.legacyTimers) || !Array.isArray(session.events) || !object(current.checks) || typeof session.note !== 'string') throw new Error('Fortschritt oder Checklisten der Sicherung sind unvollständig.');
    for (const key of ['bought', 'pantry', 'ready', 'equipment']) if (!current.checks[key] || typeof current.checks[key] !== 'object') throw new Error('Eine Checkliste der Sicherung fehlt.');
    for (const timer of [...Object.values(session.timers), ...Object.values(session.legacyTimers || {})]) if (!validTimer(timer)) throw new Error('Ein Timer der Sicherung ist ungültig.');
    for (const record of Object.values(session.tasks)) if (!record || !['running', 'elapsed', 'completed', 'skipped', 'pending'].includes(record.status)) throw new Error('Ein Schrittzustand der Sicherung ist ungültig.');
    for (const allocations of Object.values(session.bindings)) if (!Array.isArray(allocations) || allocations.some(a => {
      if (!a || typeof a.resourceId !== 'string' || !Number.isInteger(a.units) || a.units < 1) return true;
      const person = /^@cook\/([1-8])$/.exec(a.resourceId);
      return person ? a.units !== 1 || Number(person[1]) > current.document.kitchen.cooks : !current.document.kitchen.resources.some(r => r.id === a.resourceId && r.capacity >= a.units);
    })) throw new Error('Eine Gerätebindung der Sicherung ist ungültig.');
    for (const [id, packing] of Object.entries(session.packing)) {
      if (!current.document.recipes.some(r => r.id === id) || !object(packing)) throw new Error('Behälterdaten der Sicherung sind ungültig.');
      if (packing.massG != null && (!Number.isFinite(packing.massG) || packing.massG <= 0 || packing.massG > 1000000)) throw new Error('Ein Portionsgewicht der Sicherung ist ungültig.');
      if (packing.packed != null && typeof packing.packed !== 'boolean') throw new Error('Ein Behälterzustand der Sicherung ist ungültig.');
      for (const date of ['frozenAt', 'thawedAt']) if (packing[date] != null && !Number.isFinite(packing[date])) throw new Error('Ein Lagerungsdatum der Sicherung ist ungültig.');
    }
  }
  return backup.state;
}
export function createStore(storage) {
  let state = { version: 2, current: null, archive: [], initialized: false };
  const listeners = new Set();
  let loadError = null, migrated = false, lastSaved = null;
  try {
    const saved = storage.getItem(STORAGE_KEY);
    if (saved != null) {
      const parsed = JSON.parse(saved);
      inspectBackup({ kind: 'chef-backup', version: 2, state: parsed });
      if (parsed?.version !== 2 || !Array.isArray(parsed.archive) || parsed.archive.length > 30) throw new Error('Unbekannter gespeicherter Zustand.');
      if (parsed.current) {
        if (validateDocument(parsed.current.document).errors.length) throw new Error('Gespeicherte Rezeptdaten sind beschädigt.');
        const s = parsed.current.session;
        if (!s || typeof s.tasks !== 'object' || typeof s.timers !== 'object' || typeof s.bindings !== 'object' || !Array.isArray(s.events)) throw new Error('Gespeicherter Kochfortschritt ist beschädigt.');
        s.legacyTimers ||= {}; s.packing ||= {};
        for (const timer of [...Object.values(s.timers), ...Object.values(s.legacyTimers)]) if (!validTimer(timer)) throw new Error('Ein gespeicherter Timer ist beschädigt.');
      }
      state = parsed;
    } else {
      const legacy = storage.getItem('batchcooking_recipes');
      if (legacy != null) {
        const old = JSON.parse(legacy);
        state.initialized = true;
        if (old?.recipes?.length) {
          const result = importMenu(legacy);
          if (result.errors.length) throw new Error('Die Daten aus der Altversion brauchen eine Reparatur.');
          state.current = snapshot(result.document);
          const rawProgress = storage.getItem('batchcooking_cook_state');
          const rawChecks = storage.getItem('batchcooking_mise_checks');
          state.legacyBackup = { recipes: legacy, cook: rawProgress, mise: rawChecks };
          if (rawProgress) {
            const progress = JSON.parse(rawProgress);
            const ids = old.recipes.slice(0, 2).map(r => r.id || r.name || '?').join('+');
            if (progress?.sig === `${old.week || '?'}|${ids}`) {
              for (const [id, t] of Object.entries(progress.timers || {})) if (Number.isFinite(t.endsAt)) {
                state.current.session.legacyTimers[id] = { endsAt: t.endsAt, durationSeconds: Number(t.duration) || 60,
                  state: t.endsAt <= Date.now() ? 'elapsed' : 'running', label: `Übernommener Timer · ${id}` };
              }
              state.current.legacyProgress = progress;
            }
          }
          // Old keys remain intact. Migration is committed as one new snapshot.
          storage.setItem(STORAGE_KEY, JSON.stringify(state)); migrated = true;
        }
      }
    }
    lastSaved = storage.getItem(STORAGE_KEY);
  } catch (error) { loadError = error.message; }
  return {
    get state() { return state; }, get loadError() { return loadError; }, migrated,
    subscribe(fn) { listeners.add(fn); return () => listeners.delete(fn); },
    commit(update) {
      if (loadError) throw new Error('Gespeicherte Daten zuerst sichern und über die Wiederherstellung öffnen.');
      if (storage.getItem(STORAGE_KEY) !== lastSaved) throw new Error('Der Stand wurde in einem anderen Tab geändert. Diesen Tab neu laden, bevor du weitermachst.');
      const next = structuredClone(state);
      update(next);
      // setItem is atomic: if quota/access fails, neither stored nor live state changes.
      const serialized = JSON.stringify(next);
      if (storage.getItem(STORAGE_KEY) !== lastSaved) throw new Error('Der Stand wurde in einem anderen Tab geändert. Diesen Tab neu laden.');
      try { storage.setItem(STORAGE_KEY, serialized); }
      catch { throw new Error('Speichern fehlgeschlagen. Speicherplatz oder Browserzugriff prüfen. Der vorherige Stand bleibt erhalten.'); }
      lastSaved = serialized; state = next; for (const fn of listeners) fn(state); return state;
    },
    activate(document) {
      const validation = validateDocument(document);
      if (validation.errors.length) throw new Error(validation.errors[0].message);
      return this.commit(next => {
        if (next.current) {
          if (next.archive.length >= 30) throw new Error('Das Archiv ist voll. Zuerst einen alten Eintrag entfernen oder exportieren.');
          next.archive.unshift({ id: crypto.randomUUID(), savedAt: Date.now(), favorite: false, snapshot: next.current });
        }
        next.current = snapshot(document); next.initialized = true;
      });
    },
    changeDocument(update) {
      return this.commit(next => {
        if (!next.current) throw new Error('Kein Menü geladen.');
        if (hasProgress(next.current.session)) throw new Error('Während eines begonnenen Kochvorgangs bleiben Rezepte und Geräte fest. Zuerst den Vorgang archivieren und neu starten.');
        update(next.current.document);
        const validation = validateDocument(next.current.document);
        if (validation.errors.length) throw new Error(validation.errors[0].message);
        next.current.checks.ready = {}; next.current.checks.equipment = {};
      });
    },
    restore(id) {
      return this.commit(next => {
        const index = next.archive.findIndex(a => a.id === id);
        if (index < 0) throw new Error('Archivierter Eintrag fehlt.');
        const entry = next.archive[index];
        if (validateDocument(entry.snapshot.document).errors.length) throw new Error('Archiviertes Menü ist ungültig.');
        next.archive.splice(index, 1);
        if (next.current) next.archive.unshift({ id: crypto.randomUUID(), savedAt: Date.now(), favorite: false, snapshot: next.current });
        next.current = entry.snapshot;
      });
    },
    restoreBackup(backup) {
      const incoming = structuredClone(inspectBackup(backup));
      return this.commit(next => {
        const retained = next.current;
        if (retained && incoming.archive.length >= 30) throw new Error('Die Sicherung hat bereits 30 Archivstände. Zuerst einen Eintrag in einer Kopie der Sicherung entfernen.');
        Object.assign(next, incoming);
        if (retained) next.archive.unshift({ id: crypto.randomUUID(), savedAt: Date.now(), favorite: false, snapshot: retained });
        next.initialized = true;
      });
    },
    startAgain() {
      if (!state.current) throw new Error('Kein Menü geladen.');
      return this.activate(state.current.document);
    },
    clearCurrent() {
      return this.commit(next => {
        if (next.current) {
          if (next.archive.length >= 30) throw new Error('Archiv voll. Zuerst einen Eintrag entfernen.');
          next.archive.unshift({ id: crypto.randomUUID(), savedAt: Date.now(), favorite: false, snapshot: next.current });
        }
        next.current = null; next.initialized = true;
      });
    }
  };
}
