import { topological } from '../data/validate.js';
import { normalizeQuantity, recipeQuantity, formatQuantity } from '../data/units.js';

export function compileGraph(document, { merge = true } = {}) {
  let tasks = [], holds = [];
  const aliases = new Map();
  for (const selection of document.selection) {
    const recipe = document.recipes.find(r => r.id === selection.recipeId);
    const factor = selection.servings / recipe.baseServings;
    const instances = new Map();
    for (const source of recipe.tasks) {
      if (!source.duration) throw new Error(`Zeit für „${source.instruction}“ fehlt.`);
      const count = source.duration.scaling === 'batches' ? Math.ceil(selection.servings / source.duration.batchCapacityServings) : 1;
      instances.set(source.id, Array.from({ length: count }, (_, i) => `${recipe.id}/${source.id}${count > 1 ? `~${i + 1}` : ''}`));
    }
    for (const source of recipe.tasks) {
      const ids = instances.get(source.id), count = ids.length;
      for (const [index, id] of ids.entries()) {
        const dependencyIds = index ? [ids[index - 1]] : source.dependsOn.map(dep => instances.get(dep).at(-1));
        const uses = source.uses.map(use => {
          const ingredient = recipe.ingredients.find(i => i.id === use.ingredientId);
          const quantity = recipeQuantity(recipe, ingredient, selection.servings, use);
          return { recipeId: recipe.id, ingredientId: ingredient.id, name: ingredient.name,
            foodId: ingredient.foodId, role: use.role, quantity: quantity?.kind === 'exact' ? { ...quantity, value: quantity.value / count } : quantity,
            allergens: ingredient.allergens || [], note: use.note || '' };
        });
        const durationSeconds = Math.max(1, Math.ceil(source.duration.seconds * (source.duration.scaling === 'linear' ? factor : 1)));
        tasks.push({ id, dependsOn: dependencyIds, recipeIds: [recipe.id], recipeNames: [recipe.name],
          sourceTasks: [`${recipe.id}/${source.id}`], phase: source.phase, mode: source.mode,
          instruction: source.instruction, shortLabel: source.shortLabel || source.instruction,
          tip: source.tip || '', sourceText: source.sourceText || '', uses, durationSeconds,
          prep: source.prep ? { ...source.prep, foodId: recipe.ingredients.find(i => i.id === source.prep.ingredientId).foodId } : null,
          batchIndex: index + 1, batchCount: count });
      }
      aliases.set(`${recipe.id}/${source.id}`, ids);
    }
    for (const hold of recipe.reservations) holds.push({ ...hold, id: `${recipe.id}/hold:${hold.id}`,
      recipeId: recipe.id, fromTask: instances.get(hold.fromTask)[0], throughTask: instances.get(hold.throughTask).at(-1),
      minVolumeMl: (hold.minVolumeMlAtBase || 0) * factor });
  }
  if (tasks.length > 4096) throw new Error('Zu viele Durchgänge. Bitte weniger Portionen oder Aufgaben auswählen.');
  if (merge) {
    const groups = new Map();
    for (const task of tasks) {
      if (!task.prep?.mergeAllowed || task.dependsOn.length || task.batchCount !== 1 || task.uses.length !== 1) continue;
      const involved = holds.filter(h => h.fromTask === task.id || h.throughTask === task.id);
      if (involved.some(h => h.fromTask !== task.id || h.throughTask !== task.id || h.ovenSettings || h.minVolumeMl)) continue;
      const use = task.uses[0], q = normalizeQuantity(use.quantity);
      if (q?.kind !== 'exact' || use.role !== 'prepare') continue;
      const key = JSON.stringify([task.prep.foodId, task.prep.operation, task.prep.resultSpec, task.prep.hygieneGroup,
        [...use.allergens].sort(), q.unit, involved.map(h => `${h.kind}:${h.units}`).sort()]);
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key).push(task);
    }
    for (const group of groups.values()) {
      if (group.length < 2 || new Set(group.flatMap(t => t.recipeIds)).size < 2) continue;
      const memberIds = new Set(group.map(t => t.id));
      const id = `batch:${[...memberIds].sort().join('+')}`;
      const verbs = { dice: 'würfeln', slice: 'schneiden', peel: 'schälen', wash: 'waschen', weigh: 'abwiegen' };
      const merged = { ...group[0], id, recipeIds: [...new Set(group.flatMap(t => t.recipeIds))],
        recipeNames: [...new Set(group.flatMap(t => t.recipeNames))], sourceTasks: group.flatMap(t => t.sourceTasks),
        instruction: `${formatQuantity({ kind: 'exact', unit: normalizeQuantity(group[0].uses[0].quantity).unit, value: group.reduce((n, t) => n + normalizeQuantity(t.uses[0].quantity).value, 0) })} ${group[0].uses[0].name} gemeinsam ${verbs[group[0].prep.operation]}. Danach nach den angegebenen Teilmengen aufteilen.`,
        shortLabel: `${group[0].uses[0].name} gemeinsam vorbereiten`,
        durationSeconds: group.reduce((n, t) => n + t.durationSeconds, 0), uses: group.flatMap(t => t.uses) };
      tasks = tasks.filter(t => !memberIds.has(t.id)); tasks.push(merged);
      tasks = tasks.map(t => ({ ...t, dependsOn: [...new Set(t.dependsOn.map(dep => memberIds.has(dep) ? id : dep))] }));
      const mergedHolds = new Map();
      for (const hold of holds.filter(h => memberIds.has(h.fromTask))) {
        const key = `${hold.kind}:${hold.units}`;
        if (!mergedHolds.has(key)) mergedHolds.set(key, { ...hold, id: `${id}/hold:${key}`, fromTask: id, throughTask: id });
      }
      holds = [...holds.filter(h => !memberIds.has(h.fromTask)), ...mergedHolds.values()];
      for (const [sourceId, targetIds] of aliases) aliases.set(sourceId, targetIds.map(target => memberIds.has(target) ? id : target));
    }
  }
  // Keep the actual board unavailable until cleaning is explicitly confirmed.
  for (const task of [...tasks]) {
    if (!['rawMeat', 'rawFish'].includes(task.prep?.hygieneGroup)) continue;
    const id = `${task.id}~clean`;
    const clean = { ...task, id, dependsOn: [task.id], prep: null, uses: [], sourceTasks: [],
      instruction: 'Brett, Messer und Hände nach dem rohen Fleisch oder Fisch gründlich reinigen.',
      shortLabel: 'Brett und Messer reinigen', durationSeconds: document.kitchen.cleaningSeconds || 60,
      tip: 'Geschätzte Reinigungszeit; erst nach tatsächlicher Reinigung bestätigen.' };
    tasks = tasks.map(t => t.id === task.id ? t : { ...t, dependsOn: t.dependsOn.map(dep => dep === task.id ? id : dep) });
    tasks.push(clean);
    holds = holds.map(h => ['board', 'knife'].includes(h.kind) && h.throughTask === task.id ? { ...h, throughTask: id } : h);
  }
  const ordered = topological(tasks);
  if (!ordered) throw new Error('Aus diesen Abhängigkeiten lässt sich kein Ablaufplan erzeugen.');
  // Attention is a reservable resource too: a dirty pair of hands is unavailable
  // for other work until the cleaning task has actually been confirmed.
  for (const task of ordered) if (task.mode === 'active' && !task.id.endsWith('~clean')) {
    holds.push({ id: `${task.id}/attention`, kind: 'attention', units: 1, recipeId: task.recipeIds[0],
      fromTask: task.id, throughTask: tasks.some(t => t.id === `${task.id}~clean`) ? `${task.id}~clean` : task.id });
  }
  const kitchen = { ...document.kitchen, resources: [...document.kitchen.resources,
    ...Array.from({ length: document.kitchen.cooks }, (_, i) => ({ id: `@cook/${i + 1}`, name: `Person ${i + 1}`, kind: 'attention', capacity: 1 }))] };
  const critical = new Map();
  const successors = new Map(tasks.map(t => [t.id, []]));
  for (const task of tasks) for (const dep of task.dependsOn) successors.get(dep).push(task.id);
  for (const task of [...ordered].reverse()) critical.set(task.id, task.durationSeconds + Math.max(0, ...successors.get(task.id).map(id => critical.get(id))));
  return { tasks: ordered, byId: new Map(ordered.map(t => [t.id, t])), holds, aliases, critical,
    kitchen, recipeOrder: document.selection.map(s => s.recipeId) };
}
