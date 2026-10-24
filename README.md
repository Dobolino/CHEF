# CHEF

Eine lokale Meal-Prep-PWA mit gemeinsamem Ablauf für mehrere Gerichte. Vanilla JavaScript und ES-Module, kein Backend und kein Konto. Das Beispielmenü enthält drei Gerichte, gemeinsame Zwiebelvorbereitung und eine explizite Brett-/Messerreinigung nach rohem Hähnchen.

## Entwickeln und prüfen

Voraussetzungen: Node.js 22 oder neuer, npm und Python 3 für den lokalen HTTP-Server.

```sh
npm ci
npm run build
npm test
npm start
```

Der Server verwendet Port 8000 auf `127.0.0.1`. HTTP auf localhost oder HTTPS sind erforderlich; direktes Öffnen der HTML-Datei reicht für Module und Offline-Funktionen nicht. Der Cloud-Onboarding-Client unterstützt keine öffentlichen localhost-Vorschau-Links.

Der Build erzeugt aus dem Schema einen lokal gebündelten Ajv-Validator und einen versionierten Service Worker. Generierte Dateien sind eingecheckt, damit die vorbereitete App ohne CDN funktioniert. Nach Änderungen an Schema oder App-Assets erneut bauen und die neue Version im Browser aktivieren. Der Build verändert keine Rezeptdaten.

Browserprüfungen mit einem laufenden Server:

```sh
python3 -m pip install -r requirements-test.txt
python3 tests/browser_smoke.py
```

Die Cloud-Umgebung enthält Python Playwright und `/usr/bin/chromium`. Auf anderen Maschinen Chromium zusätzlich installieren und bei Bedarf `CHEF_CHROMIUM` setzen. Die Prüfungen verwenden eigene Browser-Kontexte und schreiben nach `test-results/`. `node test-scheduler.js` bleibt als Einstieg für die Planungstests erhalten.

## Bedienung

1. **Menü:** Gerichte und Portionen je Gericht wählen und „Kochen starten“ drücken. Der Ablauf verwendet die Geräte aus den Rezeptdaten; Altimporte erhalten eine Standardküche. Während des Kochens bleiben diese Daten fest; ein neuer Kochabend archiviert den alten Stand.
2. **Vorbereiten (optional):** Zusammengefasste Zutaten und Geräte nachsehen oder abhaken. Diese Liste sperrt den Kochstart nicht. Schneiden, Abmessen und andere Vorbereitungen sind Teil des gemeinsamen Kochplans. Eine Einkaufsansicht und einen Kücheneinstellungsdialog gibt es nicht mehr; frühere Einkaufsdaten bleiben in Sicherungen erhalten.
3. **Kochmodus:** Eine Ansicht für den aktuellen Schritt, seine Zutaten und alle laufenden Timer. Die Haupttaste bleibt im Bildschirm; nur lange Anleitungen scrollen. Nächste und erledigte Schritte stehen auf Wunsch in der separat scrollbaren Liste „Schritte“. Antippen öffnet die Aufgabe auf derselben Seite. Hinweise, Sprache, Gesamtzutaten und Notizen liegen unter „Weitere Optionen“. Handarbeit ohne Zeitangabe läuft ohne Timer bis zur Bestätigung. Während passiver Zeit „Währenddessen weiter“ nutzen. Alarme schließen die optionale Schrittliste und fordern zum Prüfen auf. Quittieren beendet nur die Erinnerung; ein Garprozess ist erst nach ausdrücklicher Prüfung abgeschlossen.
4. **Abschluss:** Behälter und separate Saucenbecher zuordnen; optional ein gemessenes Gesamtgewicht eingeben. Fehlende Haltbarkeitsangaben werden nicht geschätzt.

Die vier Navigationsziele bleiben oben sichtbar, auch auf dem Smartphone. Die opake Kopfzeile hält zusätzlich Abstand unterhalb der iOS-Statusleiste; deren Sicherheitsabstand wird zum normalen Innenabstand addiert. Auf iPads beginnt die Bedienung frühestens 64 CSS-Pixel unter dem oberen Ansichtsrand, auch bei gemeldetem Sicherheitsabstand null und bei Desktop-Kennung. Im Kochmodus ist zusätzlich das äußere Dokument gegen Overscroll gesperrt; die inneren Textbereiche bleiben scrollbar. Der Kochmodus ist über den gleichnamigen Reiter oder „Kochen starten“ erreichbar. Pinch- und Doppeltipp-Zoom sind für die Touch-Bedienung deaktiviert; Safari-Gesten werden zusätzlich abgefangen. Die Systemfunktionen zur Bildschirmvergrößerung bleiben Sache des Geräts. Schriftgrößen in Eingaben vermeiden den automatischen iOS-Fokuszoom. Physische iPad-/iPhone-Prüfungen bleiben erforderlich.

Die angezeigte Dauer bis zum Portionieren umfasst die modellierten Phasen. Nicht modellierte Abkühl-/Lagerungsschritte sind nicht automatisch erledigt; sie lassen sich als `cool`-Tasks aufnehmen. Vorbereitungszeiten des Beispielmenüs sind gekennzeichnete Schätzwerte.

## Format und Import

Der Vertrag liegt in [schemas/menu.v2.schema.json](schemas/menu.v2.schema.json):

- `recipes`: 1–32 Rezepte mit Basisportionen, Zutaten, Aufgaben und Gerätebindungen.
- `selection`: ausgewählte Rezept-IDs mit eigenen Zielportionen.
- `kitchen`: kochende Personen und tatsächliche Ressourcen einschließlich Größe und Ofen-Betriebsart.

Rezeptimporte sind auf 1 MB, Quellaufgaben auf 2048 und nach Batch-Aufteilung erzeugte Aufgaben auf 4096 begrenzt. Dies sind Schutzgrenzen, keine Leistungszusage für maximal große Menüs.

Mengen sind Zahlen mit Einheit: `0.5` statt `"1/2"`. Doppelte JSON-Schlüssel, doppelte IDs, ungültige Referenzen, unbekannte Felder und Abhängigkeitskreise werden abgewiesen. Unbekannte erforderliche Mengen (`quantity.kind: "unknown"`) und passive Warte-/Garzeiten (`duration: null`) bleiben Entwurfsblocker. Aktive Handarbeit ohne Dauer ist direkt ausführbar, erhält keinen automatischen Timer und muss ausdrücklich bestätigt werden. Nur für die grobe Reihenfolge und ETA setzt der Planer dafür zwei Minuten pro Quellaufgabe an; die Originaldaten bleiben `null`. Solche Zeitpläne sind entsprechend gekennzeichnet. Zeiten lassen sich optional in den Rezeptdetails ergänzen, vollständige Daten unter „Rezeptdaten bearbeiten“.

Eine Vorschau ersetzt Daten erst nach Übernahme. Das vorherige Menü wird archiviert. Archivierte Timer behalten ihre Endzeitpunkte, lösen aber keine Alarme aus. Darauf weist die App beim Wechsel eines laufenden Vorgangs ausdrücklich hin. Zum Weiterkochen den alten Stand wiederherstellen.

Formate 1.0–1.3 und das frühere unversionierte Format werden kontrolliert übernommen. `examples/legacy-menu.json` erhält die vorherige Rezeptdatei. Der Adapter ergänzt keine erfundenen Rezeptzeiten und erzeugt konservative Abhängigkeiten. Fehlende aktive Vorbereitungszeiten verhindern den Start nicht. Das gilt auch für bereits gespeicherte migrierte Menüs, ohne erneuten Import. Alte Browser-Schlüssel werden nicht gelöscht; Rohfortschritt und Häkchen bleiben zusätzlich gesichert, alte Timer werden sichtbar übernommen. Alte, nach Seitenzahlen geführte Häkchen gelten nicht automatisch als erledigte neue Aufgaben.

## Planungsregeln

`dependsOn` bedeutet vollständigen Abschluss eines Vorgängers. Aktive Tasks belegen eine Person, passive Tasks nicht. Geräte bleiben vom Beginn von `fromTask` bis zum Ende von `throughTask` reserviert. So kann eine Herdplatte frei werden, während ihr Topf noch Essen enthält.

Ein physischer Ofen erlaubt nur kompatible Temperatur und Betriebsart gleichzeitig. Mehrere Einschübe sind keine unabhängigen Temperaturzonen. Vorheizen und Temperaturwechsel müssen im Rezept modelliert sein.

Vier deterministische Varianten werden verglichen, darunter ein serieller Kandidat gegen bestimmte Hold-and-wait-Sackgassen. Der kürzeste gefundene gültige Plan wird gewählt; globale Optimalität wird nicht behauptet. Unauflösbare Gerätebindungen werden erklärt.

Vorbereitungen werden bei passender Operation, Produktidentität, Schnittbild, Hygienegruppe, Allergenen, Einheiten und einfachen Geräteansprüchen zusammengefasst. Aktuell betrifft dies unabhängige Wurzelaufgaben. Die Dauer bleibt konservativ die Summe der Einzelzeiten; Teilmengen je Ursprungsrezept bleiben erhalten.

`duration.scaling`:

- `fixed`: gleichbleibender Planwert.
- `linear`: proportional zu Ziel-/Basisportionen.
- `batches`: Dauer je Durchgang; `batchCapacityServings` ist Pflicht. Der Compiler erzeugt aufeinanderfolgende Durchgänge und teilt Mengen auf.

Strukturierte rohe Fleisch-/Fischvorbereitung braucht eigene Brett- und Messerreservierungen. Diese reichen bis zum automatisch ergänzten, zu bestätigenden Reinigungsschritt. Sein Planwert stammt aus `kitchen.cleaningSeconds`, standardmäßig einer Minute; das ist keine Zusicherung, dass eine bestimmte Zeit immer für die Reinigung genügt.

Die Vorhersage plant offene Aufgaben ab dem aktuellen Stand neu. Tatsächliche Startzeiten, laufende Timer und übernommene Geräte bleiben erhalten. Übersprungene Aufgaben erfüllen keine Voraussetzungen ihrer Nachfolger.

## Speicherung, Archiv und Offline

Der lokale Snapshot liegt unter `chef.workspace.v2`. Fehlgeschlagenes Speichern erhält den vorherigen gespeicherten und sichtbaren Stand. Veraltete Tabs werden vor dem Schreiben erkannt; einen Kochabend vorzugsweise in einem aktiven Tab bearbeiten.

Das Archiv enthält maximal 30 Stände und löscht keine automatisch. Favoriten können markiert werden. Wiederherstellen übernimmt Fortschritt; „Als neuen Kochabend laden“ beginnt mit leerem Fortschritt. Vollständige Datensicherungen sind exportierbar und über denselben Import wiederherstellbar. Sicherungen bis 10 MB werden geprüft. Browserbereinigung kann lokale Daten entfernen, deshalb eigene Sicherungen aufbewahren.

Nach der ersten erfolgreichen Offline-Vorbereitung sind HTML, Module, Validator, Rezepte und Icons lokal verfügbar. Der Service Worker liefert eine zusammenhängende App-Version. Updates werden angeboten und während eines begonnenen Kochvorgangs zurückgestellt. Nur eigene Caches werden bereinigt.

Audio, Wake Lock und Sprache hängen vom Browser ab. Wake Lock wird bei Bedarf neu angefordert, Fehlschläge werden angezeigt. Vorlesen und optionale Sprachbefehle ergänzen die Tasten. Spracherkennung kann Audio an einen Dienst des Browseranbieters senden. Ein suspendierter oder gesperrter Browser garantiert keine Hintergrundalarme; physische iOS-Safari-/Standby-Tests bleiben erforderlich.

## Codeaufteilung

```text
src/data/       JSON-Import, Schema/Semantik, Altformat, Mengen
src/planning/   Graph, Vorbereitung, Ressourcen, Planung
src/session/    Zustandsübergänge, Timer, Speicherung, Archiv
src/ui/         Ansichten und responsive Gestaltung
src/platform/   Audio, Sprache, Wake Lock, Teilen, Downloads
src/app.js      Router und Integration
schemas/       versionierter Eingabevertrag
tests/         Node-Tests und Browser-Abläufe
scripts/       Validator-/Offline-Build und Beispieldaten
```

`REVIEW.md` und `CURSOR_REVIEW.md` dokumentieren die frühere Version. Maßgeblich für den aktuellen Aufbau sind README, Schema und Tests.
