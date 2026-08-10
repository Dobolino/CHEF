# Review-Auftrag für Cursor: Batch-Cooking-App (Kochmodus)

## Rolle
Du bist ein erfahrener Frontend-Entwickler mit Fokus auf mobile Web-Apps (iOS
Safari / PWA) und UX für Touch-Bedienung in schwierigen Situationen (Küche,
nasse/fettige Finger, Blick aus 40–50 cm). Prüfe das bestehende Projekt kritisch,
bring eigene Ideen und Verbesserungen ein und mach die App **sowohl für iPad als
auch für iPhone** rund. Antworte auf Deutsch.

## Kontext
Eine reine HTML/CSS/JS-App (kein Framework, kein Backend) für wöchentliches
Batch Cooking. Alle Daten lokal (localStorage). Drei Bereiche geplant:
Übersicht, Mis en Place, Kochmodus. Umgesetzt sind bisher:

- **`recipes.json`** — Datenschema + zwei Beispielrezepte (5 Portionen). Pro Rezept:
  `macrosPerServing`, `notes`, `misEnPlace[]`, `steps[]`. Schema-Erweiterungen
  (alle optional & rückwärtskompatibel):
  - `steps[].activeMinutes` — aktive Arbeitszeit vs. `timeMinutes` (Gesamtdauer).
    Fehlt es, gilt der Schritt als voll aktiv.
  - `steps[].shortLabel` / `misEnPlace[].shortLabel` — Kurzname für Timer-Chips.
  - `misEnPlace[].timerMinutes` — z. B. Marinade 30 Min.
- **`index.html`** — Rezept-Übersicht (Prototyp). Legt die Design-Tokens fest:
  Dark Theme (`--bg #14171c`, `--surface #1c2029`), Rezept A Blau `#4c8dff`,
  Rezept B Rot `#ff5c5c`, Freezable/Prep-Akzent Türkis `#35d0ba`. Schriften:
  Space Grotesk (Headlines), Inter (Text), IBM Plex Mono (Zahlen).
- **`kochmodus.html`** — der eigentliche Kochmodus (Hauptdatei für dein Review).

### Was der Kochmodus kann
- **Verzahnte Kochreihenfolge:** Ein Greedy-Scheduler (`buildSequence`) erzeugt
  aus zwei `steps`-Arrays eine einzige Seitenfolge. Er nutzt Wartezeiten
  (passiv köchelndes Getreide) für aktive Arbeit am anderen Rezept. Priorität:
  (1) passiv-lastige Schritte zuerst anwerfen, (2) Geräte-Stickiness (Pfanne
  nicht mittendrin verlassen), (3) Balance. Ergebnis: ~43 statt ~69 Min.
- **Vorbereitungs-Phase (`buildPrepPages`):** Vor den Kochschritten wird das
  Mis en Place beider Rezepte nach Kategorie gebatcht (alles Schneiden zusammen
  usw.). Marinade zuerst mit 30-Min-Timer.
- **Eine Seite pro Schritt**, drei große Nav-Buttons (Zurück/Home/Weiter) +
  Wischgesten, Timer mit Ton (absolute Endzeit → überlebt Reload/Navigation),
  „Nebenbei"-Leiste für Hintergrund-Timer, Fortschrittsleiste mit Direktsprung,
  Abhaken pro Schritt, Tipp-Overlay, Wake Lock, localStorage-Persistenz + Resume,
  Home-Bestätigung bei laufendem Timer / unfertigem Kochen.

## Deine Aufgaben

### 1. Lesen & verstehen
Lies zuerst `recipes.json`, `index.html` und `kochmodus.html` komplett. Verstehe
den Scheduler und die Seiten-/State-Struktur, bevor du etwas änderst.

### 2. Korrektheits-Review
Finde Bugs und Kanten-Fälle, z. B.:
- Scheduler bei Rezepten mit anderer Schrittzahl, fehlenden Feldern, nur einem
  Rezept, sehr vielen Schritten, `order`-Lücken/-Dubletten.
- Timer-Verhalten bei Reload während ein Timer läuft/abgelaufen ist; mehrere
  gleichzeitige Timer; Alarm-Stop-Logik; Zeitsprünge (Gerät im Standby).
- localStorage: Signatur-Invalidierung bei Menüwechsel, korruptes JSON,
  `pageIndex` außerhalb des gültigen Bereichs.
- Wische vs. Scrollen (vertikal), versehentliches Pull-to-Refresh.

### 3. iPad **und** iPhone kompatibel machen (Kernpunkt)
Die App ist iPad-first gebaut. Prüfe und behebe die iPhone-Tauglichkeit:
- **Viewport-Höhe:** `100vh` ist auf iOS Safari unzuverlässig (Adressleiste).
  Prüfe Umstieg auf `100dvh`/`svh`/`lvh` und dass die fixe Bottom-Nav nie von
  der Safari-UI verdeckt wird.
- **Safe Areas / Notch / Dynamic Island:** `env(safe-area-inset-*)` oben,
  unten und in Landscape (Home-Indicator links/rechts).
- **Kleine Screens & Landscape:** Nav-Grid (`1fr 0.7fr 1fr`), riesiger
  Schritt-Text (bis 52px), Prep-Zeilen, Chips und die Timer-Anzeige müssen auf
  einem iPhone SE (portrait) und im Landscape lesbar bleiben, ohne dass der
  Body horizontal scrollt oder Buttons abgeschnitten werden. Prüfe, ob der
  Stage-Bereich korrekt scrollt statt zu clippen.
- **Touch-Targets** ≥ 44px behalten, auf iPhone ggf. nachjustieren.
- **iOS-Eigenheiten:** Audio-Unlock (WebAudio nur nach User-Geste — testen!),
  `navigator.vibrate` wird von iOS Safari **nicht** unterstützt (nur Ton/visuell),
  Screen Wake Lock erst ab iOS 16.4 und nur bei sichtbarem Tab (Re-Acquire bei
  `visibilitychange` ist drin — verifizieren), Doppeltipp-Zoom verhindern.
- **PWA:** Prüfe `apple-mobile-web-app-*`-Metas; schlage ein `manifest.json`
  (Icons, `display: standalone`, `theme-color`) vor, damit „Zum Home-Bildschirm"
  auf iPhone/iPad sauber funktioniert.

### 4. Verbesserungen & Feature-Ideen (ausdrücklich erwünscht)
Bring eigene Vorschläge ein und setze die sinnvollen um. Anregungen (gern
ergänzen/verwerfen):
- Portionen-Skalierung (5 → n) inkl. Mengen in Schritt-/Prep-Texten.
- „Alle abhaken" pro Prep-Seite; Fortschritt in % gesamt.
- Timer-Voreinstellung anpassbar (z. B. +1 Min) direkt auf der Seite.
- Serving-Sync / ETA „fertig in X Min" live während des Kochens.
- Bessere Fehlertoleranz bei übersprungenen Schritten.
- Optionale Sprachausgabe des Schritt-Texts (Web Speech API).
- Haptik-Fallback-Strategie für iOS (da `vibrate` fehlt).
- Kontrast/Schriftgrößen aus Sichtdistanz 40–50 cm final prüfen (WCAG AA).
- Reduced-Motion, Fokus-/ARIA-Zustände für die Buttons und Overlays.

## Randbedingungen (bitte einhalten)
- **Vanilla HTML/CSS/JS**, kein Framework. Tailwind CDN wäre erlaubt, ist aber
  aktuell nicht genutzt — kein Zwang, es einzuführen.
- **Design-Tokens, Farben und Schriften aus `index.html` beibehalten**, nicht neu
  erfinden.
- **Rückwärtskompatibel** zu den bestehenden `recipes.json`-Beispieldaten bleiben;
  neue Schemafelder optional halten.
- Code-Kommentare auf Englisch, Konversation/Erklärungen auf Deutsch.
- Service Worker / echte Offline-Fähigkeit ist ein späterer Schritt — ein
  Vorschlag dazu ist willkommen, muss aber nicht sofort umgesetzt werden.
- Die spätere Zusammenführung der drei Bereiche in eine einzige `index.html`
  (Hash-Router `#overview` / `#mise` / `#cook`) im Blick behalten: Änderungen so
  halten, dass sie diese Zusammenführung nicht erschweren.

## Vorgehen
1. Erst ein kurzes schriftliches Review: gefundene Bugs (nach Schwere sortiert),
   iPhone-Kompatibilitätslücken, deine Feature-Vorschläge mit Begründung.
2. Dann die Fixes und die von dir empfohlenen Verbesserungen umsetzen.
3. Auf einem iPhone-Viewport (z. B. 390×844) und iPad-Viewport (1024×768,
   Portrait + Landscape) gegentesten und kurz dokumentieren, was du geprüft hast.
