import { readiness, canWaitForTimer } from '../planning/scheduler.js';
import { timerRemainingMs } from './timers.js';

export function newSession() {
  return { id: globalThis.crypto.randomUUID(), startedAt: null, cookedAt: null, tasks: {}, timers: {}, bindings: {},
    legacyTimers: {}, packing: {}, note: '', events: [] };
}
export const hasProgress = session => !!session && (Object.keys(session.tasks).length > 0 || Object.values(session.legacyTimers || {}).some(t => !['acknowledged', 'cancelled'].includes(t.state)));
export const isComplete = (graph, session) => !!graph && graph.tasks.every(t => session.tasks[t.id]?.status === 'completed');
export function reduceSession(graph, current, action, now = Date.now()) {
  const session = structuredClone(current);
  const task = graph?.byId.get(action.id);
  const record = session.tasks[action.id];
  const timer = session.timers[action.id];
  const log = type => { session.events.push({ type, taskId: action.id || null, at: now }); };
  if (action.type === 'TICK') {
    let changed = false;
    for (const [id, t] of Object.entries(session.timers)) if (t.state === 'running' && t.endsAt <= now) {
      t.state = 'elapsed'; if (session.tasks[id]?.status === 'running') session.tasks[id].status = 'elapsed'; changed = true;
    }
    for (const t of Object.values(session.legacyTimers)) if (t.state === 'running' && t.endsAt <= now) { t.state = 'elapsed'; changed = true; }
    return changed ? session : current;
  }
  if (action.type === 'ACK_LEGACY') {
    const t = session.legacyTimers[action.id]; if (!t) throw new Error('Timer fehlt.');
    t.state = 'acknowledged'; t.endsAt ??= now; delete t.remainingMs; log(action.type); return session;
  }
  if (!task && !['NOTE', 'PACKING'].includes(action.type)) throw new Error('Aufgabe nicht gefunden.');
  switch (action.type) {
    case 'START': {
      const available = readiness(graph, session, task.id);
      if (!available.ready) throw new Error(available.reason);
      for (const allocation of available.allocations) {
        if (!session.bindings[allocation.holdId]) session.bindings[allocation.holdId] = [];
        session.bindings[allocation.holdId].push({ resourceId: allocation.resourceId, units: allocation.units });
      }
      session.startedAt ??= now;
      session.tasks[task.id] = { status: 'running', startedAt: now, completedAt: null };
      if (!task.untimed && action.startTimer !== false) session.timers[task.id] = { endsAt: now + task.durationSeconds * 1000, durationSeconds: task.durationSeconds, state: 'running' };
      break;
    }
    case 'COMPLETE':
      if (!record || !['running', 'elapsed'].includes(record.status)) throw new Error('Den Schritt zuerst starten.');
      if (task.mode === 'passive' && timerRemainingMs(timer, now) > 0 && !action.confirmEarly) throw new Error('Der Timer ist noch nicht beendet. Vorzeitigen Abschluss ausdrücklich bestätigen.');
      record.status = 'completed'; record.completedAt = now;
      if (timer) { timer.state = 'acknowledged'; timer.endsAt ??= now; delete timer.remainingMs; }
      if (isComplete(graph, session)) session.cookedAt = now;
      break;
    case 'WAIT_FOR_TIMER':
      if (!canWaitForTimer(graph, session, task.id)) throw new Error('Diesen Handgriff einschließlich nötiger Reinigung zuerst abschließen.');
      record.waitingForTimer = true;
      break;
    case 'SKIP':
      if (record && record.status !== 'pending' && record.status !== 'skipped') throw new Error('Laufende Schritte können nicht übersprungen werden.');
      session.tasks[task.id] = { status: 'skipped', startedAt: null, completedAt: null };
      break;
    case 'RESTORE':
      if (record?.status !== 'skipped') throw new Error('Dieser Schritt ist nicht übersprungen.');
      delete session.tasks[task.id]; break;
    case 'ACK':
      if (!timer || !['elapsed', 'acknowledged'].includes(timer.state)) throw new Error('Dieser Timer ist noch nicht abgelaufen.');
      timer.state = 'acknowledged'; break;
    case 'ADJUST':
      if (!timer || record?.status === 'completed') throw new Error('Kein laufender Schritt-Timer.');
      if (!Number.isFinite(action.seconds) || Math.abs(action.seconds) > 86400) throw new Error('Ungültige Timeränderung.');
      timer.durationSeconds = Math.max(1, timer.durationSeconds + action.seconds);
      if (timer.state === 'paused') timer.remainingMs = Math.max(1000, timer.remainingMs + action.seconds * 1000);
      else { timer.endsAt = Math.max(now + 1000, timer.endsAt + action.seconds * 1000); timer.state = 'running'; }
      record.status = 'running'; break;
    case 'PAUSE_TIMER': {
      if (!timer || timer.state !== 'running' || !record || record.status !== 'running') throw new Error('Kein laufender Timer zum Pausieren.');
      const remainingMs = timerRemainingMs(timer, now);
      if (remainingMs === 0) { timer.state = 'elapsed'; record.status = 'elapsed'; }
      else { timer.state = 'paused'; timer.remainingMs = remainingMs; timer.endsAt = null; }
      break;
    }
    case 'RESUME_TIMER':
      if (!timer || timer.state !== 'paused' || !record || record.status !== 'running') throw new Error('Kein pausierter Timer zum Fortsetzen.');
      timer.endsAt = now + timer.remainingMs; timer.state = 'running'; delete timer.remainingMs; break;
    case 'RESTART_TIMER':
      if (!record || !['running', 'elapsed'].includes(record.status)) throw new Error('Kein laufender Schritt.');
      if (!Number.isInteger(action.seconds) || action.seconds < 1 || action.seconds > 86400) throw new Error('Timerdauer muss zwischen einer Sekunde und 24 Stunden liegen.');
      session.timers[task.id] = { endsAt: now + action.seconds * 1000, durationSeconds: action.seconds, state: 'running' };
      record.status = 'running'; break;
    case 'NOTE': session.note = String(action.value).slice(0, 2000); break;
    case 'PACKING':
      session.packing[action.recipeId] = { ...session.packing[action.recipeId], ...action.value }; break;
    default: throw new Error('Unbekannte Aktion.');
  }
  log(action.type);
  return session;
}

export function timerRows(session, graph) {
  const regular = Object.entries(session.timers).filter(([id, t]) => t.state !== 'cancelled'
    && (t.state !== 'acknowledged' || session.tasks[id]?.status !== 'completed'))
    .map(([id, t]) => ({ id, ...t, legacy: false, label: graph?.byId.get(id)?.shortLabel || id,
      recipeNames: graph?.byId.get(id)?.recipeNames || [], mode: graph?.byId.get(id)?.mode }));
  const legacy = Object.entries(session.legacyTimers).filter(([, t]) => !['acknowledged', 'cancelled'].includes(t.state))
    .map(([id, t]) => ({ id, ...t, legacy: true, label: t.label || `Gespeicherter Timer: ${id}`, recipeNames: ['Altversion'] }));
  return [...regular, ...legacy];
}
