const UNIT = { g: 'g', kg: 'kg', ml: 'ml', l: 'l', tl: 'tsp', el: 'tbsp', stück: 'piece', zehen: 'clove', zehe: 'clove', dose: 'can', dosen: 'can', bund: 'bunch' };
const CATEGORY = { gemuese: 'produce', fleisch_fisch: 'protein', milch_ei: 'dairy', trockenes: 'dry', konserven: 'canned', gewuerze: 'spices', oele_saucen: 'oils', sonstiges: 'other' };
const KIND = { Topf: 'pot', Pfanne: 'pan', Ofen: 'oven', Arbeitsplatte: 'worktop' };
export function defaultKitchen() {
  return { cooks: 1, cleaningSeconds: 60, resources: [
    ...[1, 2].map(n => ({ id: `pot-${n}`, name: `Topf ${n}`, kind: 'pot', capacity: 1, volumeMl: 4000 })),
    ...[1, 2].map(n => ({ id: `pan-${n}`, name: `Pfanne ${n}`, kind: 'pan', capacity: 1 })),
    ...[1, 2, 3, 4].map(n => ({ id: `hob-${n}`, name: `Herdplatte ${n}`, kind: 'hob', capacity: 1 })),
    { id: 'oven-1', name: 'Ofen', kind: 'oven', capacity: 2, supportedModes: ['fan', 'topBottom'] },
    { id: 'tray-1', name: 'Blech', kind: 'tray', capacity: 1 },
    { id: 'board-1', name: 'Schneidebrett', kind: 'board', capacity: 1 },
    { id: 'knife-1', name: 'Messer', kind: 'knife', capacity: 1 },
    { id: 'worktop-1', name: 'Arbeitsfläche', kind: 'worktop', capacity: 1 }
  ] };
}
function unit(value) {
  const key = String(value || '').toLowerCase().trim();
  const result = UNIT[key] || (['tsp', 'tbsp', 'piece', 'clove', 'can', 'bunch'].includes(key) ? key : null);
  if (!result) throw new Error(`Unbekannte Einheit „${value ?? ''}“. Bitte eine eindeutige Einheit angeben.`);
  return result;
}
function quantity(amount, sourceUnit) {
  if (amount == null || amount === '') return { kind: 'unknown', note: 'Menge im alten Rezept fehlt.' };
  if (typeof amount !== 'number' || !Number.isFinite(amount) || amount <= 0) throw new Error('Mengen müssen positive Zahlen sein; Brüche als Dezimalzahl angeben.');
  return { kind: 'exact', value: amount, unit: unit(sourceUnit) };
}
export function migrateLegacy(source) {
  if (!source || !Array.isArray(source.recipes) || source.recipes.length > 32) throw new Error('Ein Menü braucht eine recipes-Liste mit höchstens 32 Rezepten.');
  const warnings = ['Altformat übernommen: Abhängigkeiten sind konservativ. Fehlende Vorbereitungszeiten bitte ergänzen.',
    'Küchenausstattung prüfen. Mengen stehen skaliert an den Schritten; Originaltexte werden nicht per Textersetzung verändert.'];
  const foods = new Map();
  const recipes = source.recipes.map((old, ri) => {
    if (!old || typeof old !== 'object' || typeof old.id !== 'string' || typeof old.name !== 'string') throw new Error(`Rezept ${ri + 1}: ID und Name fehlen.`);
    if (!Number.isInteger(old.servings) || old.servings < 1 || old.servings > 100) throw new Error(`${old.name}: Basisportionen fehlen oder sind ungültig.`);
    if (!Array.isArray(old.steps) || !old.steps.length) throw new Error(`${old.name}: Kochschritte fehlen.`);
    const ingredients = (old.ingredients || []).map(ing => {
      if (!ing || typeof ing.name !== 'string' || typeof ing.id !== 'string') throw new Error(`${old.name}: Ungültige Zutat.`);
      const key = ing.name.toLocaleLowerCase('de').normalize('NFKC').trim();
      if (!foods.has(key)) foods.set(key, `legacy-food-${foods.size + 1}`);
      return { id: ing.id, foodId: foods.get(key), name: ing.name, quantity: quantity(ing.amount, ing.unit),
        optional: !!ing.optional, category: CATEGORY[ing.category] || 'other' };
    });
    const uses = (list, role = 'transfer') => (list || []).map(u => ({ ingredientId: u.ingredientId, role,
      ...(u.amount != null ? { quantity: quantity(u.amount, u.unit || ingredients.find(i => i.id === u.ingredientId)?.quantity.unit) } : {}),
      ...(u.note ? { note: u.note } : {}) }));
    const tasks = [], reservations = [];
    let previousPrep = null;
    const prepEnds = [];
    for (const [index, prep] of (old.misEnPlace || []).entries()) {
      if (!prep || typeof prep.text !== 'string') throw new Error(`${old.name}: Vorbereitungstext fehlt.`);
      const id = prep.id || `prep-${index + 1}`;
      const active = { id, phase: 'prep', mode: 'active', instruction: prep.text, sourceText: prep.text, duration: null,
        dependsOn: previousPrep ? [previousPrep] : [], uses: uses(prep.uses, 'prepare') };
      tasks.push(active); previousPrep = id;
      if (prep.timerMinutes != null) {
        if (typeof prep.timerMinutes !== 'number' || prep.timerMinutes <= 0) throw new Error(`${old.name}: Ungültiger Vorbereitungstimer.`);
        tasks.push({ id: `${id}-wait`, phase: 'prep', mode: 'passive', instruction: `${prep.shortLabel || 'Vorbereitung'} abwarten und prüfen.`,
          duration: { seconds: Math.round(prep.timerMinutes * 60), scaling: 'fixed' }, dependsOn: [id], uses: [] });
        prepEnds.push(`${id}-wait`);
      } else prepEnds.push(id);
    }
    const orders = new Set();
    const steps = [...old.steps].sort((a, b) => a.order - b.order);
    let previous = null;
    const devices = new Map();
    for (const [index, step] of steps.entries()) {
      if (!step || typeof step.id !== 'string' || typeof step.text !== 'string') throw new Error(`${old.name}: Ungültiger Kochschritt.`);
      if (!Number.isFinite(step.order) || orders.has(step.order)) throw new Error(`${old.name}: Schritt-Reihenfolge fehlt oder ist doppelt.`);
      orders.add(step.order);
      const duration = step.timeMinutes;
      if (duration != null && (typeof duration !== 'number' || duration <= 0 || duration > 1440)) throw new Error(`${old.name}: Ungültige Kochzeit.`);
      const active = step.activeMinutes ?? duration;
      if (active != null && (typeof active !== 'number' || active < 0 || active > duration)) throw new Error(`${old.name}: Aktive Zeit muss innerhalb der Gesamtdauer liegen.`);
      const deps = previous ? [previous] : [...prepEnds];
      let first = step.id, end = step.id;
      if (active !== 0) tasks.push({ id: step.id, phase: index === steps.length - 1 ? 'pack' : 'cook', mode: 'active',
        instruction: step.text, sourceText: step.text, ...(step.tip ? { tip: step.tip } : {}),
        duration: duration == null ? null : { seconds: Math.max(1, Math.round(active * 60)), scaling: 'fixed' }, dependsOn: deps, uses: uses(step.uses) });
      if (duration != null && active < duration) {
        end = `${step.id}-wait`;
        if (active === 0) first = end;
        tasks.push({ id: end, phase: 'cook', mode: 'passive', instruction: `${step.shortLabel || step.text} – abwarten und Garzustand prüfen.`,
          duration: { seconds: Math.round((duration - active) * 60), scaling: 'fixed' }, dependsOn: active === 0 ? deps : [step.id], uses: [] });
      }
      const kind = KIND[step.device];
      if (kind && kind !== 'worktop') {
        if (!devices.has(kind)) devices.set(kind, { first, last: end, temperatureC: step.temperatureC });
        const device = devices.get(kind);
        if (kind === 'oven' && device.temperatureC !== step.temperatureC) throw new Error(`${old.name}: Ofenwechsel bitte im neuen Datenmodell ausdrücklich beschreiben.`);
        device.last = end;
      } else if (kind) reservations.push({ id: `work-${index}`, kind, units: 1, fromTask: first, throughTask: end });
      previous = end;
    }
    for (const [kind, device] of devices) {
      if (kind === 'oven' && !Number.isFinite(device.temperatureC)) throw new Error(`${old.name}: Ofentemperatur fehlt.`);
      reservations.push({ id: kind, kind, units: 1, fromTask: device.first, throughTask: kind === 'pot' || kind === 'pan' ? previous : device.last,
        ...(kind === 'oven' ? { ovenSettings: { temperatureC: device.temperatureC, mode: 'topBottom' } } : {}) });
      if (kind === 'pot' || kind === 'pan') reservations.push({ id: `${kind}-hob`, kind: 'hob', units: 1, fromTask: device.first, throughTask: device.last });
    }
    const macros = old.macrosPerServing || {};
    const nutrition = { basis: 'perServing' };
    for (const [from, to] of Object.entries({ kcal: 'energyKcal', protein_g: 'proteinG', carbs_g: 'carbsG', fat_g: 'fatG', fiber_g: 'fiberG' })) if (macros[from] != null) nutrition[to] = macros[from];
    return { id: old.id, revision: 1, name: old.name, baseServings: old.servings, ingredients, tasks, reservations,
      nutrition, storage: { ...(typeof old.freezable === 'boolean' ? { freezable: old.freezable } : {}), notes: old.notes || [] },
      packaging: { containersPerServing: 1, separateComponents: [] } };
  });
  return { document: { schemaVersion: '2.0', ...(typeof source.week === 'string' ? { week: source.week } : {}),
    ...(typeof source.weekNote === 'string' ? { weekNote: source.weekNote } : {}), recipes,
    selection: recipes.map(r => ({ recipeId: r.id, servings: r.baseServings })), kitchen: defaultKitchen() }, warnings };
}
