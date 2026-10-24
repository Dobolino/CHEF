import validateSchema from '../generated/validate-menu.js';
import { parseJSON } from './json.js';
import { migrateLegacy } from './legacy.js';
import { normalizeQuantity } from './units.js';

export function topological(tasks) {
  const byId = new Map(tasks.map(t => [t.id, t]));
  const degrees = new Map(tasks.map(t => [t.id, t.dependsOn.length]));
  const next = new Map(tasks.map(t => [t.id, []]));
  for (const task of tasks) for (const dep of task.dependsOn) if (next.has(dep)) next.get(dep).push(task.id);
  const queue = tasks.filter(t => !t.dependsOn.length).map(t => t.id), order = [];
  for (let i = 0; i < queue.length; i++) {
    const id = queue[i]; order.push(byId.get(id));
    for (const child of next.get(id)) { degrees.set(child, degrees.get(child) - 1); if (!degrees.get(child)) queue.push(child); }
  }
  return order.length === tasks.length ? order : null;
}
export function validateDocument(document) {
  const errors = [], blockers = [], warnings = [];
  const issue = (target, code, path, message) => target.push({ code, path, message });
  if (!validateSchema(document)) {
    for (const error of validateSchema.errors || []) {
      const field = error.params.missingProperty || error.params.additionalProperty || '';
      const message = error.keyword === 'required' ? `Pflichtfeld „${field}“ fehlt.`
        : error.keyword === 'additionalProperties' ? `Unbekanntes Feld „${field}“.`
        : error.keyword === 'type' ? `Erwarteter Datentyp: ${error.params.type}.`
        : error.keyword === 'enum' ? `Erlaubt: ${error.params.allowedValues.join(', ')}.`
        : error.keyword === 'minimum' || error.keyword === 'exclusiveMinimum' ? 'Der Wert ist zu klein.'
        : `Ungültiger Wert (${error.keyword}).`;
      issue(errors, 'SCHEMA', `${error.instancePath}${field ? `/${field}` : ''}`, message);
    }
    return { errors, blockers, warnings };
  }
  const duplicates = (items, field, path) => {
    const seen = new Set();
    for (const item of items) {
      if (seen.has(item[field])) issue(errors, 'DUPLICATE_ID', path, `Doppelte ID „${item[field]}“.`);
      seen.add(item[field]);
    }
  };
  duplicates(document.recipes, 'id', '/recipes');
  duplicates(document.selection, 'recipeId', '/selection');
  duplicates(document.kitchen.resources, 'id', '/kitchen/resources');
  const recipeMap = new Map(document.recipes.map(r => [r.id, r]));
  const selected = new Map(document.selection.map(s => [s.recipeId, s.servings]));
  if (document.recipes.reduce((n, r) => n + r.tasks.length, 0) > 2048) issue(errors, 'LIMIT', '/recipes', 'Höchstens 2048 Aufgaben pro Menü werden unterstützt.');
  for (const selection of document.selection) if (!recipeMap.has(selection.recipeId)) issue(errors, 'UNKNOWN_RECIPE', '/selection', `Rezept „${selection.recipeId}“ fehlt.`);
  for (const [ri, recipe] of document.recipes.entries()) {
    const path = `/recipes/${ri}`;
    for (const field of ['ingredients', 'tasks', 'reservations']) duplicates(recipe[field], 'id', `${path}/${field}`);
    const ingredients = new Map(recipe.ingredients.map(i => [i.id, i]));
    const tasks = new Map(recipe.tasks.map(t => [t.id, t]));
    const consumed = new Map();
    for (const [ii, ingredient] of recipe.ingredients.entries()) {
      if (ingredient.quantity.kind === 'unknown') issue(ingredient.optional || !selected.has(recipe.id) ? warnings : blockers,
        'UNKNOWN_QUANTITY', `${path}/ingredients/${ii}/quantity`, `${ingredient.name}: Menge fehlt.`);
    }
    for (const [ti, task] of recipe.tasks.entries()) {
      const taskPath = `${path}/tasks/${ti}`;
      if (task.duration == null && selected.has(recipe.id)) issue(blockers, 'UNKNOWN_DURATION', `${taskPath}/duration`, `${recipe.name}: Zeit für „${task.shortLabel || task.instruction}“ fehlt.`);
      for (const dep of task.dependsOn) if (!tasks.has(dep)) issue(errors, 'UNKNOWN_DEPENDENCY', `${taskPath}/dependsOn`, `Vorgänger „${dep}“ existiert nicht.`);
      if (task.prep && (!ingredients.has(task.prep.ingredientId) || task.phase !== 'prep' || task.mode !== 'active')) issue(errors, 'INVALID_PREP', `${taskPath}/prep`, 'Zusammenfassbare Vorbereitung braucht eine vorhandene Zutat und eine aktive Prep-Aufgabe.');
      if (['rawMeat', 'rawFish'].includes(task.prep?.hygieneGroup)) {
        for (const kind of ['board', 'knife']) if (!recipe.reservations.some(h => h.kind === kind && h.fromTask === task.id && h.throughTask === task.id)) issue(errors, 'HYGIENE_RESOURCE', `${taskPath}/prep`, 'Rohe Fleisch-/Fischvorbereitung benötigt eigene Brett- und Messerreservierungen bis zur automatisch ergänzten Reinigung.');
      }
      for (const use of task.uses) {
        const ingredient = ingredients.get(use.ingredientId);
        if (!ingredient) { issue(errors, 'UNKNOWN_INGREDIENT', `${taskPath}/uses`, `Zutat „${use.ingredientId}“ existiert nicht.`); continue; }
        if (use.role !== 'consume') continue;
        let fraction = use.fraction ?? 1;
        if (use.quantity) {
          const a = normalizeQuantity(use.quantity), b = normalizeQuantity(ingredient.quantity);
          if (a.kind !== 'exact' || b.kind !== 'exact' || a.unit !== b.unit) {
            issue(warnings, 'UNCOMPARABLE_AMOUNT', `${taskPath}/uses`, `${ingredient.name}: Teilmenge und Gesamtmenge haben nicht vergleichbare Einheiten.`); continue;
          }
          fraction *= a.value / b.value;
        }
        consumed.set(use.ingredientId, (consumed.get(use.ingredientId) || 0) + fraction);
      }
    }
    for (const [id, total] of consumed) if (total > 1 + 1e-8) issue(errors, 'EXCESS_CONSUMPTION', `${path}/tasks`, `${ingredients.get(id)?.name}: Verbrauch überschreitet die Zutatenmenge.`);
    const ordered = topological(recipe.tasks);
    if (!ordered) issue(errors, 'DEPENDENCY_CYCLE', `${path}/tasks`, `${recipe.name}: Abhängigkeiten bilden einen Kreis oder verweisen auf fehlende Aufgaben.`);
    const reaches = (start, end) => {
      const todo = [end], seen = new Set();
      while (todo.length) {
        const id = todo.pop(); if (id === start) return true;
        if (!seen.has(id)) { seen.add(id); todo.push(...(tasks.get(id)?.dependsOn || [])); }
      }
      return false;
    };
    for (const [hi, hold] of recipe.reservations.entries()) {
      const holdPath = `${path}/reservations/${hi}`;
      if (!tasks.has(hold.fromTask) || !tasks.has(hold.throughTask)) issue(errors, 'UNKNOWN_RESERVATION_TASK', holdPath, 'Gerätebelegung verweist auf eine fehlende Aufgabe.');
      else if (!reaches(hold.fromTask, hold.throughTask)) issue(errors, 'UNORDERED_RESERVATION', holdPath, 'Die Gerätefreigabe muss von der Geräteübernahme abhängen.');
      if (!selected.has(recipe.id)) continue;
      const volume = (hold.minVolumeMlAtBase || 0) * selected.get(recipe.id) / recipe.baseServings;
      const candidates = document.kitchen.resources.filter(r => r.kind === hold.kind && (!volume || (r.volumeMl || 0) >= volume)
        && (!hold.ovenSettings || r.supportedModes?.includes(hold.ovenSettings.mode)));
      if (candidates.reduce((n, r) => n + r.capacity, 0) < hold.units) issue(blockers, 'RESOURCE_UNAVAILABLE', holdPath, `${recipe.name}: Zu wenig passende Geräte (${hold.kind}${volume ? `, mindestens ${Math.ceil(volume)} ml` : ''}).`);
    }
    const combine = recipe.packaging?.combineWithRecipeId;
    if (combine && (combine === recipe.id || !recipeMap.has(combine))) issue(errors, 'INVALID_PACKAGING', `${path}/packaging`, 'Gemeinsame Behälter benötigen ein anderes vorhandenes Hauptgericht.');
    if (combine && recipeMap.get(combine)?.packaging?.combineWithRecipeId) issue(errors, 'INVALID_PACKAGING', `${path}/packaging`, 'Behälter-Zuordnungen dürfen keine Kette oder einen Kreis bilden.');
    if (combine && selected.has(recipe.id) && !selected.has(combine)) issue(blockers, 'PACKAGING_SELECTION', `${path}/packaging`, 'Das zugehörige Hauptgericht ist nicht ausgewählt.');
  }
  return { errors, blockers, warnings };
}

export function importMenu(text) {
  const source = parseJSON(text);
  if (!source || typeof source !== 'object' || Array.isArray(source)) throw new Error('Die Datei muss ein Menü-Objekt enthalten.');
  let document = source, migrationWarnings = [];
  if (source.schemaVersion !== '2.0') {
    if (source.schemaVersion != null && !['1.0', '1.1', '1.2', '1.3'].includes(source.schemaVersion)) throw new Error(`Schema-Version „${source.schemaVersion}“ wird nicht unterstützt.`);
    ({ document, warnings: migrationWarnings } = migrateLegacy(source));
  }
  const result = validateDocument(document);
  return { document, ...result, warnings: [...migrationWarnings.map(message => ({ code: 'MIGRATION', path: '/', message })), ...result.warnings] };
}
