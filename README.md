# Quiz-Ecke

Live-Quiz zum Mitmachen mit dem Handy – mit eigenem Design, Animationen und Präsentationsmodus für den Beamer.
Gesponsert vom **ITB Projekt**.

## Starten

```bash
npm start
```

Danach läuft die Seite auf `http://localhost:3000`. Es werden keine zusätzlichen Pakete gebraucht (nur Node.js 18 oder neuer).

## Funktionen

- **Mitspielen:** Code eingeben (oder QR-Code scannen), Namen und Avatar wählen, ab in die Lobby
- **Punkte nach Tempo:** bis zu 1000 Punkte pro Frage, je schneller, desto mehr; Serien geben bis zu +500 Bonus
- **Ablauf pro Frage:** Countdown → Frage → Auflösung mit Antwort-Statistik → Zwischenstand
- **Präsentationsmodus (Beamer):** großer Code, QR-Code, Spieler in der Lobby, Fragen, Diagramm, Rangliste und Siegerpodest
- **Automatisch oder manuell:** Die Runde läuft allein weiter oder der Host klickt auf „Weiter“
- **Später einsteigen:** Wer zu spät kommt, steigt mitten in der Runde ein
- **Nochmal spielen:** Alle Mitspieler landen direkt wieder in der Lobby
- **Admin-Editor:** Bilder, Zeit, Punkte (Standard / Doppelt / Ohne), mehrere richtige Antworten, Wahr/Falsch-Fragen, Fragen kopieren, Fragen mischen
- **Quizze:** duplizieren, als JSON exportieren und importieren, Ergebnisse als CSV herunterladen
- **Sounds & Animationen:** Töne werden im Browser erzeugt (abschaltbar), Konfetti, Podest-Animation, schwebender Hintergrund

## Einstellungen beim Hosting (Umgebungsvariablen)

| Variable | Bedeutung | Standard |
| --- | --- | --- |
| `PORT` | Port des Servers | `3000` |
| `ADMIN_EMAIL` / `ADMIN_PASSWORD` | Admin-Zugang | siehe `server.js` |
| `DATA_DIR` | Speicherort für Quizze und Bilder | `./data` |
| `SPONSOR_NAME` | Name des Sponsors | `ITB Projekt` |
| `SPONSOR_URL` | Link zum Sponsor (muss mit `https://` beginnen) | – (ohne Link) |
| `EVENT_BADGE` | Kleines Abzeichen in der Kopfzeile (leer = aus) | `70. Geburtstag` |

## Dateien

- `server.js` – Server und Spiellogik
- `questions.js` – Start-Fragen für den allerersten Start
- `public/index.html` – Seitenaufbau
- `public/style.css` – Design und Animationen
- `public/app.js` – Logik im Browser
- `public/qrcode.js` – QR-Code-Generator (MIT-Lizenz, Kazuhiko Arase)
