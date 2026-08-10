# Kochmodus — Review (vor Umsetzung)

## Bugs (nach Schwere)

### Hoch
1. **ETA/`totalMinutes` unterschätzt passives Köcheln** — `buildSequence` zählt nur aktive Minuten (`readyAt`). Endet der letzte Schritt mit langer Passivzeit (oder läuft ein früherer Timer noch), ist die angezeigte Kochzeit zu kurz.
2. **Resume übersieht laufende Timer** — `alreadyStarted` prüft nur `pageIndex > 0` und `checked`. Marinade-Timer auf Seite 0 ohne Häkchen → „Neu starten“ löscht den Timer still.
3. **`setInterval(tick)` bei jedem `enterCookView`** — Intervalle stapeln sich (Resume/Restart), nie gecleart.
4. **Fehlende `timeMinutes`/`activeMinutes`** — `activeMin` → `undefined` → `NaN` im Scheduler; Timer-Button zeigt `undefined:00`.

### Mittel
5. **Gerätekonflikt innerhalb eines Rezepts** — Nächster Schritt startet nach `activeMinutes`, auch wenn dasselbe Gerät (z. B. Topf) noch passiv belegt ist.
6. **Korruptes localStorage** — `JSON.parse` ohne try/catch in `index.html` und teilweise im Kochmodus crasht die Seite.
7. **`pageIndex` nur nach oben geklemmt** — negative/NaN-Werte ungeschützt.
8. **AudioContext nach Tab-Suspend** — Unlock nur beim Start; iOS suspendiert oft erneut → Alarm stumm.

### Niedrig
9. **Alarm-Anzeige inkonsistent** — Prep zeigt „fertig!“, Koch-Timer bleibt bei `0:00`.
10. **Fortschritts-Dots** — Viele Seiten + `min-width: 6px` können auf iPhone SE horizontal drücken.
11. **Menü-Signatur** — Nur `week` + zwei IDs; geänderte Steps bei gleicher ID invalidieren State nicht (akzeptabel, aber erwähnenswert).

## iPhone-Kompatibilitätslücken

| Thema | Ist | Soll |
|--------|-----|------|
| Viewport-Höhe | `height: 100%` | `100dvh` / `100svh` Fallback |
| Safe Areas | nur top/bottom | auch left/right (Landscape) |
| Bottom-Nav | safe-bottom ok | auf kleinen Screens kompakter, nie abgeschnitten |
| Doppeltipp-Zoom | `user-scalable=no` | zusätzlich `touch-action: manipulation` |
| Pull-to-Refresh | `overscroll-behavior` | + Touch-Guard am oberen Rand |
| `vibrate` | nicht genutzt | bewusst: visueller Flash + Ton statt Vibration |
| PWA | Apple-Metas partiell | `manifest.json`, `theme-color`, Icons |
| Prep-Zeilen | horizontal eng | stapeln auf schmalen Screens |
| Landscape SE | Nav 76–104px zu hoch | reduzierte Nav-Höhe |

## Feature-Vorschläge (umgesetzt ★ / später ○)

- ★ Portionen-Skalierung (5 → n) mit Mengen-Heuristik in Texten  
- ★ „Alle abhaken“ auf Prep-Seiten + Fortschritt in %  
- ★ Timer ±1 Min vor/während dem Lauf  
- ★ Live-ETA „noch ≈ X Min“ während des Kochens  
- ★ Geräte-Wartezeit im Scheduler (gleiches Gerät)  
- ★ Sprachausgabe (Web Speech API), optional  
- ★ iOS-Haptik-Fallback: Vollbild-Flash bei Alarm  
- ★ ARIA/Fokus für Overlays, Reduced-Motion belassen  
- ★ `manifest.json` + theme-color  
- ○ Service Worker / echte Offline-Caches (Vorschlag: precache HTML/JSON/Fonts)  
- ○ Hash-Router `#overview` / `#mise` / `#cook` — Modulstruktur (`Kochmodus` IIFE) bleibt kompatibel  

## Testplan (Viewport)

Geprüft mit Headless-Chrome + Puppeteer:

| Viewport | Overflow-X | Stage scrollt | Touch ≥44 | Nav am unteren Rand |
|----------|------------|---------------|-----------|---------------------|
| 390×844 iPhone | nein | bei Bedarf | ja | ja |
| 320×568 SE | nein | ja (Prep-Liste) | ja | ja |
| 844×390 Landscape | nein | ja | ja (nach Fix) | ja |
| 1024×768 iPad Land. | nein | nein nötig | ja | ja |
| 768×1024 iPad Port. | nein | nein nötig | ja | ja |

Unit-Checks (`node test-scheduler.js`): Scheduler 43 < 69, Same-Device-Wait, fehlende Felder, Portionen-Skalierung.

Screenshots unter `/opt/cursor/artifacts/screenshots/` (Start + Prep + Kochschritt).
