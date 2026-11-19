# exam.net Anonymisierer – Plan

Stand: 2026-11-18. Noch nichts gebaut.

## Ziel

Aufsätze einer Klasse aus mehreren exam.net-Prüfungen holen, Schüler/innen über alle Prüfungen
hinweg gleich pseudonymisieren («Grauer Fuchs»), anonymisierte Texte + separaten Schlüssel
herunterladen. Zweck: Längsschnitt-Analysen mit KI. Keine KI im Tool selbst.

## Form

- **Lesezeichen-Knopf** (Bookmarklet). Muster wie `ExamNetScreenshots`: Installationsseite
  `index.html` baut den `javascript:`-Link, der `tool.js` vom eigenen Server lädt
  (immer aktuelle Version). Das Tool erscheint als Overlay (Shadow DOM, damit exam.net-CSS
  nicht stört) über exam.net und nutzt das Login der Lehrperson.
- **Manueller Upload** auf derselben Installationsseite: gleiche Logik ohne exam.net.
- Deployment: **GitHub Pages** (öffentliches Repo, statisch). Netlify ist nicht nötig: Kein
  Proxy (das Tool läuft auf der exam.net-Seite selbst, also same-origin), kein API-Key, keine Queue.
  Abweichung von der globalen Vorgabe «Railway oder Netlify» → im lokalen CLAUDE.md begründen.
  Bookmarklet lädt `https://<user>.github.io/<repo>/tool.js`.
- Vanilla JS, keine Abhängigkeiten. ZIP-Erzeugung (stored ZIP + CRC32) aus
  `ExamNetExport/public/index.html` übernehmen (`zipStore`, `crc32`). Entpacken (Upload von
  .docx/.zip) über die eingebaute `DecompressionStream('deflate-raw')`.
- Datenschutz: Schülerdaten verlassen den Browser nie. Auf GitHub Pages liegt nur Code.

## exam.net-Datenquellen (verifiziert 2026-11-18, inoffiziell)

| Zweck | Adresse | Inhalt |
|---|---|---|
| Ordner (= Klassen) | `GET /api/groups` | `{groups:[{id,title,color}]}` |
| Prüfungen eines Ordners | `GET /api/exams/?group={id}` | `{exams:[{id,name,created_at,anonymous,student_exam_name_settings,…}]}` |
| Alle Abgaben einer Prüfung | `GET /print/exams/{examId}` (HTML) | Attribut `:students` von `<exam-print-view>` = JSON-Array |

Pro Abgabe in `:students`: `id, firstName, lastName, email, class, teacher, extra, answer,
created_at, leave_time, is_demo`.
- `answer` = Aufsatz als HTML-String.
- `extra` = JSON-String mit `ip, ua, cores, screen, webgl, browserBlocking, deviceIdentifier, entry_source`.
- Keine CSP auf exam.net → Bookmarklet darf Skript nachladen.
- Alles same-origin mit Cookies (`credentials:'include'`), keine CORS-Probleme.

Befund Klasse 6c: `student_exam_name_settings = {"choice":"examKey"}` → SuS tippen Namen
selbst ein. «Rekonstruktion 3»: 12/12 nur Vorname, keine E-Mail. «Savva» und «Savva 2» kommen vor.
`deviceIdentifier` (21 Zeichen) über Prüfungen hinweg meist stabil: Rek. 1 → 8 Treffer,
alle gleicher Name; Rek. 2 → 9 Treffer, 8 gleicher Name, 1 abweichend.

## Ablauf im Tool

1. **Klasse wählen** – Liste der Ordner.
2. **Prüfungen wählen** – Checkboxen (Titel, Datum), mehrere.
3. **Schlüssel laden (optional)** – CSV aus einem früheren Lauf, damit Codenamen gleich bleiben.
4. **Laden** – `/print/exams/{id}` für jede gewählte Prüfung, Fortschrittsanzeige.
5. **Zuordnung klären** – Rückfragen «Gleiche Person?» (siehe unten).
6. **Schüler/innen wählen** – Liste der Personen (Codename + echte Namen + Abgaben),
   «Alle» / «Keine» / einzeln. Sehr kurze Abgaben (z.B. 24 Zeichen, abgebrochenes Login)
   sind markiert und einzeln abwählbar.
7. **Exportformat wählen und herunterladen** (siehe unten). Schlüssel separat.

## Zuordnung (ohne KI)

Jede Abgabe ist ein Knoten; Personen aus einem geladenen Schlüssel sind ebenfalls Knoten.
Zusammenführen per Union-Find.

Automatisch zusammenführen:
- gleiche E-Mail (Gross/Klein egal);
- gleicher normalisierter Name (klein, Akzente/Leerzeichen vereinheitlicht) **und** die beiden
  Gruppen kommen in keiner gemeinsamen Prüfung vor (sonst wären es zwei verschiedene Personen
  mit gleichem Namen → Rückfrage);
- Name passt zu einer Schreibweise einer Schlüssel-Person (gleiche Regel).

Rückfrage stellen bei:
- gleicher `deviceIdentifier`, aber anderer Name (geliehener Laptop? Tippfehler?);
- ähnlichen Namen: Levenshtein ≤ 2, oder gleich nach Entfernen von Ziffern/Satzzeichen
  («Savva 2», «Peter2»), oder Vorname gleich und Nachname fehlt bei einer Seite;
- gleichem Namen innerhalb derselben Prüfung (Doppel-Login oder zwei Personen).

Nie zusammenführen: zwei verschiedene E-Mails; zwei verschiedene Personen aus dem Schlüssel.

Rückfrage-Karte zeigt: beide Namen, Prüfung(en), Datum, Wortzahl, gleiches Gerät ja/nein,
Textanfang. Knöpfe «Gleiche Person» / «Verschiedene Personen». Nach jeder Runde neu
berechnen, bis keine offenen Fragen mehr. «Nein»-Antworten werden gemerkt.

Zwei Abgaben derselben Person in einer Prüfung (Doppel-Login): beide behalten, chronologisch
hintereinander, mit Hinweis «(2 Abgaben)».

## Codenamen

- Farbe + Tier mit korrekter Adjektivendung: «Grauer Fuchs», «Graue Eule», «Graues Pferd».
- Nur neutrale Tiere (kein Schwein, Esel, Ratte, Kuh, Faultier …). Ca. 12 Farben × 45 Tiere.
- Zufällig vergeben, eindeutig innerhalb des Schlüssels; bestehende Codenamen aus dem
  Schlüssel werden nie geändert.

## Anonymisierung des Textes

- `answer`-HTML → reiner Text (Absätze erhalten).
- Ersetzt werden (ganze Wörter, Gross/Klein egal, längste zuerst): E-Mail, Vorname, Nachname,
  voller Name und alle Schreibweisen **aller** Personen der Auswahl (auch Mitschüler/innen,
  die im Text erwähnt werden) → jeweiliger Codename.
- Weggelassen: Druckkopf, IP, Gerät, Browser, alle `extra`-Daten.
- Behalten: Prüfungstitel, Abgabedatum, Wortzahl (für Längsschnitt nötig).
- Hinweis im Tool: Namen, die zugleich normale Wörter sind, werden mitersetzt; Anzahl Ersetzungen
  pro Person wird angezeigt.

## Exportformate (Auswahl im Tool)

Alle Texte als Markdown (.md), gut lesbar für Mensch und KI.

**Reihenfolge sichtbar machen:** Die gewählten Prüfungen werden nach Datum nummeriert
(1, 2, 3 …). Die Nummer steht in jedem Datei- und Abschnittsnamen, zweistellig wenn ≥ 10
Prüfungen (`01`, `02`), damit die Sortierung im Finder stimmt. Kopf jedes Aufsatzes:
`## Aufsatz 2 – Rekonstruktion 2 (2026-09-11) · Grauer Fuchs · 412 Wörter`.
Fehlt eine Person bei einer Prüfung, bleibt die Nummer trotzdem gleich (Lücke sichtbar).

1. **Pro Schüler/in** – Unterauswahl:
   - **Ordner pro Person (Standard)** – ZIP: `Grauer Fuchs/1 Rekonstruktion 1.md`,
     `Grauer Fuchs/2 Rekonstruktion 2.md` …
   - **Eine Datei pro Person** – ZIP: `Grauer Fuchs.md` mit allen Aufsätzen in Reihenfolge.
2. **Pro Aufsatz** – ZIP mit einer Datei pro Prüfung, darin alle Texte dieser Prüfung
   (`1 Rekonstruktion 1.md`).
3. **Alles in einer Datei** – eine .md-Datei, gegliedert nach Person, darin in Reihenfolge.

Codename allein, ohne Nummer.

Schlüssel: separater Knopf, `Schluessel_<Klasse>_<Datum>.csv` (Semikolon, UTF-8 mit BOM für
Excel). Spalten: Codename; E-Mail; Schreibweisen (alle Namen, `|`-getrennt); Geräte-IDs;
Prüfungen. Wird beim nächsten Lauf wieder hochgeladen.

## Manueller Upload

- Pro Aufsatz: Titel + Datum eingeben, Dateien wählen.
- Akzeptiert: .docx, .txt, .md, .zip (mit solchen Dateien darin). Eine Datei = eine Abgabe,
  Name aus dem Dateinamen (im Tool korrigierbar).
- PDF nicht (bräuchte pdf.js). Zu prüfen: Aufbau des exam.net-Downloads «Word (nur
  Freitextantworten)»: eine Datei pro Person oder alle in einer? Danach Parser anpassen.
- Ohne E-Mail/Gerät → Zuordnung nur über Namen (gleiche Regeln, mehr Rückfragen).

## Dateien (geplant)

```
ExamNetAnonymisierer/
  CLAUDE.md        Entscheidungen (GitHub Pages, Vanilla JS, keine Deps), exam.net-Fakten
  PLAN.md          dieses Dokument

  docs/
    index.html     Installationsseite (Knopf zum Ziehen) + manueller Upload
    tool.js        gesamte Logik: Quelle (exam.net | Upload), Zuordnung, Codenamen, Export
```

## Tests

- In Chrome auf exam.net mit Klasse 6c (Rek. 1–3): Zuordnung prüfen, besonders Savva/Savva 2
  und der eine Gerätetreffer mit abweichendem Namen.
- Export der drei Formate kontrollieren: keine echten Namen/E-Mails mehr im Text
  (automatischer Check vor dem Download: Suche nach allen Originalnamen, Warnung bei Treffern).
- Schlüssel wieder laden → gleiche Codenamen.

## Risiken

- Inoffizielle Schnittstelle: exam.net kann `/print/exams/…` oder die Prop-Namen ändern.
  Tool zeigt dann eine klare Fehlermeldung.
- Geräte-ID ist kein Beweis (geliehene/getauschte Laptops) → nur Hinweis, nie allein automatisch.
- Künftig eindeutig: in exam.net Schul-Login (Microsoft) verlangen → E-Mail vorhanden.

## Entscheidungen (2026-11-19)

- Codename allein; Reihenfolge über Nummer der Prüfung (1, 2, 3).
- «Pro Schüler/in» wählbar: Ordner pro Person (Standard) oder eine Datei pro Person.
- Hosting: GitHub Pages, kein Netlify.

## Offene Fragen

- Aufbau des exam.net-Downloads «Word (nur Freitextantworten)» (für den Upload-Parser).
- Schlüssel-Nummerierung bei späterem Lauf: Nummern sind pro Export neu (1 = älteste gewählte
  Prüfung). Für echte Längsschnitte über mehrere Läufe evtl. Datum im Dateinamen ergänzen.
