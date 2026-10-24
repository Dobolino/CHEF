const UNITS = {
  g: ['g', 1], kg: ['g', 1000], ml: ['ml', 1], l: ['ml', 1000],
  tsp: ['tsp', 1], tbsp: ['tsp', 3], piece: ['piece', 1], clove: ['clove', 1], can: ['can', 1], bunch: ['bunch', 1]
};
const LABELS = { g: 'g', kg: 'kg', ml: 'ml', l: 'l', tsp: 'TL', tbsp: 'EL', piece: 'Stück', clove: 'Zehen', can: 'Dosen', bunch: 'Bund' };
export const unitLabel = unit => LABELS[unit] || unit;
export const number = value => new Intl.NumberFormat('de-CH', { maximumFractionDigits: 2 }).format(value);
export function scaleQuantity(quantity, factor) {
  return quantity?.kind === 'exact' ? { ...quantity, value: quantity.value * factor } : quantity;
}
export function normalizeQuantity(quantity) {
  if (quantity?.kind !== 'exact') return quantity;
  const [unit, factor] = UNITS[quantity.unit];
  return { kind: 'exact', value: quantity.value * factor, unit };
}
export function formatQuantity(quantity) {
  if (!quantity || quantity.kind === 'unknown') return 'Menge fehlt';
  if (quantity.kind === 'toTaste') return 'nach Geschmack';
  let { value, unit } = quantity;
  if (unit === 'g' && value >= 1000) { value /= 1000; unit = 'kg'; }
  if (unit === 'ml' && value >= 1000) { value /= 1000; unit = 'l'; }
  return `${number(value)} ${unitLabel(unit)}`;
}
export function recipeQuantity(recipe, ingredient, servings, use = null) {
  const quantity = use?.quantity || ingredient.quantity;
  return scaleQuantity(quantity, servings / recipe.baseServings * (use?.fraction ?? 1));
}
export function shoppingList(document) {
  const buckets = new Map();
  const recipeMap = new Map(document.recipes.map(r => [r.id, r]));
  for (const selection of document.selection) {
    const recipe = recipeMap.get(selection.recipeId);
    if (!recipe) continue;
    for (const ingredient of recipe.ingredients) {
      const quantity = normalizeQuantity(recipeQuantity(recipe, ingredient, selection.servings));
      // Allergen metadata is part of compatibility, not just the display name.
      const key = `${ingredient.foodId}|${quantity.kind === 'exact' ? quantity.unit : quantity.kind}|${[...(ingredient.allergens || [])].sort().join(',')}`;
      if (!buckets.has(key)) buckets.set(key, { key, foodId: ingredient.foodId, name: ingredient.name,
        quantity: quantity ? { ...quantity } : null, category: ingredient.category || 'other', optional: true, allocations: [] });
      const item = buckets.get(key);
      if (item.allocations.length && quantity.kind === 'exact') item.quantity.value += quantity.value;
      item.optional &&= !!ingredient.optional;
      item.allocations.push({ recipeId: recipe.id, ingredientId: ingredient.id, quantity, recipeName: recipe.name });
    }
  }
  return [...buckets.values()].sort((a, b) => a.category.localeCompare(b.category) || a.name.localeCompare(b.name, 'de'));
}
