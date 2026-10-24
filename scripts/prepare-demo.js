// Curated dependencies and explicitly estimated prep durations for the demo.
import fs from 'node:fs/promises';
import { migrateLegacy } from '../src/data/legacy.js';

const old = JSON.parse(await fs.readFile(new URL('../examples/legacy-menu.json', import.meta.url), 'utf8'));
const { document } = migrateLegacy(old);
document.title = 'Dein Sonntagsmenü';
delete document.week;
document.weekNote = 'Mengen je Gericht wählen, Geräte prüfen und Sauce separat verpacken. Vorbereitungszeiten sind Schätzwerte.';
const [a, b] = document.recipes;
const times = { 'hb-mep-1': 240, 'hb-mep-2': 120, 'hb-mep-3': 120, 'hb-mep-4': 300,
  'hb-mep-5': 60, 'hb-mep-6': 60, 'tr-mep-1': 180, 'tr-mep-2': 120, 'tr-mep-3': 60,
  'tr-mep-4': 120, 'tr-mep-5': 60, 'tr-mep-6': 120, 'tr-mep-7': 120 };
for (const recipe of document.recipes) {
  recipe.role = 'main';
  for (const task of recipe.tasks) {
    delete task.sourceText;
    if (task.phase === 'prep' && task.mode === 'active') {
      task.duration = { seconds: times[task.id], scaling: 'linear' };
      task.tip = 'Vorbereitungszeit ist ein Schätzwert. Die Mengen-Chips gelten für deine gewählten Portionen.';
      task.dependsOn = [];
    }
  }
}
const at = id => a.tasks.find(t => t.id === id), bt = id => b.tasks.find(t => t.id === id);
at('hb-mep-1').prep = { ingredientId: 'hb-ing-chicken', operation: 'dice', resultSpec: '20-mm', hygieneGroup: 'rawMeat', mergeAllowed: false };
at('hb-mep-3').dependsOn = ['hb-mep-1', 'hb-mep-2'];
at('hb-mep-3').instruction = 'Hähnchen mit den Marinade-Gewürzen und Joghurt mischen, anschließend kühl marinieren lassen.';
at('hb-mep-6').instruction = 'Bulgur abwiegen und bereitstellen.';
bt('tr-mep-3').instruction = 'Reis abwiegen und bereitstellen.';
bt('tr-mep-6').instruction = 'Limetten auspressen und Saft für das Ende bereitstellen.';
for (const [recipe, ids] of [[a, ['hb-mep-1', 'hb-mep-4', 'hb-mep-5']], [b, ['tr-mep-1', 'tr-mep-5']]]) {
  for (const id of ids) recipe.reservations.push({ id: `board-${id}`, kind: 'board', units: 1, fromTask: id, throughTask: id });
}
at('hb-s1').dependsOn = ['hb-mep-6'];
at('hb-s2').dependsOn = ['hb-mep-3-wait'];
at('hb-s3').dependsOn = ['hb-s2'];
at('hb-s4').dependsOn = ['hb-mep-5'];
at('hb-s5').dependsOn = ['hb-s1-wait', 'hb-s3', 'hb-s4', 'hb-mep-4'];
at('hb-s5').phase = 'pack';
a.packaging.separateComponents = ['Joghurt-Sauce'];
bt('tr-mep-1').instruction = 'Paprika würfeln.';
bt('tr-mep-1').uses = bt('tr-mep-1').uses.filter(u => u.ingredientId === 'tr-ing-paprika');
const onionFood = b.ingredients.find(i => i.id === 'tr-ing-zwiebel').foodId;
const onionTask = { id: 'onion-prep', phase: 'prep', mode: 'active', instruction: 'Zwiebel fein würfeln.',
  duration: { seconds: 60, scaling: 'linear' }, dependsOn: [], uses: [{ ingredientId: 'tr-ing-zwiebel', role: 'prepare' }],
  prep: { ingredientId: 'tr-ing-zwiebel', operation: 'dice', resultSpec: '5-mm', hygieneGroup: 'produce', mergeAllowed: true } };
b.tasks.push(onionTask);
b.reservations.push({ id: 'onion-board', kind: 'board', units: 1, fromTask: 'onion-prep', throughTask: 'onion-prep' });
bt('tr-s1').dependsOn = ['tr-mep-3'];
bt('tr-s2').dependsOn = ['tr-mep-1', 'onion-prep'];
bt('tr-s3').dependsOn = ['tr-s2', 'tr-mep-2', 'tr-mep-7'];
bt('tr-s4').dependsOn = ['tr-s3', 'tr-mep-4'];
bt('tr-s5').dependsOn = ['tr-s1-wait', 'tr-s4', 'tr-mep-5', 'tr-mep-6'];
bt('tr-s5').phase = 'pack';
// A full pan workflow repeats as one attended batch. Repeating only the first
// fry phase would incorrectly recombine all portions in the same limited pan.
at('hb-s2').instruction = '1. Hähnchen scharf anbraten.\n2. Bei mittlerer Hitze fertig garen und Garzustand prüfen.\n3. Gegarte Portion vor dem nächsten Durchgang in eine saubere Schüssel geben.';
at('hb-s2').shortLabel = 'Pfannenrunde Hähnchen';
at('hb-s2').duration = { seconds: 840, scaling: 'batches', batchCapacityServings: 5 };
at('hb-s5').dependsOn = at('hb-s5').dependsOn.map(id => id === 'hb-s3' ? 'hb-s2' : id);
a.tasks = a.tasks.filter(t => t.id !== 'hb-s3');
for (const h of a.reservations) if (h.throughTask === 'hb-s3') h.throughTask = 'hb-s2';
bt('tr-s2').instruction = '1. Paprika und Zwiebel andünsten.\n2. Mais, Bohnen und Gewürze zugeben.\n3. Thunfisch unterheben und erwärmen.\n4. Fertige Charge vor dem nächsten Durchgang beiseitestellen.';
bt('tr-s2').shortLabel = 'Pfannenrunde Gemüse';
bt('tr-s2').duration = { seconds: 840, scaling: 'batches', batchCapacityServings: 5 };
bt('tr-s2').dependsOn.push('tr-mep-2', 'tr-mep-7', 'tr-mep-4');
bt('tr-s2').uses.push(...bt('tr-s3').uses, ...bt('tr-s4').uses);
bt('tr-s5').dependsOn = bt('tr-s5').dependsOn.map(id => id === 'tr-s4' ? 'tr-s2' : id);
b.tasks = b.tasks.filter(t => !['tr-s3', 'tr-s4'].includes(t.id));
for (const h of b.reservations) if (h.throughTask === 'tr-s4') h.throughTask = 'tr-s2';
const ingredient = (id, foodId, name, value, unit, category) => ({ id, foodId, name, quantity: { kind: 'exact', value, unit }, category });
const task = (id, instruction, seconds, dependsOn = [], mode = 'active', phase = 'cook', uses = []) => ({ id, instruction, mode, phase,
  duration: { seconds, scaling: phase === 'prep' ? 'linear' : 'fixed' }, dependsOn, uses });
const use = id => ({ ingredientId: id, role: 'transfer' });
const third = {
  id: 'ofen-kichererbsen', revision: 1, role: 'main', name: 'Ofengemüse mit Kichererbsen', baseServings: 4,
  ingredients: [ingredient('carrot', 'carrot', 'Karotten', 500, 'g', 'produce'), ingredient('zucchini', 'zucchini', 'Zucchini', 2, 'piece', 'produce'),
    ingredient('onion', onionFood, 'Zwiebel', 2, 'piece', 'produce'), ingredient('chickpeas', 'chickpeas-cooked', 'Kichererbsen, abgetropft', 480, 'g', 'canned'),
    ingredient('oil', 'olive-oil', 'Olivenöl', 2, 'tbsp', 'oils'), ingredient('salt', 'salt', 'Salz', 0.5, 'tsp', 'spices')],
  tasks: [
    task('oven-on', 'Ofen auf 200 °C Umluft einschalten.', 30),
    task('preheat', 'Ofen vorheizen lassen.', 600, ['oven-on'], 'passive'),
    task('carrot-prep', 'Karotten waschen und in gleichmäßige Stücke schneiden.', 300, [], 'active', 'prep', [use('carrot')]),
    task('zucchini-prep', 'Zucchini waschen und in gleichmäßige Stücke schneiden.', 180, [], 'active', 'prep', [use('zucchini')]),
    { ...task('onion-prep', 'Zwiebeln fein würfeln.', 120, [], 'active', 'prep', [{ ingredientId: 'onion', role: 'prepare' }]),
      prep: { ingredientId: 'onion', operation: 'dice', resultSpec: '5-mm', hygieneGroup: 'produce', mergeAllowed: true } },
    task('drain', 'Kichererbsen abtropfen lassen.', 60, [], 'active', 'prep', [use('chickpeas')]),
    task('load', 'Gemüse und Kichererbsen mit Öl und Salz auf dem Blech mischen und einschieben.', 120,
      ['preheat', 'carrot-prep', 'zucchini-prep', 'onion-prep', 'drain'], 'active', 'cook', [use('carrot'), use('zucchini'), use('onion'), use('chickpeas'), use('oil'), use('salt')]),
    task('bake', 'Gemüse etwa 25 Minuten backen. Anschließend Garzustand prüfen.', 1500, ['load'], 'passive'),
    task('unload', 'Garzustand prüfen und das heiße Blech sicher aus dem Ofen nehmen.', 60, ['bake']),
    task('pack', 'Auf die gewählten Portionen aufteilen und nach den Lagerungshinweisen aufbewahren.', 180, ['unload'], 'active', 'pack')
  ],
  reservations: [
    ...['carrot-prep', 'zucchini-prep', 'onion-prep'].map(id => ({ id: `board-${id}`, kind: 'board', units: 1, fromTask: id, throughTask: id })),
    { id: 'oven', kind: 'oven', units: 1, fromTask: 'oven-on', throughTask: 'unload', ovenSettings: { temperatureC: 200, mode: 'fan' } },
    { id: 'tray', kind: 'tray', units: 1, fromTask: 'load', throughTask: 'pack' }
  ],
  storage: { freezable: true, notes: ['Zügig und fachgerecht abkühlen und kühlen. Es liegt keine geprüfte Haltbarkeitsdauer vor.'] },
  packaging: { containersPerServing: 1, separateComponents: [] }
};
document.recipes.push(third);
document.selection.push({ recipeId: third.id, servings: third.baseServings });
third.ingredients.find(i => i.id === 'oil').foodId = a.ingredients.find(i => i.id === 'hb-ing-oel').foodId;
third.ingredients.find(i => i.id === 'salt').foodId = a.ingredients.find(i => i.id === 'hb-ing-salz').foodId;
for (const r of document.recipes) {
  const boardHolds = r.reservations.filter(h => h.kind === 'board');
  r.reservations.push(...boardHolds.map(h => ({ ...h, id: `knife-${h.id}`, kind: 'knife' })));
  for (const h of r.reservations) if (h.kind === 'pot') h.minVolumeMlAtBase = 1800;
}
await fs.writeFile(new URL('../recipes.json', import.meta.url), JSON.stringify(document, null, 2) + '\n');
console.log('Three-recipe demo prepared. Prep durations are explicit estimates.');
