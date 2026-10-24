# Rezept-Prompt für CHEF 2.0

Erzeuge ein vollständiges JSON-Menü gemäß `schemas/menu.v2.schema.json`. Ausgabe nur als JSON, ohne Markdown. Ein Beispiel mit drei Gerichten liegt in `recipes.json`; ein kleineres Technikbeispiel in `examples/three-recipes.json`.

## Vorab festlegen

Gerichte, Basisportionen und Zielportionen je Gericht; tatsächliche Küchenausstattung; Allergien; getrennte Komponenten und gewünschte Behälter. Küchenausstattung aus einem vorhandenen Export übernehmen oder erfragen. Keine zusätzlichen Geräte erfinden, nur damit mehr Parallelität möglich wird.

## Menü

Pflichtfelder sind `schemaVersion: "2.0"`, `recipes`, `selection` und `kitchen`.

- `recipes`: mindestens ein vollständiges Rezept, maximal 32.
- `selection`: beispielsweise `[{"recipeId":"gericht-a","servings":4}]`. Zielportionen dürfen je Gericht unterschiedlich sein.
- `kitchen`: `cooks`, optional `cleaningSeconds`, und `resources` mit konkreten Geräten.
- Optional: `title`, `week`, `weekNote`.

Beispielgeräte: `{"id":"pot-1","name":"Topf 1","kind":"pot","capacity":1,"volumeMl":4000}` und `{"id":"oven-1","kind":"oven","capacity":2,"supportedModes":["fan","topBottom"]}`. Die Kapazität eines Ofens beschreibt Einschübe, keine unabhängigen Temperaturzonen.

## Rezept

Pflicht: `id`, `revision`, `name`, `baseServings`, `ingredients`, `tasks`, `reservations`. IDs beginnen mit einem kleinen ASCII-Buchstaben und enthalten nur kleine Buchstaben, Ziffern und Bindestriche. Zutaten- und Task-IDs sind innerhalb eines Rezepts eindeutig.

Eine Zutat:

```json
{
  "id": "onion",
  "foodId": "yellow-onion",
  "name": "Zwiebel",
  "quantity": { "kind": "exact", "value": 150, "unit": "g" },
  "category": "produce"
}
```

Gleiche Produkte über Rezepte mit derselben fachlich passenden `foodId` kennzeichnen. Ähnliche Namen sind nicht automatisch identische Produkte.

Einheiten: `g`, `kg`, `ml`, `l`, `tsp`, `tbsp`, `piece`, `clove`, `can`, `bunch`. Mengen als Zahlen wie `0.5`, keine Brüche oder Einheiten in Zahlenstrings. Für bewusst freie Mengen `{"kind":"toTaste"}`. Fehlende Mengen als `{"kind":"unknown","note":"Begründung"}` ausweisen; nicht erfinden. Erforderliche unbekannte Mengen verhindern automatische Planung.

Kategorien: `produce`, `protein`, `dairy`, `dry`, `canned`, `spices`, `oils`, `other`. Optional `optional` und `allergens`.

## Aufgaben und Parallelität

```json
{
  "id": "rice-simmer",
  "phase": "cook",
  "mode": "passive",
  "instruction": "Reis garen lassen und anschließend Garzustand prüfen.",
  "shortLabel": "Reis garen",
  "duration": { "seconds": 1200, "scaling": "fixed" },
  "dependsOn": ["rice-start"],
  "uses": []
}
```

Jede Aufgabe braucht `id`, `phase`, `mode`, `instruction`, `duration`, `dependsOn` und `uses`.

- Phasen: `prep`, `cook`, `cool`, `pack`.
- Modi: `active` oder `passive`. Handarbeit und Wartezeit trennen. Wiederholtes Rühren als eigene aktive Aufgaben modellieren.
- `duration.seconds`: positive ganze Sekunden. Handarbeit ohne verlässliche Zeit darf `duration: null` haben und wird dann ohne Timer bestätigt. Für passive Koch-, Back- und Wartephasen ist eine Dauer nötig; andernfalls bleibt das Menü ein Entwurf. Keine Garzeiten erfinden.
- `scaling`: `fixed`, `linear` oder `batches`. Bei `batches` ist `batchCapacityServings` Pflicht; `seconds` ist die Dauer eines Durchgangs.
- `dependsOn` nennt vorhandene Vorgänger dieses Rezepts und bedeutet vollständigen Abschluss. Keine Kreise.
- `uses`: beispielsweise `{"ingredientId":"onion","role":"prepare"}`. Rollen: `prepare`, `consume`, `transfer`; optional `fraction`, `quantity`, `note`. Dieselbe Menge nicht mehrfach als verbraucht deklarieren.
- Handlungen stehen in Texten, skalierbare Mengen in `uses`. Keine skalierbaren Mengen per Freitextformel verstecken.

Unabhängige Arbeit braucht unabhängige Vorgänger: Sauce kann während Reisgaren entstehen; Anrichten hängt von gegartem Reis und weiteren Komponenten ab. Array-Reihenfolge ersetzt keine fachlichen Abhängigkeiten.

Zusammenfassbare Vorbereitung kennzeichnen:

```json
"prep": {
  "ingredientId": "onion",
  "operation": "dice",
  "resultSpec": "5-mm",
  "hygieneGroup": "produce",
  "mergeAllowed": true
}
```

Operationen: `wash`, `peel`, `dice`, `slice`, `weigh`. Hygienegruppen: `produce`, `rawMeat`, `rawFish`, `readyToEat`. Nur tatsächlich kompatible Arbeiten zum Zusammenfassen freigeben. Rohe Fleisch-/Fischvorbereitung braucht einzelne Brett- und Messerreservierungen; diese werden bis zum ausdrücklich bestätigten Reinigungsschritt verlängert.

## Gerätebindungen

```json
"reservations": [
  { "id": "rice-pot", "kind": "pot", "units": 1, "fromTask": "rice-start", "throughTask": "rice-pack", "minVolumeMlAtBase": 1800 },
  { "id": "rice-hob", "kind": "hob", "units": 1, "fromTask": "rice-start", "throughTask": "rice-simmer" }
]
```

Typen: `pot`, `pan`, `hob`, `oven`, `tray`, `board`, `knife`, `worktop`, `coolingSpace`. `throughTask` ist dieselbe oder eine abhängige Aufgabe. Ein gefüllter Topf bleibt bis zum Umfüllen belegt, die Herdplatte kann vorher frei sein.

Ofenbindungen brauchen `ovenSettings`, etwa `{"temperatureC":200,"mode":"fan"}`. Modi: `fan`, `topBottom`, `grill`; der konkrete Ofen muss den Modus unterstützen. Vorheizen, Beladen, Temperaturwechsel und Entnehmen als echte Aufgaben beschreiben. Einschübe nur bei kompatibler Temperatur und Betriebsart gemeinsam nutzen.

## Nährwerte, Aufbewahrung und Portionen

Optional `nutrition` mit `basis: "perServing"`, `energyKcal`, `proteinG`, `carbsG`, `fatG`, `fiberG` und `source`. Keine erfundenen Werte; Unbekanntes weglassen.

Optional `storage.freezable`, `storage.notes`. `storage.refrigerated` und `storage.frozen` brauchen bei Verwendung `maxHours`, `conditions`, `source`, `reviewedAt` (YYYY-MM-DD). Keine pauschale Vier-Tage-Haltbarkeit erfinden.

Optional `packaging: {"containersPerServing":1,"separateComponents":["Sauce"]}`. Eine Beilage kann mit `combineWithRecipeId` einem ausgewählten Hauptgericht zugeordnet werden; keine Ketten oder Kreise. Überschüssige Portionen werden separat ausgewiesen.

Vor Ausgabe prüfen: Referenzen vollständig, Mengen konsistent, Geräte bis zur tatsächlichen Freigabe gebunden, passende Temperaturen, realistische aktive Phasen und nachvollziehbare Quellen. Maximal 2048 Quellaufgaben und 1 MB pro Menü.
