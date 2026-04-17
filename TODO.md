# Test TODO

## Handler layer (`src/index.ts`)

The current tests call the underlying library functions directly and never exercise
the MCP tool handlers in `index.ts`. The handler layer contains logic that is
completely untested today.

**Required work:** Either extract handlers into a separately importable module, or
test through the MCP `CallTool` request/response protocol, so the full handler path
is covered.

Untested handler logic includes:

- `pin_block` — project + topicIndex + blockIndex resolution path
- `pin_block` — topicTitle / blockTitle fuzzy-match resolution
- `pin_block` — `weekStartAt` defaulting to current week's Monday
- `pin_block` — `blockPath` construction formula
- `get_topic_blocks` — topic resolution by index vs. by title
- `get_weekly_summary` — `weekStartAt` defaulting to current week's Monday

## Error paths

- `resolveChild` with an unknown child name → "Child not found"
- `update_assignment` with an unknown id → "Assignment not found"
- `get_topic_blocks` with an out-of-range `topicIndex`
- `pin_block` when neither `blockPuid`+`blockPath` nor `project` are provided
- `unpin_block` when no matching pin exists
- `get_level_progress` when neither `childName` nor `childPublicId` is provided

## Parameter variations not yet covered

- `get_events` with a `since` date filter
- `get_events` with an `eventType` filter passed to the API
- `pin_block` without a child (group-wide pin, no `subgroup`)
- `get_lesson` with a `level/` prefix already present on the `fileId`
- `get_lesson` with a `/../` prefix (path format from plan data)
- `list_plans` with `language` filter
- `list_plans` with `grade` filter
- `get_group_assignments` with `week` filter — currently only asserts `length <=` total, not that the filter is actually applied correctly
- `loginWithLogId` path (currently only `loginWithCode` is tested)
- `get_progress` with a `since` date to restrict the event window
- `get_activity_timeline` with a non-epoch `since` that actually excludes events
- `check_assignment_completion` filtered to a specific week

## General

- Tests should be runnable in CI without exposing the login code in plain text
  (use a secrets manager or environment injection)
- Add a test that verifies the server starts up and lists tools correctly
  (`ListTools` MCP request), so regressions in the tool registry are caught
