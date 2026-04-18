# @udondan/anton

Node.js-Paket zur Überwachung des Lernfortschritts von Kindern auf [anton.app](https://anton.app). Es kapselt die inoffizielle anton.app-API und bietet drei Schnittstellen über einen gemeinsamen Kern:

- **SDK** — importierbare `Anton`-Klasse für Node.js-Projekte
- **CLI** — `anton`-Befehl für das Terminal
- **MCP-Server** — `anton mcp` stellt alle Funktionen als Tools für KI-Assistenten bereit

> **Zweck:** Dieses Paket dient ausschließlich dazu, den Lernfortschritt von Kindern zu verfolgen und Lektionen zu planen — als Unterstützung für Eltern und Erziehungsberechtigte. Es kann **nicht** dazu genutzt werden, beim Lernen zu schummeln oder Lektionen automatisiert abzuschließen. Das Paket stellt dafür keine Funktionen bereit!
>
> **Hinweis:** Dieses Paket nutzt eine inoffizielle, durch Reverse Engineering ermittelte API. Endpunkte können sich jederzeit ohne Vorankündigung ändern.

## Installation

```bash
# Globale Installation (empfohlen für CLI-Nutzung)
npm install -g @udondan/anton

# Ohne Installation direkt nutzen
ANTON_LOGIN_CODE=DEIN-CODE npx @udondan/anton status
```

## Konfiguration

| Variable                 | Erforderlich             | Beschreibung                                                                |
| ------------------------ | ------------------------ | --------------------------------------------------------------------------- |
| `ANTON_LOGIN_CODE`       | Ja (oder `ANTON_LOG_ID`) | Der 8-stellige Eltern-Login-Code aus der Anton-App                          |
| `ANTON_LOG_ID`           | Alternative zu obigem    | Interne Log-ID (z. B. `L-...`)                                              |
| `ANTON_GROUP`            | Nein                     | Wählt die Standardgruppe bei mehreren Gruppen (Groß-/Kleinschreibung egal)  |
| `ANTON_ASSIGNMENTS_FILE` | Nein                     | Pfad zur Aufgaben-JSON-Datei (Standard: `~/.config/anton/assignments.json`) |
| `ANTON_NO_SESSION_CACHE` | Nein                     | Auf `1` setzen, um den CLI-Session-Cache zu deaktivieren                    |

---

## SDK

### Installation

```bash
npm install @udondan/anton
```

### Schnellstart

```ts
import { Anton } from '@udondan/anton';

const anton = new Anton({ loginCode: 'DEIN-CODE' });
await anton.connect();

// Authentifizierungs- und Gruppenübersicht
console.log(anton.getStatus());

// Wochenzusammenfassung für ein Kind
console.log(await anton.getWeeklySummary({ childName: 'Emma' }));
```

### API-Referenz

#### Authentifizierung

```ts
const anton = new Anton({ loginCode: 'ABCD-1234' });
// oder
const anton = new Anton({ logId: 'L-...' });

await anton.connect(); // muss vor allen anderen Methoden aufgerufen werden
```

#### Status & Gruppe

```ts
// Authentifizierungsstatus + Gruppenübersicht (kein Netzwerkaufruf)
anton.getStatus();

// Familienmitglieder + aktuell zugewiesene Blöcke
await anton.getGroup();

// Lernende auflisten
anton.listChildren();
```

#### Lektionen zuweisen

```ts
// Block per Kurs + Thema + Block zuweisen (wird intern aufgelöst)
await anton.pinBlock({
  project: 'c-mat-4',
  topicIndex: 6, // 0-basiert, aus listTopics()
  blockIndex: 1, // 0-basiert innerhalb des Themas
  weekStartAt: '2025-09-01', // Montag; Standard: aktuelle Woche
  childName: 'Emma', // weglassen = gesamte Gruppe
});

// Oder Block direkt über PUID angeben
await anton.pinBlock({
  blockPuid: 'c-mat-4/ro9ajj',
  blockPath: '/../c-mat-4/topic-07-brueche/block-02-brueche-zuordnen/block',
  weekStartAt: '2025-09-01',
});

// Zuweisung entfernen
await anton.unpinBlock({
  blockPuid: 'c-mat-4/ro9ajj',
  weekStartAt: '2025-09-01',
});

// Aktuelle Gruppenzuweisungen abrufen
await anton.getGroupAssignments({ week: '2025-09-01', childPublicId: 'P-...' });
```

#### Fortschritt & Ereignisse

```ts
// Fortschrittsübersicht (abgeschlossene Level + Sterne)
await anton.getProgress({ childName: 'Emma', since: '2025-01-01' });

// Rohes Ereignisprotokoll
await anton.getEvents({
  childName: 'Emma',
  eventType: 'finishLevel',
  limit: 50,
});

// Performance pro Level (reviewReport-API)
await anton.getLevelProgress({
  levelPuid: 'c-mat-4/abc123',
  childName: 'Emma',
});
```

#### Analysen

```ts
// Wochenrückblick: Level, Zeit, Sterne, zugewiesen vs. selbstgewählt
await anton.getWeeklySummary({ childName: 'Emma', weekStartAt: '2025-09-01' });

// Pro Fach: Trefferquote, Sterne, Zeit, Trend
await anton.getSubjectSummary({ childName: 'Emma', subject: 'mat' });

// Aktive Tage, Lernsträhnen, Lücken
await anton.getActivityTimeline({ childName: 'Emma', since: '2025-01-01' });

// Welche zugewiesenen Blöcke hat das Kind abgeschlossen?
await anton.checkAssignmentCompletion({
  childName: 'Emma',
  week: '2025-09-01',
});

// Alle Kinder im Vergleich
await anton.compareChildren();
```

#### Lernkatalog

```ts
// ~285 Kurse durchsuchen
await anton.listPlans({ subject: 'mat', grade: 4, language: 'de' });

// Themen eines Kurses (leichtgewichtig — vor getTopicBlocks verwenden)
await anton.listTopics({ project: 'c-mat-4' });

// Blöcke + Level eines einzelnen Themas
await anton.getTopicBlocks({ project: 'c-mat-4', topicIndex: 6 });
// oder per Titel:
await anton.getTopicBlocks({ project: 'c-mat-4', topicTitle: 'Brüche' });

// Vollständige Hierarchie Thema→Block→Level (groß — lieber listTopics + getTopicBlocks)
await anton.getPlan({ project: 'c-mat-4' });

// Lektionsinhalt (Aufgaben, Trainer)
await anton.getLesson({ fileId: 'level/c-mat-4/...' });
```

#### Lokale Aufgaben

Lokale Aufgaben werden in einer JSON-Datei gespeichert und sind unabhängig von der anton.app-API — nützlich für eigene Notizen und Tracking.

```ts
// Erstellen
const a = anton.assignLesson({
  childName: 'Emma',
  fileId: 'level/...',
  lessonTitle: 'Brüche 1',
});

// Auflisten
anton.listAssignments({ childName: 'Emma', status: 'pending' });

// Aktualisieren
anton.updateAssignment(a.id, {
  status: 'completed',
  note: 'Auf Anhieb geschafft!',
});

// Löschen
anton.deleteAssignment(a.id);
```

---

## CLI

### Einstieg

```bash
export ANTON_LOGIN_CODE='DEIN-CODE'
anton status
```

### Befehle

#### Statusbefehle

```bash
anton status        # Authentifizierungsinfo + Gruppenübersicht
anton group         # Familiengruppe + aktuell zugewiesene Blöcke
anton children      # Kinder auflisten
```

#### Kursbefehle

```bash
anton plans                               # alle ~285 Kurse
anton plans --subject mat --grade 4       # gefiltert nach Fach und Klasse
anton topics c-mat-4                      # Themen eines Kurses
anton blocks c-mat-4 --topic-index 6      # Blöcke eines Themas (per Index)
anton blocks c-mat-4 --topic-title Brüche # Blöcke eines Themas (per Titel)
anton plan c-mat-4                        # vollständige Hierarchie (große Ausgabe)
anton lesson level/c-mat-4/...            # Lektionsinhalt
```

#### Zuweisungsbefehle

```bash
# Zuweisung per Thema-/Block-Index
anton pin c-mat-4 --topic-index 6 --block-index 1 --child Emma --week 2025-09-01

# Zuweisung per Titelsuche
anton pin c-mat-4 --topic-title Brüche --block-title "zuordnen" --child Emma

# Aktuelle Gruppenzuweisungen anzeigen
anton pins
anton pins --week 2025-09-01 --child Emma

# Zuweisung entfernen
anton unpin c-mat-4/ro9ajj 2025-09-01
```

#### Fortschritt & Analysen

```bash
anton progress Emma                          # alle abgeschlossenen Level + Sterne
anton events Emma --type finishLevel -n 20   # rohes Ereignisprotokoll
anton level-progress c-mat-4/abc123 Emma     # Performance pro Level
anton weekly Emma                            # Zusammenfassung der aktuellen Woche
anton weekly Emma --week 2025-09-01
anton subjects Emma                          # Trefferquote + Trend pro Fach
anton subjects Emma --subject mat
anton timeline Emma                          # Lernsträhnen, aktive Tage, Lücken
anton timeline Emma --since 2025-01-01
anton completion Emma                        # Abschlussstatus zugewiesener Blöcke
anton compare                                # alle Kinder im Vergleich
```

#### Aufgabenverwaltung

```bash
anton assign Emma level/c-mat-4/... --title "Brüche 1"
anton assignments --child Emma --status pending
anton update-assignment <id> --status completed
anton delete-assignment <id>
```

#### Globale Optionen

```bash
anton --no-cache <befehl>   # Session-Cache überspringen, immer neu anmelden
```

---

## MCP-Server

Der MCP-Server stellt alle 24 Tools über stdio bereit und ermöglicht KI-Assistenten wie Claude, den Lernfortschritt der Kinder zu analysieren und Lektionen automatisch zuzuweisen.

### Einrichtung in Claude Code

**Mit globaler Installation:**

```bash
claude mcp add --env ANTON_LOGIN_CODE=DEIN-CODE anton -- anton mcp
```

**Ohne Installation, direkt über npx:**

```bash
claude mcp add --env ANTON_LOGIN_CODE=DEIN-CODE anton -- npx @udondan/anton mcp
```

Für eine projektweite Konfiguration (`.claude/settings.json`):

```bash
claude mcp add --scope project --env ANTON_LOGIN_CODE=DEIN-CODE anton -- npx @udondan/anton mcp
```

### Einrichtung in Claude Desktop

**Mit globaler Installation** — in `claude_desktop_config.json`:

```json
{
  "mcpServers": {
    "anton": {
      "command": "anton",
      "args": ["mcp"],
      "env": {
        "ANTON_LOGIN_CODE": "DEIN-CODE"
      }
    }
  }
}
```

**Ohne Installation, direkt über npx:**

```json
{
  "mcpServers": {
    "anton": {
      "command": "npx",
      "args": ["@udondan/anton", "mcp"],
      "env": {
        "ANTON_LOGIN_CODE": "DEIN-CODE"
      }
    }
  }
}
```

### Anwendungsbeispiele mit Claude

Sobald der MCP-Server eingerichtet ist, kann Claude automatisch auf alle Daten zugreifen und komplexe Aufgaben übernehmen. Hier sind einige Beispiele für Prompts:

---

**Fortschrittsanalyse:**

> „Wie hat sich Emma diese Woche beim Lernen geschlagen? Welche Fächer laufen gut, wo gibt es Schwächen?"

Claude ruft dabei `get_weekly_summary`, `get_subject_summary` und `get_activity_timeline` ab und liefert eine zusammenhängende Auswertung — Lernzeit, Trefferquoten, Lernsträhnen und Fächer mit Verbesserungs- oder Nachholbedarf.

---

**Automatische Lektionszuweisung basierend auf Lernhistorie:**

> „Schau dir an, was Emma in Mathematik diese Woche gemacht hat, und weise ihr für nächste Woche die nächsten passenden Lektionen zu."

Claude analysiert dafür:

1. `get_weekly_summary` — was wurde diese Woche bearbeitet
2. `get_subject_summary` — Stärken und Schwächen pro Fach
3. `check_assignment_completion` — wurden die zugewiesenen Blöcke abgeschlossen
4. `list_topics` + `get_topic_blocks` — welche Blöcke kommen als nächstes im Kurs
5. `pin_block` — die nächsten passenden Blöcke direkt zuweisen

---

**Alle Kinder auf einmal versorgen:**

> „Vergleiche alle Kinder und weise jedem für nächste Woche zwei Lektionen zu, die zu seinem aktuellen Stand passen — bei Schwächen Wiederholungsstoff, sonst das nächste Thema."

Claude nutzt `compare_children` für den Überblick, analysiert pro Kind die Fachtrends aus `get_subject_summary` und die Lernhistorie aus `get_events`, sucht dann in `list_topics` + `get_topic_blocks` passende Folgeblöcke oder Wiederholungseinheiten heraus und weist sie per `pin_block` zu.

---

**Lernrückstand erkennen:**

> „Hat Emma in letzter Zeit Lernlücken? Wann hat sie zuletzt Mathematik gemacht und gibt es Themen, bei denen sie viele Fehler hatte?"

Claude kombiniert `get_activity_timeline` (Lücken und Strähnen), `get_subject_summary` (Fachtrend) und `get_events` (Fehlerrate pro Lektion), um gezielte Hinweise zu geben.

---

**Wöchentlichen Lernplan erstellen:**

> „Erstelle für Emma und Jonas je einen Lernplan für die nächsten zwei Wochen — abgestimmt auf ihre bisherigen Fortschritte und offenen Lektionen."

Claude liest für jedes Kind den bisherigen Verlauf, prüft mit `check_assignment_completion` offene Aufgaben, sucht mit `list_topics` die nächsten Lernschritte und weist sie wochenweise per `pin_block` zu.

---

### Verfügbare MCP-Tools

| Tool                          | Beschreibung                                                |
| ----------------------------- | ----------------------------------------------------------- |
| `get_status`                  | Authentifizierungsstatus, Gruppeninfo, konfigurierte Kinder |
| `list_groups`                 | Alle Gruppen, denen der Elternteil angehört                 |
| `get_group`                   | Familienmitglieder + aktuell zugewiesene Blöcke             |
| `get_group_assignments`       | Zugewiesene Blöcke, filterbar nach Kind/Woche               |
| `pin_block`                   | Lektionsblock der Gruppe oder einem Kind zuweisen           |
| `unpin_block`                 | Zuweisung entfernen                                         |
| `list_children`               | Kinder auflisten                                            |
| `get_progress`                | Abgeschlossene Level + Sterne für ein Kind                  |
| `get_events`                  | Rohes Ereignisprotokoll für ein Kind                        |
| `get_level_progress`          | Performance pro Level (reviewReport-API)                    |
| `check_assignment_completion` | Welche zugewiesenen Blöcke hat ein Kind abgeschlossen       |
| `get_weekly_summary`          | Wochenrückblick: Level, Zeit, Sterne                        |
| `get_subject_summary`         | Pro Fach: Trefferquote, Sterne, Zeit, Trend                 |
| `get_activity_timeline`       | Aktive Tage, Lernsträhnen, Lücken                           |
| `compare_children`            | Alle Kinder im Vergleich                                    |
| `list_plans`                  | ~285 Kurse nach Fach/Klasse durchsuchen                     |
| `list_topics`                 | Thementitel + Indizes für einen Kurs                        |
| `get_topic_blocks`            | Blöcke + Level für ein einzelnes Thema                      |
| `get_plan`                    | Vollständige Hierarchie Thema→Block→Level                   |
| `get_lesson`                  | Lektionsinhalt (Aufgaben, Trainer) per fileId               |
| `list_assignments`            | Lokale Aufgabenliste                                        |
| `assign_lesson`               | Lokale Aufgabe erstellen                                    |
| `update_assignment`           | Lokale Aufgabe aktualisieren                                |
| `delete_assignment`           | Lokale Aufgabe löschen                                      |

---

## Lizenz

MIT
