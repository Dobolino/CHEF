const done = record => record?.status === 'completed';
const busy = record => record && ['running', 'elapsed'].includes(record.status);
const sameSettings = (a, b) => !a && !b || a && b && a.temperatureC === b.temperatureC && a.mode === b.mode;

export function allocationsFor(graph, taskId, locks, bindings = {}) {
  const acquired = [], temporary = [...locks];
  for (const hold of graph.holds.filter(h => h.fromTask === taskId)) {
    if (temporary.some(lock => lock.holdId === hold.id)) continue;
    let remaining = hold.units;
    const choices = [];
    const candidates = [...graph.kitchen.resources].filter(resource => resource.kind === hold.kind
      && (!hold.minVolumeMl || (resource.volumeMl || 0) >= hold.minVolumeMl)
      && (!hold.ovenSettings || resource.supportedModes?.includes(hold.ovenSettings.mode)))
      .sort((a, b) => a.id.localeCompare(b.id));
    const pinned = bindings[hold.id];
    for (const resource of candidates) {
      const existing = temporary.filter(lock => lock.resourceId === resource.id);
      if (hold.ovenSettings && existing.some(lock => !sameSettings(lock.ovenSettings, hold.ovenSettings))) continue;
      const free = resource.capacity - existing.reduce((n, lock) => n + lock.units, 0);
      const fixed = pinned?.find(a => a.resourceId === resource.id)?.units || 0;
      const take = Math.min(remaining, pinned ? fixed : free);
      if (!take || take > free) continue;
      choices.push({ holdId: hold.id, resourceId: resource.id, units: take, ovenSettings: hold.ovenSettings || null });
      remaining -= take;
      if (!remaining) break;
    }
    if (remaining) return null;
    acquired.push(...choices); temporary.push(...choices);
  }
  return acquired;
}

export function runtimeLocks(graph, session) {
  const locks = [];
  for (const hold of graph.holds) {
    const first = session.tasks[hold.fromTask], last = session.tasks[hold.throughTask];
    if (first?.startedAt == null || done(last)) continue;
    for (const allocation of session.bindings[hold.id] || []) locks.push({ ...allocation, holdId: hold.id, ovenSettings: hold.ovenSettings || null });
  }
  return locks;
}

export function readiness(graph, session, taskId) {
  const task = graph.byId.get(taskId);
  if (!task) return { ready: false, reason: 'Aufgabe fehlt.' };
  const record = session.tasks[taskId];
  if (done(record)) return { ready: false, reason: 'Bereits erledigt.' };
  if (record?.status === 'skipped') return { ready: false, reason: 'Den übersprungenen Schritt zuerst wieder öffnen.' };
  if (busy(record)) return { ready: false, reason: 'Bereits gestartet.' };
  const missing = task.dependsOn.filter(id => !done(session.tasks[id]));
  if (missing.length) return { ready: false, reason: `Wartet auf: ${missing.map(id => graph.byId.get(id).shortLabel).join(', ')}` };
  if (task.mode === 'active' && graph.tasks.filter(t => t.mode === 'active' && busy(session.tasks[t.id])).length >= graph.kitchen.cooks) return { ready: false, reason: 'Zuerst die laufende Handarbeit bestätigen.' };
  const allocations = allocationsFor(graph, task.id, runtimeLocks(graph, session), session.bindings);
  if (!allocations) {
    const cleaning = graph.holds.some(h => h.kind === 'attention' && h.throughTask.endsWith('~clean') && done(session.tasks[h.fromTask]) && !done(session.tasks[h.throughTask]));
    return { ready: false, reason: cleaning ? 'Nach der Rohvorbereitung zuerst Brett, Messer und Hände reinigen.' : 'Benötigte Geräte oder Personen sind noch belegt.' };
  }
  return { ready: true, allocations, reason: '' };
}

function simulate(graph, session, now, variant) {
  const records = session?.tasks || {};
  const completed = new Set(graph.tasks.filter(t => done(records[t.id])).map(t => t.id));
  const skipped = new Set(graph.tasks.filter(t => records[t.id]?.status === 'skipped').map(t => t.id));
  const started = new Set(completed);
  let locks = session ? runtimeLocks(graph, session) : [];
  const reservations = locks.map(lock => ({ ...lock, start: 0, end: null }));
  const running = [], entries = [];
  let time = 0, active = 0;
  const bindings = session?.bindings || {};
  for (const task of graph.tasks.filter(t => busy(records[t.id]))) {
    const timer = session.timers[task.id];
    const end = Math.max(0, timer && timer.state !== 'cancelled' ? Math.ceil((timer.endsAt - now) / 1000) : task.durationSeconds);
    started.add(task.id); running.push({ task, end }); if (task.mode === 'active') active++;
    entries.push({ taskId: task.id, start: 0, end, resourceIds: [...new Set(locks.filter(l => {
      const hold = graph.holds.find(h => h.id === l.holdId); return hold && (hold.fromTask === task.id || !done(records[hold.throughTask]));
    }).map(l => l.resourceId))], resumed: true });
  }
  let serialRecipe = null;
  for (let guard = 0; completed.size < graph.tasks.length && guard < graph.tasks.length * 4 + 16; guard++) {
    for (let i = running.length - 1; i >= 0; i--) if (running[i].end <= time) {
      const task = running[i].task;
      completed.add(task.id); if (task.mode === 'active') active--;
      const released = new Set(graph.holds.filter(h => h.throughTask === task.id).map(h => h.id));
      for (const booking of reservations) if (released.has(booking.holdId) && booking.end == null) booking.end = time;
      locks = locks.filter(l => !released.has(l.holdId)); running.splice(i, 1);
    }
    if (variant === 'serial') serialRecipe = graph.recipeOrder.find(id => graph.tasks.some(t => t.recipeIds.includes(id) && !completed.has(t.id))) || null;
    const ownedRecipes = new Set(locks.flatMap(l => {
      const hold = graph.holds.find(h => h.id === l.holdId); return hold ? [hold.recipeId] : [];
    }));
    const ready = graph.tasks.filter(t => !started.has(t.id) && !skipped.has(t.id) && t.dependsOn.every(id => completed.has(id))
      && (variant !== 'serial' || t.recipeIds.includes(serialRecipe)));
    ready.sort((a, b) => {
      if (variant === 'owned') {
        const owned = Number(b.recipeIds.some(id => ownedRecipes.has(id))) - Number(a.recipeIds.some(id => ownedRecipes.has(id)));
        if (owned) return owned;
      }
      if (variant === 'passive') { const passive = Number(b.mode === 'passive') - Number(a.mode === 'passive'); if (passive) return passive; }
      if (variant !== 'serial') { const rank = graph.critical.get(b.id) - graph.critical.get(a.id); if (rank) return rank; }
      return a.id.localeCompare(b.id);
    });
    let progress = false;
    for (const task of ready) {
      if (task.mode === 'active' && active >= graph.kitchen.cooks) continue;
      const allocations = allocationsFor(graph, task.id, locks, bindings);
      if (!allocations) continue;
      locks.push(...allocations); started.add(task.id); if (task.mode === 'active') active++;
      reservations.push(...allocations.map(allocation => ({ ...allocation, start: time, end: null })));
      const end = time + task.durationSeconds;
      running.push({ task, end });
      const resourceIds = [...new Set(locks.filter(l => graph.holds.some(h => h.id === l.holdId &&
        (h.fromTask === task.id || task.recipeIds.includes(h.recipeId)))).map(l => l.resourceId))];
      entries.push({ taskId: task.id, start: time, end, resourceIds }); progress = true;
    }
    if (completed.size === graph.tasks.length) break;
    if (running.length) time = Math.min(...running.map(r => r.end));
    else if (!progress) return null;
  }
  if (completed.size !== graph.tasks.length) return null;
  return { entries: entries.sort((a, b) => a.start - b.start || a.taskId.localeCompare(b.taskId)),
    totalSeconds: Math.max(0, ...entries.map(e => e.end)), reservations, variant };
}

export function plan(graph, { session = null, now = Date.now() } = {}) {
  const candidates = ['critical', 'owned', 'passive', 'serial'].map(variant => simulate(graph, session, now, variant)).filter(Boolean);
  if (!candidates.length) throw new Error('Kein ausführbarer Ablauf gefunden. Prüfe übersprungene Vorgänger, Gerätebelegungen und Ofentemperaturen. Mehr passende Geräte oder kürzere Reservierungen können helfen.');
  return candidates.sort((a, b) => a.totalSeconds - b.totalSeconds)[0];
}
