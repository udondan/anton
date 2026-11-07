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
    description:
      'Show authentication and family group status. ' +
      'Returns parent account info, all groups the parent belongs to, and pupils for the selected/default group.',
    inputSchema: {
      type: 'object',
      properties: { ...groupParam },
      required: [],
    },
  },

  // ── Groups / Children ────────────────────────────────────────────────────
  {
    name: 'list_groups',
    description:
      'List all groups the parent account belongs to. ' +
      'Returns each group with its name, type, and full member list (publicIds, roles, display names).',
    inputSchema: { type: 'object', properties: {}, required: [] },
  },
  {
    name: 'get_group',
    description:
      'Get a family group details: name, type, members with their publicIds and roles. ' +
      'Also shows current lesson assignments (pinned blocks) per member.',
    inputSchema: {
      type: 'object',
      properties: { ...groupParam },
      required: [],
    },
  },
  {
    name: 'get_group_assignments',
    description:
      'List all lesson blocks currently assigned (pinned) in the family group. ' +
      'Each entry shows: block PUID, block path (contains subject/grade/topic), ' +
      'week, and optionally which child it is assigned to (subgroup = publicId).',
    inputSchema: {
      type: 'object',
      properties: {
        childPublicId: {
          type: 'string',
          description: 'Filter to only assignments for this child publicId',
        },
        week: {
          type: 'string',
          description: 'Filter to a specific week start date (YYYY-MM-DD Monday)',
        },
        ...groupParam,
      },
      required: [],
    },
  },
  {
    name: 'pin_block',
    description:
      'Assign a lesson block to the family group (or a specific child). ' +
      'Posts a pinGroupBlock event to the group logger. ' +
      'Block can be identified either by (project + topicIndex/topicTitle + blockIndex/blockTitle) ' +
      'or directly by (blockPuid + blockPath). ' +
      'Child can be identified by childName (configured name) or childPublicId.',
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
    description:
      'Remove a pinned block from the family group. ' +
      'Use get_group_assignments to find the pin to remove — identify it by blockPuid and week.',
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
    description:
      'Get a learning progress summary for a child in the selected group. ' +
      'Returns completed levels with scores, stars by subject, and event counts. ' +
      'Use list_children to see available child names.',
    inputSchema: {
      type: 'object',
      properties: {
        childName: {
          type: 'string',
          description: 'Child name as configured (e.g. "Emma")',
        },
        since: {
          type: 'string',
          description: 'ISO date to fetch events from (default: all time)',
        },
        ...groupParam,
      },
      required: ['childName'],
    },
  },
  {
    name: 'get_events',
    description:
      'Fetch raw event log for a child in the selected group. ' +
      'Events include: finishLevel, startLevel, setCurrentBlock, adjustCoins, etc.',
    inputSchema: {
      type: 'object',
      properties: {
        childName: {
          type: 'string',
          description: 'Child name as configured',
        },
        since: {
          type: 'string',
          description: 'ISO date string (default: all time)',
        },
        eventType: {
          type: 'string',
          description: 'Filter to only events with this event name',
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
    description:
      "Get a child's detailed performance on a specific lesson level, by publicId. " +
      'Returns score events, finishLevel data, duration, etc. ' +
      'Uses the reviewReport endpoint — works even without a child login code.',
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
    description:
      'List pupil members of the selected group and any available child session info. ' +
      'Results may include children without login codes.',
    inputSchema: {
      type: 'object',
      properties: { ...groupParam },
      required: [],
    },
  },
  {
    name: 'list_plans',
    description:
      'List all available Anton courses (plans) from the content catalogue. ' +
      'Returns ~285 plans with subject, grades, title, block/level counts. ' +
      'Use the "project" field (e.g. "c-mat-4") to fetch full hierarchy with get_plan.',
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
    description:
      'List the topics (chapters) of a course without fetching all blocks and levels. ' +
      'Returns topic titles and their indices — use these with get_topic_blocks to drill down.',
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
    description:
      'Fetch all blocks (and their levels) for a single topic within a course. ' +
      'Much lighter than get_plan. Returns block titles, puids, blockPaths, and levels — ' +
      'everything needed to call pin_block. ' +
      'Identify the topic with topicIndex (0-based) from list_topics, or topicTitle (partial match).',
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
    description:
      'Fetch the full topic → block → level hierarchy for a course. ' +
      'WARNING: large courses (e.g. c-mat-3 with 84 blocks) produce very large responses. ' +
      'Prefer list_topics + get_topic_blocks for browsing. ' +
      'Use get_plan only when you need the complete picture of a course at once.',
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
    description:
      'Fetch the content of a specific lesson level (questions, trainers, answer options). ' +
      'The fileId is the level path: "{project}/{topic-slug}/{block-slug}/{level-slug}".',
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
    description:
      'Check which assigned lesson blocks a child has completed. ' +
      "Cross-references pinned group assignments with the child's finishLevel events. " +
      'Returns per-block breakdown: levels completed vs total, completion rate, and per-level scores.',
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
    description:
      "Get a rollup of a child's learning activity for a specific week: " +
      'levels completed, time spent, stars earned, subjects, and assigned vs self-directed ratio.',
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
    description:
      "Aggregate a child's progress per subject: accuracy, stars, time spent, and trend " +
      '(improving/declining/stable based on recent vs prior sessions).',
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
    description:
      'Chronological activity summary for a child: active days, streaks, gaps, ' +
      'daily breakdown of levels completed and time spent.',
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
    description:
      'Side-by-side comparison of all children in the selected group: ' +
      'total stars, accuracy, time spent, active days, levels completed, and subjects covered.',
    inputSchema: {
      type: 'object',
      properties: { ...groupParam },
      required: [],
    },
  },

  // ── Local assignments ─────────────────────────────────────────────────────
  {
    name: 'list_assignments',
    description:
      'List local lesson assignments (stored by default in ~/.config/anton/assignments.json; ' +
      'override with ANTON_ASSIGNMENTS_FILE).',
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
    description: 'Create a local lesson assignment for a child.',
    inputSchema: {
      type: 'object',
      properties: {
        childName: { type: 'string', description: 'Child name or publicId' },
        fileId: { type: 'string', description: 'Lesson fileId' },
        lessonTitle: { type: 'string', description: 'Human-readable lesson title (optional)' },
        note: { type: 'string', description: 'Optional note' },
      },
      required: ['childName', 'fileId'],
    },
  },
  {
    name: 'update_assignment',
    description: 'Update an existing local assignment (status, note).',
    inputSchema: {
      type: 'object',
      properties: {
        id: { type: 'string', description: 'Assignment UUID' },
        status: {
          type: 'string',
          enum: ['pending', 'completed', 'cancelled'],
          description: 'New status',
        },
        note: { type: 'string', description: 'Updated note' },
      },
      required: ['id'],
    },
  },
  {
    name: 'delete_assignment',
    description: 'Delete a local assignment.',
    inputSchema: {
      type: 'object',
      properties: {
        id: { type: 'string', description: 'Assignment UUID' },
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

/** Build the MCP server with all tools, without connecting a transport. */
export function createServer(anton: Anton): McpServer {
  const mcp = new McpServer({ name: 'anton', version }, { capabilities: { tools: {} } });
  const handlers = buildToolHandlers(anton);

  // The tools are declared with plain JSON schemas, so they are served through
  // the low-level request handlers instead of McpServer.registerTool().
  mcp.server.setRequestHandler(ListToolsRequestSchema, () => ({ tools: TOOLS }));

  mcp.server.setRequestHandler(CallToolRequestSchema, async (request) => {
    const { name, arguments: args = {} } = request.params;

    try {
      // Object.hasOwn: inherited names such as "constructor" are not tools.
      if (!Object.hasOwn(handlers, name)) throw new Error(`Unknown tool: ${name}`);
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

/** Start the MCP server over stdio. */
export async function startMcpServer(anton: Anton): Promise<void> {
  await createServer(anton).connect(new StdioServerTransport());
}
