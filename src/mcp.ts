/**
 * Anton MCP server.
 *
 * Wraps the Anton SDK as an MCP server over stdio.
 * Start via: anton mcp
 */

import { createRequire } from 'node:module';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
  type Tool,
} from '@modelcontextprotocol/sdk/types.js';

import type { Anton } from './Anton.js';

const { version } = createRequire(import.meta.url)('../package.json') as { version: string };

// ---------------------------------------------------------------------------
// Shared parameter snippets
// ---------------------------------------------------------------------------

const groupParam = {
  group: {
    type: 'string',
    description:
      'Group name to operate on. Only needed when the parent belongs to multiple groups. ' +
      'Defaults to the first group or the ANTON_GROUP environment variable.',
  },
};

// ---------------------------------------------------------------------------
// Tool definitions
// ---------------------------------------------------------------------------

const TOOLS: Tool[] = [
  // ── Status ───────────────────────────────────────────────────────────────
  {
    name: 'get_status',
    title: 'Status',
    description:
      'Shows who is signed in and which family group is used: the parent account, all groups the parent belongs to, and the pupils of the selected group with their names and publicIds. Call it first to check the setup and to learn the child names that other tools take. For the members and pins of one group use get_group.',
    annotations: { readOnlyHint: true, openWorldHint: false },
    inputSchema: {
      type: 'object',
      properties: { ...groupParam },
      required: [],
    },
  },

  // ── Groups / Children ────────────────────────────────────────────────────
  {
    name: 'list_groups',
    title: 'List groups',
    description:
      'Lists every group the parent account belongs to, each with name, type and all members (publicId, role, display name). Use it when the parent has more than one group, to pick the `group` argument of the other tools; for one group with its pins use get_group.',
    annotations: { readOnlyHint: true, openWorldHint: false },
    inputSchema: { type: 'object', properties: {}, required: [] },
  },
  {
    name: 'get_group',
    title: 'Group',
    description:
      'Shows one family group: name, type, members with publicIds and roles, and the blocks pinned for each member. Use it for an overview of who has what assigned; for the pins alone, filtered by child or week, use get_group_assignments.',
    annotations: { readOnlyHint: true, openWorldHint: false },
    inputSchema: {
      type: 'object',
      properties: { ...groupParam },
      required: [],
    },
  },
  {
    name: 'get_group_assignments',
    title: 'Pinned blocks',
    description:
      'Lists the lesson blocks pinned in the family group on anton.app: block PUID, block path (with subject, grade and topic), week, and the child it is pinned for (subgroup = publicId; none means the whole group). Filters by child and week. Use it to see what the children see as assigned in the app, and to find the blockPuid and week that unpin_block needs. Whether the blocks were done is in check_assignment_completion.',
    annotations: { readOnlyHint: true, openWorldHint: false },
    inputSchema: {
      type: 'object',
      properties: {
        childPublicId: {
          type: 'string',
          description: 'Filter to only assignments for this child publicId',
        },
        week: {
          type: 'string',
          description: 'Only the pins of the week that starts on this Monday, e.g. "2025-09-01"',
        },
        ...groupParam,
      },
      required: [],
    },
  },
  {
    name: 'pin_block',
    title: 'Pin a block',
    description:
      'Assigns a lesson block on anton.app: pins it for a week, for the whole family group or for one child, who then sees it in the app. Identify the block by project with topic and block (index or title), as list_topics and get_topic_blocks show them, or directly by blockPuid and blockPath. The week defaults to the current one. Pinning the same block again adds another pin. Returns the pin with groupCode, blockPuid, blockPath, weekStartAt and childPublicId. For a reminder that stays on this machine use assign_lesson instead.',
    annotations: {
      readOnlyHint: false,
      destructiveHint: false,
      idempotentHint: false,
      openWorldHint: false,
    },
    inputSchema: {
      type: 'object',
      properties: {
        project: {
          type: 'string',
          description:
            'Course project ID, e.g. "c-mat-4". Required when not providing blockPuid/blockPath directly.',
        },
        topicIndex: {
          type: 'number',
          description: '0-based topic index from list_topics. Use with project.',
        },
        topicTitle: {
          type: 'string',
          description: 'Partial topic title match (case-insensitive). Alternative to topicIndex.',
        },
        blockIndex: {
          type: 'number',
          description: '0-based block index within the topic.',
        },
        blockTitle: {
          type: 'string',
          description: 'Partial block title match (case-insensitive). Alternative to blockIndex.',
        },
        blockPuid: {
          type: 'string',
          description:
            'Block PUID, e.g. "c-mat-4/ro9ajj". Use instead of project/topic/block when known.',
        },
        blockPath: {
          type: 'string',
          description:
            'Block path, e.g. "/../c-mat-4/topic-07-brueche/block-02-brueche-zuordnen/block". Required when using blockPuid directly.',
        },
        weekStartAt: {
          type: 'string',
          description:
            'ISO date of the Monday of the target week, e.g. "2025-09-01". ' +
            "Defaults to the current week's Monday.",
        },
        childName: {
          type: 'string',
          description:
            'Child name as configured (e.g. "Emma"). Resolved to publicId automatically.',
        },
        childPublicId: {
          type: 'string',
          description: 'Child publicId. Alternative to childName when publicId is known.',
        },
        ...groupParam,
      },
      required: [],
    },
  },
  {
    name: 'unpin_block',
    title: 'Unpin a block',
    description:
      'Removes a pinned block from the family group on anton.app, so that the children no longer see it as assigned. Find the pin with get_group_assignments and pass its blockPuid and week; childPublicId picks one pin when several match. Fails if no pin matches. Returns the removed pin.',
    annotations: {
      readOnlyHint: false,
      destructiveHint: true,
      idempotentHint: false,
      openWorldHint: false,
    },
    inputSchema: {
      type: 'object',
      properties: {
        blockPuid: {
          type: 'string',
          description: 'Block PUID of the pin to remove, e.g. "c-mat-4/ro9ajj"',
        },
        weekStartAt: {
          type: 'string',
          description: 'Week start date of the pin to remove (YYYY-MM-DD Monday)',
        },
        childPublicId: {
          type: 'string',
          description: 'Optional: publicId of the child the pin belongs to (to disambiguate)',
        },
        ...groupParam,
      },
      required: ['blockPuid', 'weekStartAt'],
    },
  },

  // ── Progress ─────────────────────────────────────────────────────────────
  {
    name: 'get_progress',
    title: 'Progress',
    description:
      'Summarizes the learning progress of one child: completed levels with scores, stars by subject, and the number of events, optionally since a date. Use it for a quick overview; for one week use get_weekly_summary, per subject get_subject_summary, for one level get_level_progress, and for the raw events get_events. Child names come from get_status or list_children.',
    annotations: { readOnlyHint: true, openWorldHint: false },
    inputSchema: {
      type: 'object',
      properties: {
        childName: {
          type: 'string',
          description: 'Child name as configured (e.g. "Emma")',
        },
        since: {
          type: 'string',
          description: 'Only events on or after this date, e.g. "2025-09-01". Default: all time.',
        },
        ...groupParam,
      },
      required: ['childName'],
    },
  },
  {
    name: 'get_events',
    title: 'Events',
    description:
      'Returns the raw event log of one child, newest first, like finishLevel, startLevel, setCurrentBlock or adjustCoins, each with its time and data. Filters by date and event name; at most `limit` events (default 100). Use it only when the summaries (get_progress, get_weekly_summary, get_activity_timeline) do not answer the question.',
    annotations: { readOnlyHint: true, openWorldHint: false },
    inputSchema: {
      type: 'object',
      properties: {
        childName: {
          type: 'string',
          description: 'Child name as configured',
        },
        since: {
          type: 'string',
          description: 'Only events on or after this date, e.g. "2025-09-01". Default: all time.',
        },
        eventType: {
          type: 'string',
          description: 'Only events of this name, e.g. "finishLevel"',
        },
        limit: {
          type: 'number',
          description: 'Max number of events to return (default: 100)',
        },
        ...groupParam,
      },
      required: ['childName'],
    },
  },
  {
    name: 'get_level_progress',
    title: 'Level result',
    description:
      'Shows how one child did on one lesson level: score events, the finishLevel data and the time spent. Takes the level PUID from get_plan or get_topic_blocks (levels[].puid), not a block PUID. Works without a login code of the child, through the review report of the parent. For all levels of a block use check_assignment_completion.',
    annotations: { readOnlyHint: true, openWorldHint: false },
    inputSchema: {
      type: 'object',
      properties: {
        levelPuid: {
          type: 'string',
          description:
            'Level PUID from get_plan or get_topic_blocks → levels[].puid, e.g. "c-mat-4/pr7gkb". ' +
            'Use the level PUID itself, not a block PUID.',
        },
        childName: {
          type: 'string',
          description:
            'Child name as configured (e.g. "Emma"). Resolved to publicId automatically.',
        },
        childPublicId: {
          type: 'string',
          description: 'Child publicId. Alternative to childName when publicId is known.',
        },
        ...groupParam,
      },
      required: ['levelPuid'],
    },
  },

  // ── Lesson catalogue ─────────────────────────────────────────────────────
  {
    name: 'list_children',
    title: 'List children',
    description:
      'Lists the pupils of the selected group with name and publicId, and the child sessions available, if any. Children without a login code are listed too. Use it to find the childName or childPublicId that other tools take; get_status shows the same pupils along with the account.',
    annotations: { readOnlyHint: true, openWorldHint: false },
    inputSchema: {
      type: 'object',
      properties: { ...groupParam },
      required: [],
    },
  },
  {
    name: 'list_plans',
    title: 'List courses',
    description:
      'Lists the courses (plans) of the anton.app catalogue, about 285, each with project id, subject, grades, title and the number of blocks and levels. Filters by subject, grade and language. Start here to find a course; then list_topics with its `project` (like c-mat-4) to browse it.',
    annotations: { readOnlyHint: true, openWorldHint: false },
    inputSchema: {
      type: 'object',
      properties: {
        subject: {
          type: 'string',
          description:
            'Filter by subject code (e.g. "mat", "natdeu", "eng", "sci"). ' +
            'Partial match supported.',
        },
        grade: {
          type: 'number',
          description: 'Filter by grade (1–13)',
        },
        language: {
          type: 'string',
          description: 'Filter by GUI language, e.g. "de" (default)',
        },
      },
      required: [],
    },
  },
  {
    name: 'list_topics',
    title: 'List topics',
    description:
      'Lists the topics (chapters) of one course with their titles and 0-based indices, without blocks and levels. Use it after list_plans to browse a course; then get_topic_blocks with the index or title for the blocks of one topic.',
    annotations: { readOnlyHint: true, openWorldHint: false },
    inputSchema: {
      type: 'object',
      properties: {
        project: {
          type: 'string',
          description: 'Course project ID, e.g. "c-mat-4" or "c-natdeu-2"',
        },
      },
      required: ['project'],
    },
  },
  {
    name: 'get_topic_blocks',
    title: 'Topic blocks',
    description:
      'Returns the blocks of one topic of a course, each with title, PUID, block path and its levels (title, PUID, slug): everything pin_block needs, and the parts of the file id that get_lesson takes. Identify the topic by topicIndex from list_topics or by part of its title. Much smaller than get_plan.',
    annotations: { readOnlyHint: true, openWorldHint: false },
    inputSchema: {
      type: 'object',
      properties: {
        project: {
          type: 'string',
          description: 'Course project ID, e.g. "c-mat-4"',
        },
        topicIndex: {
          type: 'number',
          description: '0-based topic index from list_topics',
        },
        topicTitle: {
          type: 'string',
          description: 'Partial topic title match (case-insensitive) — alternative to topicIndex',
        },
      },
      required: ['project'],
    },
  },
  {
    name: 'get_plan',
    title: 'Course',
    description:
      'Returns the whole topic, block and level tree of one course. Large courses give very large results (c-mat-3 has 84 blocks), so prefer list_topics and get_topic_blocks for browsing, and use get_plan only when the whole course is needed at once.',
    annotations: { readOnlyHint: true, openWorldHint: false },
    inputSchema: {
      type: 'object',
      properties: {
        project: {
          type: 'string',
          description: 'Course project ID, e.g. "c-mat-4" or "c-natdeu-2"',
        },
      },
      required: ['project'],
    },
  },
  {
    name: 'get_lesson',
    title: 'Lesson content',
    description:
      'Returns the content of one lesson level: its questions, trainers and answer options. Takes the file id of the level, "{project}/{topic-slug}/{block-slug}/{level-slug}", built from the block path and the level slug that get_topic_blocks lists. Use it to see what a lesson asks; for how a child did on it use get_level_progress.',
    annotations: { readOnlyHint: true, openWorldHint: false },
    inputSchema: {
      type: 'object',
      properties: {
        fileId: {
          type: 'string',
          description: 'Level file path (with or without the "level/" prefix)',
        },
      },
      required: ['fileId'],
    },
  },

  // ── Analysis ─────────────────────────────────────────────────────────────
  {
    name: 'check_assignment_completion',
    title: 'Pins done',
    description:
      'Checks which blocks pinned for a child were done: it compares the pins of the group with the finishLevel events of the child. Returns for each block the levels done out of all, the rate, and the score of each level. Filters by week. Use it to follow up on pin_block; for all activity of a week use get_weekly_summary.',
    annotations: { readOnlyHint: true, openWorldHint: false },
    inputSchema: {
      type: 'object',
      properties: {
        childName: { type: 'string', description: 'Child name as configured' },
        week: {
          type: 'string',
          description: 'Filter to a specific week (YYYY-MM-DD Monday). Omit for all weeks.',
        },
        ...groupParam,
      },
      required: ['childName'],
    },
  },
  {
    name: 'get_weekly_summary',
    title: 'Weekly summary',
    description:
      'Summarizes one week of a child: levels completed, time spent, stars earned, subjects, and how much was pinned versus chosen by the child. The week defaults to the current one. For several weeks use get_activity_timeline; for subjects over all time get_subject_summary.',
    annotations: { readOnlyHint: true, openWorldHint: false },
    inputSchema: {
      type: 'object',
      properties: {
        childName: { type: 'string', description: 'Child name as configured' },
        weekStartAt: {
          type: 'string',
          description: 'Monday of the week (YYYY-MM-DD). Defaults to the current week.',
        },
        ...groupParam,
      },
      required: ['childName'],
    },
  },
  {
    name: 'get_subject_summary',
    title: 'Subjects',
    description:
      'Summarizes the progress of a child per subject: accuracy, stars, time spent, and a trend (improving, declining or stable) from recent against earlier sessions. Filters by subject prefix like mat. Use it to find strong and weak subjects; for one week use get_weekly_summary.',
    annotations: { readOnlyHint: true, openWorldHint: false },
    inputSchema: {
      type: 'object',
      properties: {
        childName: { type: 'string', description: 'Child name as configured' },
        subject: {
          type: 'string',
          description: 'Filter by subject/project prefix, e.g. "mat", "natdeu". Partial match.',
        },
        ...groupParam,
      },
      required: ['childName'],
    },
  },
  {
    name: 'get_activity_timeline',
    title: 'Activity timeline',
    description:
      'Shows when a child learned: active days, streaks, gaps, and for each day the levels completed and the time spent, optionally since a date. Use it to see how regularly a child learns; for the content of one week use get_weekly_summary.',
    annotations: { readOnlyHint: true, openWorldHint: false },
    inputSchema: {
      type: 'object',
      properties: {
        childName: { type: 'string', description: 'Child name as configured' },
        since: {
          type: 'string',
          description: 'Start date (YYYY-MM-DD). Defaults to all time.',
        },
        ...groupParam,
      },
      required: ['childName'],
    },
  },
  {
    name: 'compare_children',
    title: 'Compare children',
    description:
      'Compares all children of the selected group side by side: total stars, accuracy, time spent, active days, levels completed and subjects. Takes no child name. For the details of one child use get_progress or get_subject_summary.',
    annotations: { readOnlyHint: true, openWorldHint: false },
    inputSchema: {
      type: 'object',
      properties: { ...groupParam },
      required: [],
    },
  },

  // ── Local assignments ─────────────────────────────────────────────────────
  {
    name: 'list_assignments',
    title: 'List local assignments',
    description:
      'Lists the local lesson assignments: notes kept on this machine, in ~/.config/anton/assignments.json or the file of ANTON_ASSIGNMENTS_FILE, which the child does not see in the app. Each has id, childName, fileId, title, note, status (pending, completed or cancelled) and dates. Filters by child and status. For the blocks pinned on anton.app use get_group_assignments.',
    annotations: { readOnlyHint: true, openWorldHint: false },
    inputSchema: {
      type: 'object',
      properties: {
        childName: { type: 'string', description: 'Filter by child name' },
        status: {
          type: 'string',
          enum: ['pending', 'completed', 'cancelled'],
          description: 'Filter by status',
        },
      },
      required: [],
    },
  },
  {
    name: 'assign_lesson',
    title: 'Add a local assignment',
    description:
      'Adds a local lesson assignment for a child to the file on this machine, with status pending. It is not sent to anton.app, so the child does not see it; to assign a block in the app use pin_block. Returns the new assignment with its id, which update_assignment and delete_assignment take.',
    annotations: {
      readOnlyHint: false,
      destructiveHint: false,
      idempotentHint: false,
      openWorldHint: false,
    },
    inputSchema: {
      type: 'object',
      properties: {
        childName: { type: 'string', description: 'Child name as configured, or publicId' },
        fileId: {
          type: 'string',
          description:
            'File id of the lesson level, "{project}/{topic-slug}/{block-slug}/{level-slug}", as get_lesson takes it',
        },
        lessonTitle: { type: 'string', description: 'Human-readable lesson title (optional)' },
        note: { type: 'string', description: 'Optional note' },
      },
      required: ['childName', 'fileId'],
    },
  },
  {
    name: 'update_assignment',
    title: 'Update a local assignment',
    description:
      'Changes the status (pending, completed or cancelled) or the note of a local assignment, found by its id from list_assignments. Setting completed records the time; other statuses clear it. Fails if the id is unknown. Returns the updated assignment. Does not touch anton.app.',
    annotations: {
      readOnlyHint: false,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: false,
    },
    inputSchema: {
      type: 'object',
      properties: {
        id: { type: 'string', description: 'Id (UUID) of the assignment, from list_assignments' },
        status: {
          type: 'string',
          enum: ['pending', 'completed', 'cancelled'],
          description: 'New status. Omit to keep it.',
        },
        note: { type: 'string', description: 'New note, replacing the old one. Omit to keep it.' },
      },
      required: ['id'],
    },
  },
  {
    name: 'delete_assignment',
    title: 'Delete a local assignment',
    description:
      'Deletes a local assignment for good, found by its id from list_assignments. Fails if the id is unknown. Returns {deleted: true, id}. Does not touch anton.app; to remove a pin there use unpin_block. To keep the record, set its status to cancelled with update_assignment instead.',
    annotations: {
      readOnlyHint: false,
      destructiveHint: true,
      idempotentHint: false,
      openWorldHint: false,
    },
    inputSchema: {
      type: 'object',
      properties: {
        id: { type: 'string', description: 'Id (UUID) of the assignment, from list_assignments' },
      },
      required: ['id'],
    },
  },
];

// ---------------------------------------------------------------------------
// Tool handlers
// ---------------------------------------------------------------------------

type Args = Record<string, unknown>;
type ToolHandler = (args: Args, groupName: string | undefined) => unknown;
type AssignmentStatusArg = 'pending' | 'completed' | 'cancelled' | undefined;

const str = (args: Args, key: string) => args[key] as string;
const optStr = (args: Args, key: string) => args[key] as string | undefined;
const optNum = (args: Args, key: string) => args[key] as number | undefined;

/** Map every tool name to the Anton method it calls. */
export function buildToolHandlers(anton: Anton): Record<string, ToolHandler> {
  return {
    get_status: (_, groupName) => anton.getStatus({ groupName }),
    list_groups: () => anton.listGroups(),
    get_group: (_, groupName) => anton.getGroup({ groupName }),
    get_group_assignments: (args, groupName) =>
      anton.getGroupAssignments({
        childPublicId: optStr(args, 'childPublicId'),
        week: optStr(args, 'week'),
        groupName,
      }),
    pin_block: (args, groupName) =>
      anton.pinBlock({ ...(args as Parameters<typeof anton.pinBlock>[0]), groupName }),
    unpin_block: (args, groupName) =>
      anton.unpinBlock({
        blockPuid: str(args, 'blockPuid'),
        weekStartAt: str(args, 'weekStartAt'),
        childPublicId: optStr(args, 'childPublicId'),
        groupName,
      }),
    get_progress: (args, groupName) =>
      anton.getProgress({
        childName: str(args, 'childName'),
        since: optStr(args, 'since'),
        groupName,
      }),
    get_events: (args, groupName) =>
      anton.getEvents({
        childName: str(args, 'childName'),
        since: optStr(args, 'since'),
        eventType: optStr(args, 'eventType'),
        limit: optNum(args, 'limit'),
        groupName,
      }),
    get_level_progress: (args, groupName) =>
      anton.getLevelProgress({
        levelPuid: str(args, 'levelPuid'),
        childName: optStr(args, 'childName'),
        childPublicId: optStr(args, 'childPublicId'),
        groupName,
      }),
    list_children: (_, groupName) => anton.listChildren({ groupName }),
    list_plans: (args) =>
      anton.listPlans({
        subject: optStr(args, 'subject'),
        grade: optNum(args, 'grade'),
        language: optStr(args, 'language'),
      }),
    list_topics: (args) => anton.listTopics({ project: str(args, 'project') }),
    get_topic_blocks: (args) =>
      anton.getTopicBlocks({
        project: str(args, 'project'),
        topicIndex: optNum(args, 'topicIndex'),
        topicTitle: optStr(args, 'topicTitle'),
      }),
    get_plan: (args) => anton.getPlan({ project: str(args, 'project') }),
    get_lesson: (args) => anton.getLesson({ fileId: str(args, 'fileId') }),
    check_assignment_completion: (args, groupName) =>
      anton.checkAssignmentCompletion({
        childName: str(args, 'childName'),
        week: optStr(args, 'week'),
        groupName,
      }),
    get_weekly_summary: (args, groupName) =>
      anton.getWeeklySummary({
        childName: str(args, 'childName'),
        weekStartAt: optStr(args, 'weekStartAt'),
        groupName,
      }),
    get_subject_summary: (args, groupName) =>
      anton.getSubjectSummary({
        childName: str(args, 'childName'),
        subject: optStr(args, 'subject'),
        groupName,
      }),
    get_activity_timeline: (args, groupName) =>
      anton.getActivityTimeline({
        childName: str(args, 'childName'),
        since: optStr(args, 'since'),
        groupName,
      }),
    compare_children: (_, groupName) => anton.compareChildren({ groupName }),
    list_assignments: (args) =>
      anton.listAssignments({
        childName: optStr(args, 'childName'),
        status: args['status'] as AssignmentStatusArg,
      }),
    assign_lesson: (args) =>
      anton.assignLesson({
        childName: str(args, 'childName'),
        fileId: str(args, 'fileId'),
        lessonTitle: optStr(args, 'lessonTitle'),
        note: optStr(args, 'note'),
      }),
    update_assignment: (args) =>
      anton.updateAssignment(str(args, 'id'), {
        status: args['status'] as AssignmentStatusArg,
        note: optStr(args, 'note'),
      }),
    delete_assignment: (args) => {
      anton.deleteAssignment(str(args, 'id'));
      return { deleted: true, id: args['id'] };
    },
  };
}

// ---------------------------------------------------------------------------
// Server bootstrap
// ---------------------------------------------------------------------------

/**
 * Build the MCP server with all tools, without connecting a transport.
 *
 * `connect` signs in to anton.app. It runs on the first tool call, not at
 * startup, so the server starts and lists its tools without credentials, as
 * the Docker MCP Gateway does when it checks a server. A failed sign-in is
 * returned as the tool's error and retried on the next call.
 */
export function createServer(
  anton: Anton,
  connect: () => Promise<void> = async () => {},
): McpServer {
  const mcp = new McpServer({ name: 'anton', version }, { capabilities: { tools: {} } });
  const handlers = buildToolHandlers(anton);

  let connecting: Promise<void> | undefined;
  const ensureConnected = (): Promise<void> => {
    connecting ??= connect().catch((err: unknown) => {
      connecting = undefined;
      throw new Error(`Authentication failed: ${(err as Error).message}`);
    });
    return connecting;
  };

  // The tools are declared with plain JSON schemas, so they are served through
  // the low-level request handlers instead of McpServer.registerTool().
  mcp.server.setRequestHandler(ListToolsRequestSchema, () => ({ tools: TOOLS }));

  mcp.server.setRequestHandler(CallToolRequestSchema, async (request) => {
    const { name, arguments: args = {} } = request.params;
    try {
      // Object.hasOwn: inherited names such as "constructor" are not tools.
      if (!Object.hasOwn(handlers, name)) throw new Error(`Unknown tool: ${name}`);
      await ensureConnected();
      const result: unknown = await handlers[name](args, optStr(args, 'group'));
      return {
        content: [{ type: 'text', text: JSON.stringify(result, null, 2) }],
      };
    } catch (err) {
      return {
        content: [{ type: 'text', text: `Error: ${(err as Error).message}` }],
        isError: true,
      };
    }
  });

  return mcp;
}

/** Start the MCP server over stdio. See createServer() for `connect`. */
export async function startMcpServer(anton: Anton, connect?: () => Promise<void>): Promise<void> {
  await createServer(anton, connect).connect(new StdioServerTransport());
}
