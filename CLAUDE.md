# @udondan/anton – Developer Notes

## What this is

Node.js package (`@udondan/anton`) that wraps the **unofficial** anton.app API for parental
monitoring of children's learning. It ships three interfaces sharing the same SDK core:

- **SDK** — importable `Anton` class for use in other Node.js projects
- **CLI** — `anton` executable (global install or `npx`)
- **MCP server** — started via `anton mcp`, exposes all 21 tools over stdio

## Build & run

```bash
npm install
npm run build        # tsc → dist/
```

Dev watch: `npm run dev`

## Configuration

```bash
# Parent account (required – discovers family group automatically)
export ANTON_LOGIN_CODE='YOUR-CODE'

# Optional: alternative to login code
export ANTON_LOG_ID='L-...'

# Optional: custom assignments file (default: ~/.config/anton/assignments.json)
export ANTON_ASSIGNMENTS_FILE='/path/to/assignments.json'
```

## SDK usage

```ts
import { Anton } from '@udondan/anton';

const anton = new Anton({ loginCode: 'YOUR-CODE' });
await anton.connect();

console.log(await anton.getStatus());
console.log(await anton.getWeeklySummary({ childName: 'Emma' }));
```

## CLI usage

```bash
# When installed globally:
anton --help
anton mcp                          # start MCP server
anton status                       # show auth + group info
anton group                        # show group + pinned blocks
anton children                     # list children
anton plans --subject mat          # browse maths courses
anton progress Emma                # show progress for Emma
anton weekly Emma --week 2025-09-01

# Or via npx:
ANTON_LOGIN_CODE=YOUR-CODE npx @udondan/anton mcp
```

## MCP client config (Claude Desktop / Claude Code)

```json
{
  "mcpServers": {
    "anton": {
      "command": "anton",
      "args": ["mcp"],
      "env": {
        "ANTON_LOGIN_CODE": "YOUR-CODE"
      }
    }
  }
}
```

Or without global install:

```json
{
  "mcpServers": {
    "anton": {
      "command": "node",
      "args": ["/path/to/dist/cli.js", "mcp"],
      "env": {
        "ANTON_LOGIN_CODE": "YOUR-CODE"
      }
    }
  }
}
```

## Available tools (23 total)

| Tool | Description |
| ---- | ----------- |
| `get_status` | Auth status, group info, configured children |
| `get_group` | Family group members (publicIds, roles) + current pinned blocks |
| `get_group_assignments` | Lesson blocks assigned to the group (filterable by child/week) |
| `pin_block` | Assign a lesson block to the group or a specific child. Accepts `childName` (resolved internally) and `project`+`topicIndex/topicTitle`+`blockIndex/blockTitle` (resolved internally) |
| `get_progress` | Progress summary for a configured child (finishLevel events) |
| `get_events` | Raw event log for a configured child |
| `get_level_progress` | Per-level performance for a child by publicId (reviewReport API) |
| `list_children` | List configured child accounts |
| `check_assignment_completion` | Which assigned blocks a child has completed (levels done vs total) |
| `get_weekly_summary` | Weekly rollup: levels, time, stars, assigned vs self-directed ratio |
| `get_subject_summary` | Per-subject accuracy, stars, time, and trend (improving/declining/stable) |
| `get_activity_timeline` | Active days, streaks, gaps, and daily breakdown |
| `compare_children` | Side-by-side comparison of all configured children |
| `list_plans` | Browse ~285 courses by subject/grade |
| `list_topics` | Lightweight: topic titles + indices for a course (use before get_topic_blocks) |
| `get_topic_blocks` | Blocks + levels for a single topic — identified by index or title |
| `get_plan` | Full topic→block→level hierarchy for a course (large response — prefer list_topics + get_topic_blocks) |
| `get_lesson` | Lesson content (questions/trainers) by fileId |
| `list_assignments` | Local assignment list |
| `assign_lesson` | Create a local assignment |
| `update_assignment` / `delete_assignment` | Manage local assignments |

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

## Workflow: assign a lesson to a child

1. `list_plans` → find the course (e.g. `c-mat-4`)
2. `get_plan { project: "c-mat-4" }` → browse topics/blocks
3. Copy the `blockPuid` and `blockPath` from the desired block
4. `pin_block { blockPuid, blockPath, childPublicId, weekStartAt }` → posts to group logger

## Known limitations

- **No official API** – endpoints can change without notice
- **Children's publicIds only** – `get_group` returns publicIds, not names. Map them via `get_events`/`finishLevel` or by having child login codes in config.
- **Token lifetime unknown** – restart server if auth fails after a long session
- **Rate limits unknown** – avoid aggressive polling

## Source structure

```text
src/
  Anton.ts        SDK core class — all business logic, public API
  index.ts        SDK package entry point (re-exports Anton + types)
  cli.ts          CLI entry point (bin: anton)
  mcp.ts          MCP server — wraps Anton class as 23 MCP tools
  client.ts       Low-level anton.app HTTP client
  analysis.ts     Pure analysis functions (no HTTP)
  assignments.ts  Local JSON-backed assignment store
  types.ts        TypeScript types (all public)
```
