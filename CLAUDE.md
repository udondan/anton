# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

Node.js package (`@udondan/anton`) that wraps the **unofficial** anton.app API for parental
monitoring of children's learning. It ships three interfaces sharing the same SDK core:

- **SDK** — importable `Anton` class for use in other Node.js projects
- **CLI** — `anton` executable (global install or `npx`)
- **MCP server** — started via `anton mcp`, exposes all 24 tools over stdio

## Build & test

```bash
mise run install           # install dependencies
mise run build             # tsc → dist/
mise run dev               # tsc --watch
mise run test              # run all tests (vitest)
mise run test:watch        # vitest in watch mode
bun run test test/sdk.test.ts   # run a single test file
```

Integration tests hit the real anton.app API and require `ANTON_LOGIN_CODE` to be set:

```bash
ANTON_LOGIN_CODE=YOUR-CODE mise run test
```

**Tests expect `dist/` to exist — always `mise run build` first.**

## Configuration

```bash
# Parent account (required – discovers family groups automatically)
export ANTON_LOGIN_CODE='YOUR-CODE'

# Optional: alternative to login code
export ANTON_LOG_ID='L-...'

# Optional: default group name when parent belongs to multiple groups
# Matched case-insensitively against groupName. Falls back to the first group.
export ANTON_GROUP='MyFamily'

# Optional: custom assignments file (default: ~/.config/anton/assignments.json)
export ANTON_ASSIGNMENTS_FILE='/path/to/assignments.json'
```

## Architecture

The package ships three interfaces over a shared SDK core:

```text
src/
  Anton.ts        — SDK class: all public methods, business logic, no low-level HTTP implementation details
  client.ts       — Low-level HTTP: login, event log, group logger, content API
  analysis.ts     — Pure computation over event arrays (no HTTP, no Anton class)
  assignments.ts  — Local JSON store at ~/.config/anton/assignments.json
  session-cache.ts— CLI-only: session + group info cache at ~/.config/anton/session.json
  mcp.ts          — MCP server wrapping Anton class as 24 tools over stdio
  cli.ts          — commander-based CLI; delegates auth to connectAnton() which
                    reads/writes the session cache before calling Anton.connect()
  types.ts        — All exported TypeScript types
  index.ts        — SDK entry point (re-exports Anton + types)
```

**Data flow**: CLI/MCP → `Anton` class → `client.ts` (HTTP) / `analysis.ts` (computation)

**Multi-group support**: A parent can belong to multiple groups. `connect()` discovers all group codes from `isGroupMember` events and fetches all groups in parallel. The `Anton` class stores `allGroups: GroupInfo[]`. Group selection priority: explicit `groupName` param per method > `AntonConfig.groupName` (set from `ANTON_GROUP` env var by CLI/MCP) > first group (index 0).

**Session cache** lives only in `cli.ts` + `session-cache.ts`. The `Anton` class has two entry points for authentication:

- `connect()` — full login (SDK, MCP)
- `connectFromCache(session, groupCodes, groups?)` — zero or N API calls (CLI only)

The two-layer cache: session is kept until an auth error; groups has a 10-minute TTL and all groups are re-fetched transparently without re-logging in. Cache migrates from old single-`groupInfo` format automatically.

**Key conventions:**

- All `client.ts` functions are standalone exports (not class methods) that take explicit auth parameters.
- `Anton.ts` orchestrates client calls and is the only place that holds `parentSession` and `groupInfo` state.
- `analysis.ts` functions are pure — they receive event arrays and return computed results. Do not add HTTP calls there.
- Assignment IDs are UUIDs generated in `assignments.ts`; the store is a flat JSON array.
- Block resolution (project → topic → block) is done inline in `Anton.pinBlock()` — there is no separate resolver.
- The `blockPath` format is `/../{project}/{topicSlug}/{blockSlug}/block`; it is derived from puids, not stored in the API response directly.

## Discovered API endpoints

| Endpoint | Method | Purpose |
| --- | --- | --- |
| `https://d-apis-db.anton.app/?p=login/step1/step1` | POST | Login with code |
| `https://apis-db-logger-s-lb-2.anton.app/apisLogger/subscribe/` | GET | Read user or group event log |
| `https://logger-lb-5.anton.app/events` | POST | Write events (e.g. pinGroupBlock) |
| `https://content.anton.app/files/?fileId=list/plans` | GET | All 285 courses |
| `https://content.anton.app/files/?fileId=plan/{project}` | GET | Course topic/block/level tree |
| `https://content.anton.app/files/?fileId=level/{path}` | GET | Lesson content |
| `https://{a-f}-apis-db.anton.app/?p=level/reviewReport/get` | POST | Per-child level progress |

## Key data structures

**Login response**: `{ loginCode, logId, authToken, displayName }`

**finishLevel event**:

```json
{
  "event": "finishLevel",
  "puid": "c-mat-4/pr7gkb",
  "type": "normal",
  "blockTitle": "Brüche zuordnen",
  "levelTitle": "Brüche bestimmen (1)",
  "score": 3,
  "total": 9,
  "corrects": 9,
  "duration": 53.6,
  "mistakes": 0
}
```

**pinGroupBlock event** (group log):

```json
{
  "event": "pinGroupBlock",
  "puid": "c-mat-4/ro9ajj",
  "block": "/../c-mat-4/topic-07-brueche/block-02-brueche-zuordnen/block",
  "subgroup": "P-P7R1oC6TfbGM7LzrEcKROb5SZTvb4PtI",
  "weekStartAt": "2025-06-16"
}
```

**setGroupMember event** (group log):

```json
{ "event": "setGroupMember", "role": "pupil", "publicId": "P-P7R1oC6TfbGM7LzrEcKROb5SZTvb4PtI" }
```

## MCP tools (24 total)

| Tool | Description |
| ---- | ----------- |
| `get_status` | Auth status, all groups the parent belongs to, configured children |
| `list_groups` | All groups the parent belongs to, with full member lists |
| `get_group` | Family group members (publicIds, roles) + current pinned blocks. Optional `group` param. |
| `get_group_assignments` | Lesson blocks assigned to the group (filterable by child/week). Optional `group` param. |
| `pin_block` | Assign a lesson block to the group or a specific child. Accepts `childName` (resolved internally) and `project`+`topicIndex/topicTitle`+`blockIndex/blockTitle` (resolved internally). Optional `group` param. |
| `unpin_block` | Remove a pinned block from the group. Optional `group` param. |
| `get_progress` | Progress summary for a configured child (finishLevel events) |
| `get_events` | Raw event log for a configured child |
| `get_level_progress` | Per-level performance for a child by publicId (reviewReport API) |
| `list_children` | List configured child accounts. Optional `group` param. |
| `check_assignment_completion` | Which assigned blocks a child has completed (levels done vs total). Optional `group` param. |
| `get_weekly_summary` | Weekly rollup: levels, time, stars, assigned vs self-directed ratio. Optional `group` param. |
| `get_subject_summary` | Per-subject accuracy, stars, time, and trend (improving/declining/stable) |
| `get_activity_timeline` | Active days, streaks, gaps, and daily breakdown |
| `compare_children` | Side-by-side comparison of all configured children. Optional `group` param. |
| `list_plans` | Browse ~285 courses by subject/grade |
| `list_topics` | Lightweight: topic titles + indices for a course (use before get_topic_blocks) |
| `get_topic_blocks` | Blocks + levels for a single topic — identified by index or title |
| `get_plan` | Full topic→block→level hierarchy for a course (large response — prefer list_topics + get_topic_blocks) |
| `get_lesson` | Lesson content (questions/trainers) by fileId |
| `list_assignments` | Local assignment list |
| `assign_lesson` | Create a local assignment |
| `update_assignment` | Update a local assignment |
| `delete_assignment` | Delete a local assignment |

## Known limitations

- **No official API** – endpoints can change without notice
- **Group member names may be missing** – `get_group` includes display names and logIds when enrichment succeeds, but some groups may fall back to publicIds only. If needed, map identities via `get_events`/`finishLevel` or by having child login codes in config.
- **Token lifetime unknown** – restart server if auth fails after a long session
- **Rate limits unknown** – avoid aggressive polling
