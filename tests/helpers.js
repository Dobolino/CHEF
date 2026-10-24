export function task(id, seconds, { mode = 'active', deps = [], phase = 'cook', ...extra } = {}) {
  return { id, instruction: id, mode, phase, duration: { seconds, scaling: 'fixed' }, dependsOn: deps, uses: [], ...extra };
}
export function recipe(id, tasks, reservations = [], ingredients = [{ id: 'water', foodId: 'water', name: 'Wasser', quantity: { kind: 'exact', value: 100, unit: 'ml' } }]) {
  return { id, name: id, revision: 1, baseServings: 4, tasks, reservations, ingredients, packaging: { containersPerServing: 1 } };
}
export function hold(id, kind, first, last, extra = {}) { return { id, kind, units: 1, fromTask: first, throughTask: last, ...extra }; }
export function menu(recipes, resources = null) {
  return { schemaVersion: '2.0', recipes, selection: recipes.map(r => ({ recipeId: r.id, servings: r.baseServings })),
    kitchen: { cooks: 1, cleaningSeconds: 60, resources: resources || [
      { id: 'pot-1', kind: 'pot', capacity: 1, volumeMl: 4000 }, { id: 'pot-2', kind: 'pot', capacity: 1, volumeMl: 4000 },
      { id: 'hob-1', kind: 'hob', capacity: 1 }, { id: 'hob-2', kind: 'hob', capacity: 1 },
      { id: 'pan-1', kind: 'pan', capacity: 1 }, { id: 'board-1', kind: 'board', capacity: 1 },
      { id: 'oven-1', kind: 'oven', capacity: 2, supportedModes: ['fan'] }
    ] } };
}
export function memoryStorage() {
  const values = new Map();
  return { getItem: key => values.get(key) ?? null, setItem: (key, value) => values.set(key, value), removeItem: key => values.delete(key), values };
}
