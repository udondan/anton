---
name: anton
description: >
  Reference skill for operating the Anton CLI (@udondan/anton) to monitor
  children's learning on anton.app. Use this skill whenever you need to run
  `anton` commands — checking a child's progress, browsing lesson plans,
  pinning or unpinning lesson blocks, reviewing weekly activity, checking
  assignment completion, or managing local assignments. Trigger for any task
  involving the Anton CLI, even if the user just says "check how Emma did this
  week" or "pin the fractions lesson for Max" — those map directly to CLI
  commands covered here.
---

# Anton CLI Reference

## Invocation

```bash
# If @udondan/anton is installed globally:
anton <command> [options]

# Otherwise (no global install needed):
npx @udondan/anton <command> [options]
bunx @udondan/anton <command> [options]
```

All output is JSON printed to stdout — pipe to `jq` to filter or extract fields:

```bash
# Pretty-print (default behaviour)
anton weekly Lea | jq .

# Extract a single field
anton weekly Lea | jq '.totalLevels'

# Filter completed levels by subject
anton progress Lea | jq '.completedLevels[] | select(.puid | startswith("c-mat"))'

# List topic titles with their indices
anton topics c-mat-4 | jq '.[] | {index: .index, title: .title}'

# Get just block titles for a topic
anton blocks c-mat-4 --topic-index 6 | jq '.blocks[] | .title'
```

---

## Authentication

Set credentials via a config file **or** environment variables — env vars take precedence.

### Config file

Store credentials permanently in `~/.config/anton/config`. The file **must** have mode `0600` — on POSIX systems the CLI will ignore it with a warning if group/world bits are set (`chmod 0600 ~/.config/anton/config`):

```
# ~/.config/anton/config
ANTON_LOGIN_CODE=ABCD-1234
ANTON_GROUP=Family
```

Lines starting with `#` are comments.

### Environment variables

Set at least one of these before running any command:

| Variable                 | Required         | Purpose                                                                                                                          |
| ------------------------ | ---------------- | -------------------------------------------------------------------------------------------------------------------------------- |
| `ANTON_LOGIN_CODE`       | one of these two | 8-character parent login code                                                                                                    |
| `ANTON_LOG_ID`           | one of these two | Alternative: parent log ID (starts with `L-`)                                                                                    |
| `ANTON_GROUP`            | optional         | Default group name when parent belongs to multiple groups. Matched case-insensitively. Falls back to the first group when unset. |
| `ANTON_ASSIGNMENTS_FILE` | optional         | Path to local assignments JSON (default: `~/.config/anton/assignments.json`)                                                     |
| `ANTON_NO_SESSION_CACHE` | optional         | Set to `1` to always bypass session cache (same as `--no-cache`)                                                                 |

```bash
export ANTON_LOGIN_CODE='ABCD-1234'
anton status
```

If auth fails after a long session or you see `401`/`unauthorized` errors, the cached session may be stale — rerun with `--no-cache` to force a fresh login.

---

## Global Flags

These apply to every command and must come **before** the subcommand:

| Flag             | Description                                                     |
| ---------------- | --------------------------------------------------------------- |
| `--group <name>` | Override the active group (takes precedence over `ANTON_GROUP`) |
| `--no-cache`     | Skip the session cache and perform a full login                 |
| `--version`      | Print the package version                                       |
| `--help`         | Print help                                                      |

```bash
anton --group "Family B" progress Lea
anton --no-cache status
```

`--group` selects which family group to operate on — it is not the child name. Omit it when the parent belongs to only one group.

---

## Commands

### Account & Group Info

#### `status`

Show authentication status, all groups the parent belongs to, and children in the active group.

```bash
anton status
```

#### `groups`

List all groups the parent account belongs to, with their full member lists.

```bash
anton groups
```

#### `group`

Show family group details and currently pinned blocks.

```bash
anton group
```

#### `children`

List children in the active group.

```bash
anton children
```

---

### Pinned Assignments

#### `pins`

List lesson blocks currently pinned (assigned) to the group.

| Option           | Description                                                           |
| ---------------- | --------------------------------------------------------------------- |
| `--week <date>`  | Filter to a specific week start date (`YYYY-MM-DD`, must be a Monday) |
| `--child <name>` | Filter to a specific child by display name                            |

```bash
anton pins
anton pins --week 2025-06-16
anton pins --child Lea
```

#### `pin <project>`

Assign a lesson block to the group or a specific child.

| Option                  | Description                                                  |
| ----------------------- | ------------------------------------------------------------ |
| `--topic-index <n>`     | Topic index (0-based) — get from `anton topics <project>`    |
| `--topic-title <title>` | Partial topic title match (case-insensitive)                 |
| `--block-index <n>`     | Block index (0-based) within the topic                       |
| `--block-title <title>` | Partial block title match (case-insensitive)                 |
| `--week <date>`         | Week start date (`YYYY-MM-DD` Monday, default: current week) |
| `--child <name>`        | Child name to assign to (default: whole group)               |

Identify the block with either `--topic-index` or `--topic-title`, and either `--block-index` or `--block-title`. Get topic/block indices from `anton topics` and `anton blocks`.

```bash
# Assign to whole group by topic index + block index
anton pin c-mat-4 --topic-index 6 --block-index 1

# Assign to one child by title match
anton pin c-mat-4 --topic-title "Brüche" --block-title "Brüche zuordnen" --child Lea

# Assign to a specific week
anton pin c-mat-4 --topic-index 6 --block-index 0 --week 2025-06-23
```

#### `unpin <blockPuid> <weekStartAt>`

Remove a pinned block. `blockPuid` is the block's puid (e.g. `c-mat-4/ro9ajj`), `weekStartAt` is the Monday date string.

| Option                  | Description                                               |
| ----------------------- | --------------------------------------------------------- |
| `--child-id <publicId>` | Child's publicId to disambiguate when multiple pins exist |

```bash
anton unpin c-mat-4/ro9ajj 2025-06-16
```

---

### Lesson Catalogue

#### `plans`

Browse the Anton lesson catalogue (~285 courses).

| Option                  | Description                                          |
| ----------------------- | ---------------------------------------------------- |
| `-s, --subject <code>`  | Filter by subject code (e.g. `mat`, `natdeu`, `eng`) |
| `-g, --grade <n>`       | Filter by grade (1–13)                               |
| `-l, --language <lang>` | Filter by language (default: `de`)                   |

```bash
anton plans
anton plans --subject mat --grade 4
anton plans -s eng -g 3
```

#### `topics <project>`

List topics (chapters) for a course. Use this before `blocks` or `pin` to find the right topic index.

```bash
anton topics c-mat-4
```

#### `blocks <project>`

List blocks (and their levels) for a single topic within a course.

| Option                  | Description                                  |
| ----------------------- | -------------------------------------------- |
| `--topic-index <n>`     | Topic index (0-based)                        |
| `--topic-title <title>` | Partial topic title match (case-insensitive) |

```bash
anton blocks c-mat-4 --topic-index 6
anton blocks c-mat-4 --topic-title "Brüche"
```

#### `plan <project>`

Full topic → block → level hierarchy for a course. Can be a large response — prefer `topics` + `blocks` for targeted lookups.

```bash
anton plan c-mat-4
```

#### `lesson <fileId>`

Fetch lesson content (questions, trainers) by file ID.

```bash
anton lesson list/plans
```

---

### Child Progress & Activity

#### `progress <child>`

Learning progress summary for a child — counts, stars, accuracy by subject.

| Option           | Description                                 |
| ---------------- | ------------------------------------------- |
| `--since <date>` | Start date `YYYY-MM-DD` (default: all time) |

```bash
anton progress Lea
anton progress Lea --since 2025-06-01
```

#### `events <child>`

Raw event log for a child (e.g. `finishLevel`, `startLevel`).

| Option            | Description                                          |
| ----------------- | ---------------------------------------------------- |
| `--since <date>`  | Start date `YYYY-MM-DD`                              |
| `--type <event>`  | Filter to a specific event type (e.g. `finishLevel`) |
| `-n, --limit <n>` | Max number of events to return (default: 100)        |

```bash
anton events Lea --type finishLevel -n 20
anton events Luke --since 2025-06-01
```

#### `level-progress <levelPuid> <child>`

Detailed per-level performance for a child via the reviewReport API. `levelPuid` comes from a `finishLevel` event's `puid` field.

```bash
anton level-progress c-mat-4/pr7gkb Lea
```

#### `weekly <child>`

Weekly activity summary — levels completed, time, stars, assigned vs self-directed ratio.

| Option          | Description                                                   |
| --------------- | ------------------------------------------------------------- |
| `--week <date>` | Week start date — Monday `YYYY-MM-DD` (default: current week) |

```bash
anton weekly Lea
anton weekly Lea --week 2025-06-16
```

Output shape:

```json
{
  "childName": "Lea",
  "weekStartAt": "2026-04-13",
  "weekEndAt": "2026-04-19",
  "levelsCompleted": 5,
  "totalDurationSeconds": 312,
  "starsEarned": 2.4,
  "starsMax": 3,
  "averageAccuracy": 0.85,
  "subjectsCovered": ["c-mat-4", "c-natdeu-4"],
  "assignedLevelsCompleted": 3,
  "selfDirectedLevelsCompleted": 2,
  "assignmentRatio": 0.6
}
```

```bash
# Extract key summary fields
anton weekly Lea | jq '{levelsCompleted, starsEarned, averageAccuracy, assignmentRatio}'
```

#### `subjects <child>`

Per-subject accuracy, stars, time spent, and improvement trend.

| Option                 | Description                                     |
| ---------------------- | ----------------------------------------------- |
| `-s, --subject <code>` | Filter by subject prefix (e.g. `mat`, `natdeu`) |

```bash
anton subjects Lea
anton subjects Lea --subject mat
```

#### `timeline <child>`

Active days, streaks, gaps, and daily breakdown for a child.

| Option           | Description                                 |
| ---------------- | ------------------------------------------- |
| `--since <date>` | Start date `YYYY-MM-DD` (default: all time) |

```bash
anton timeline Lea --since 2025-05-01
```

#### `completion <child>`

Check which assigned lesson blocks a child has completed (levels done vs total).

| Option          | Description                                   |
| --------------- | --------------------------------------------- |
| `--week <date>` | Filter to a specific week `YYYY-MM-DD` Monday |

```bash
anton completion Lea
anton completion Lea --week 2025-06-16
```

Output shape:

```json
{
  "childName": "Lea",
  "week": "2025-06-16",
  "assignments": [
    {
      "blockPuid": "c-mat-4/abc123",
      "blockTitle": "Brüche zuordnen",
      "weekStartAt": "2025-06-16",
      "totalLevels": 6,
      "completedLevels": 4,
      "completionRate": 0.67,
      "levels": [
        {
          "puid": "c-mat-4/xyz",
          "title": "Einführung",
          "completed": true,
          "score": 2.7,
          "lastCompletedAt": "2025-06-17T10:00:00Z"
        },
        { "puid": "c-mat-4/uvw", "title": "Test", "completed": false }
      ]
    }
  ],
  "summary": {
    "totalAssignments": 3,
    "fullyCompleted": 1,
    "partiallyCompleted": 1,
    "notStarted": 1
  }
}
```

```bash
# Show incomplete assignments only
anton completion Lea | jq '.assignments[] | select(.completionRate < 1) | {block: .blockTitle, done: .completedLevels, total: .totalLevels}'
# Filter to math only
anton completion Lea | jq '.assignments[] | select(.blockPuid | startswith("c-mat"))'
```

#### `compare`

Side-by-side comparison of all children: stars, accuracy, time, subjects.

```bash
anton compare
```

Output shape:

```json
{
  "children": [
    {
      "childName": "Lea",
      "totalStars": 461.9,
      "averageAccuracy": 0.81,
      "totalDurationSeconds": 23950,
      "activeDays": 22,
      "levelsCompleted": 176,
      "subjects": ["c-mat-4", "c-eng-6", "c-natdeu-4"],
      "lastActiveDate": "2026-04-18"
    }
  ],
  "generatedAt": "2026-04-19T09:00:00Z"
}
```

```bash
# Rank children by accuracy
anton compare | jq '.children | sort_by(-.averageAccuracy) | .[] | {name: .childName, accuracy: .averageAccuracy, stars: .totalStars}'
# Compare levels completed
anton compare | jq '.children[] | {name: .childName, levels: .levelsCompleted, activeDays: .activeDays}'
```

---

### Local Assignments

These commands manage a local JSON store at `~/.config/anton/assignments.json` (or the path in `ANTON_ASSIGNMENTS_FILE`). They don't require API auth.

#### `assignments`

List local assignments.

| Option              | Description                                           |
| ------------------- | ----------------------------------------------------- |
| `--child <name>`    | Filter by child name                                  |
| `--status <status>` | Filter by status: `pending`, `completed`, `cancelled` |

```bash
anton assignments
anton assignments --child Lea --status pending
```

#### `assign <child> <fileId>`

Create a local assignment for a child.

| Option            | Description                 |
| ----------------- | --------------------------- |
| `--title <title>` | Human-readable lesson title |
| `--note <note>`   | Optional note               |

```bash
anton assign Lea list/plans/c-mat-4/topic-07/block-02 --title "Fractions" --note "Focus on part 2"
```

#### `update-assignment <id>`

Update a local assignment.

| Option              | Description                                     |
| ------------------- | ----------------------------------------------- |
| `--status <status>` | New status: `pending`, `completed`, `cancelled` |
| `--note <note>`     | Updated note                                    |

```bash
anton update-assignment abc-123 --status completed
```

#### `delete-assignment <id>`

Delete a local assignment by ID.

```bash
anton delete-assignment abc-123
```

---

## Common Subject Codes

Used with `--subject` in `plans` and `subjects`, and as the prefix of `project` IDs:

| Code     | Subject                          |
| -------- | -------------------------------- |
| `mat`    | Mathematics                      |
| `natdeu` | German (language arts / Deutsch) |
| `eng`    | English                          |
| `sach`   | General studies (Sachkunde)      |
| `phy`    | Physics                          |
| `che`    | Chemistry                        |
| `bio`    | Biology                          |
| `geo`    | Geography                        |
| `his`    | History                          |
| `inf`    | Computer science (Informatik)    |
| `lat`    | Latin                            |
| `fra`    | French                           |

Project IDs follow the pattern `c-{subject}-{grade}`, e.g. `c-mat-4` = Mathematics Grade 4, `c-eng-3` = English Grade 3.

---

## Discovering Valid IDs

All IDs used in commands (`project`, `blockPuid`, `topicIndex`, `blockIndex`, `fileId`) must be looked up from the API — they are not guessable beyond the subject/grade pattern. Here is how to find each one.

### Project ID (`c-mat-4`, `c-eng-3`, …)

```bash
# List all ~285 courses
anton plans

# Filter by subject and/or grade
anton plans --subject mat --grade 4
```

Each result contains an `id` field — that is the project ID to use in `topics`, `blocks`, `plan`, and `pin`.

### Topic index

Topic indices are 0-based positions within a course's topic list. They are not stored anywhere — you derive them at query time:

```bash
anton topics c-mat-4 | jq '.[] | {index: .index, title: .title}'
```

### Block index

Block indices are 0-based positions within a topic. Derive them the same way:

```bash
anton blocks c-mat-4 --topic-index 6 | jq '.blocks[] | {index: .index, title: .title}'
```

### Block puid (for `unpin`)

The block puid (e.g. `c-mat-4/ro9ajj`) appears in `anton blocks`, `anton pins`, and `anton completion`:

```bash
# From the catalogue — blocks have a puid field
anton blocks c-mat-4 --topic-index 6 | jq '.blocks[] | {puid: .puid, title: .title}'

# From current pins
anton pins | jq '.[] | {puid: .puid, title: .blockTitle, week: .weekStartAt}'

# From completion history
anton completion Lea | jq '.assignments[] | {puid: .blockPuid, title: .blockTitle}'
```

### Level puid (for `level-progress`)

Level puids come from `finishLevel` events in the event log:

```bash
anton events Lea --type finishLevel -n 20 | jq '.[] | {puid: .puid, block: .blockTitle, level: .levelTitle}'
```

### File ID (for `lesson` and `assign`)

File IDs live on individual **levels** (not blocks). Get them from `anton blocks` output:

```bash
# List all levels with their fileIds for a topic
anton blocks c-mat-4 --topic-index 6 | jq '.blocks[] | {block: .title, levels: [.levels[] | {title: .title, fileId: .fileId}]}'
```

Example fileId: `level/c-mat-4/topic-06-schriftliche-division/block-01-schriftliche-division-kennenlernen/level-01`

Pass this directly to `anton lesson <fileId>` to fetch the lesson content, or to `anton assign <child> <fileId>` to create a local assignment.

---

## Typical Workflows

### Check a child's overall progress

```bash
anton progress Lea
# Or filtered to recent activity:
anton progress Lea --since 2025-06-01
```

### Check what's happening this week

```bash
anton weekly Lea
anton completion Lea         # which assigned blocks are done?
anton pins --child Lea       # what's currently assigned?
```

### Find and pin a specific lesson block

1. Browse courses to find the right project:

   ```bash
   anton plans --subject mat --grade 4
   # Note the project ID, e.g. c-mat-4
   ```

2. List topics to find topic index:

   ```bash
   anton topics c-mat-4
   # Note the index of the topic you want, e.g. index 6 = "Brüche"
   ```

3. List blocks in that topic to find block index:

   ```bash
   anton blocks c-mat-4 --topic-index 6
   # Note the block index, e.g. index 1 = "Brüche zuordnen"
   ```

4. Pin the block:

   ```bash
   # For the whole group:
   anton pin c-mat-4 --topic-index 6 --block-index 1

   # For one child only:
   anton pin c-mat-4 --topic-index 6 --block-index 1 --child Lea
   ```

### Check assignment completion after the week

```bash
anton completion Lea --week 2025-06-16
```

### Compare all children

```bash
anton compare
```

### Plan next week's pins per child

This workflow determines what to assign next based on each child's actual history — their active grade level, recent accuracy, and what's already been completed or partially done. Run it once per child, then optionally assign a shared block to the whole group if both children are at a similar point.

#### Step 1 — Gather each child's current state

```bash
# Where are they working and how well?
anton subjects Lea
anton subjects Luke

# What did they complete from last week's pins?
anton completion Lea --week <last-monday>
anton completion Luke --week <last-monday>

# What are they already pinned for this week?
anton pins --child Lea --week <this-monday>
anton pins --child Luke --week <this-monday>
```

Extract the subjects each child has been active in and their accuracy per subject:

```bash
anton subjects Lea | jq '.[] | {subject: .subject, accuracy: .accuracy, trend: .trend, stars: .stars}'
```

#### Step 2 — Determine the right grade level per child per subject

Use this decision logic based on `averageAccuracy` across recent sessions in a subject:

| Accuracy    | Action                                                        |
| ----------- | ------------------------------------------------------------- |
| < 0.65      | Drop one grade level — the current material is too hard       |
| 0.65 – 0.79 | Stay at current grade — consolidate before moving on          |
| 0.80 – 0.89 | Stay at current grade or try the next block in the same topic |
| ≥ 0.90      | Ready to advance — move to next topic or next grade level     |

The `trend` field reinforces this: an `improving` trend with accuracy 0.75 is a better sign than a `stable` trend at 0.85.

Also check the `completion` output from the previous week:

- `completionRate < 0.5` on a block → child struggled or ran out of time; re-pin it or pin an easier block in the same topic
- `completionRate = 1` with high scores → ready to move forward
- Block not started at all → consider whether it was too hard, or just not attempted; re-pin or replace

#### Step 3 — Find the right next block in the catalogue

Once you know the subject and approximate grade level for a child:

```bash
# Confirm which grade-level course to use
anton plans --subject mat --grade 4

# See all topics — find where the child left off
anton topics c-mat-4 | jq '.[] | {index: .index, title: .title}'

# Check which blocks in that topic the child has already done
anton completion Lea | jq '.assignments[] | select(.blockPuid | startswith("c-mat-4")) | {block: .blockTitle, rate: .completionRate}'

# List blocks in the next topic to pick from
anton blocks c-mat-4 --topic-index 7 | jq '.blocks[] | {index: .index, title: .title}'
```

Pick the **first block in the next topic they haven't completed**, or the **partially completed block** from the previous week if `completionRate > 0` and `< 1`.

#### Step 4 — Pin per child, then evaluate a shared group pin

```bash
# Pin individually — each child gets their own block
anton pin c-mat-4 --topic-index 7 --block-index 0 --child Lea
anton pin c-natdeu-2 --topic-index 3 --block-index 1 --child Luke

# If both children are at similar points in a subject, also pin a shared block
anton pin c-mat-4 --topic-index 7 --block-index 2
```

Use `--child` for differentiated assignments. Omit `--child` only when the block is genuinely appropriate for every child in the group — a shared pin appears for all children but each child's completion is tracked individually.

#### Step 5 — Verify and check back

```bash
# Confirm pins look right
anton pins --week <this-monday>

# Mid-week check
anton completion Lea
anton completion Luke

# End of week review — feed back into next week's planning
anton subjects Lea
anton subjects Luke
anton compare
```

#### Decision summary

```text
For each child:
  1. anton subjects <child>        → find active subjects + accuracy + trend
  2. anton completion <child>      → find incomplete blocks from last week
  3. if completionRate < 0.5      → re-pin same block or easier block in topic
     if completionRate = 1 + accuracy ≥ 0.80 → advance to next block/topic
     if accuracy < 0.65           → drop a grade level
  4. anton topics / blocks        → find the specific next block
  5. anton pin ... --child <name> → assign it
```

### Debug auth issues

```bash
# Check current auth and group status:
anton status

# Force fresh login (bypass cache):
anton --no-cache status

# Use a specific group when parent belongs to multiple:
anton --group "Family A" children
```

---

## Notes

- **Session cache**: The CLI caches the session at `~/.config/anton/session.json` to skip login on repeat calls. Group info has a 10-minute TTL and is refreshed transparently. Use `--no-cache` if you hit auth errors.
- **Child names**: Commands accepting `<child>` resolve by display name (case-insensitive). Use `anton children` to see exact names. Child names are distinct from group names — a group may be named "Family" while children inside it are named "Lea" and "Luke". Always quote names containing spaces or special characters (e.g. `"Klasse 5e Lea<3"`).
- **Week dates**: Always a Monday in `YYYY-MM-DD` format. If you're not sure which Monday, use `anton weekly <child>` without `--week` to get the current week.
- **No official API**: The underlying anton.app API is unofficial and may change without notice. Restart with `--no-cache` if unexpected errors occur after a package update.
