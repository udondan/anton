/**
 * Anton MCP server.
 *
 * Wraps the Anton SDK as an MCP server over stdio.
 * Start via: anton mcp
 */

import { createRequire } from 'node:module';
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
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
      'Returns parent account info, all groups the parent belongs to, and pupils in the active group.',
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
// Server bootstrap
// ---------------------------------------------------------------------------

export async function startMcpServer(anton: Anton): Promise<void> {
  const server = new Server({ name: 'anton', version }, { capabilities: { tools: {} } });

  server.setRequestHandler(ListToolsRequestSchema, () => ({ tools: TOOLS }));

  server.setRequestHandler(CallToolRequestSchema, async (request) => {
    const { name, arguments: args = {} } = request.params;

    try {
      let result: unknown;
      const group = args['group'] as string | undefined;

      switch (name) {
        case 'get_status':
          result = anton.getStatus({ groupName: group });
          break;
        case 'list_groups':
          result = anton.listGroups();
          break;
        case 'get_group':
          result = await anton.getGroup({ groupName: group });
          break;
        case 'get_group_assignments':
          result = await anton.getGroupAssignments({
            childPublicId: args['childPublicId'] as string | undefined,
            week: args['week'] as string | undefined,
            groupName: group,
          });
          break;
        case 'pin_block':
          result = await anton.pinBlock({
            ...(args as Parameters<typeof anton.pinBlock>[0]),
            groupName: group,
          });
          break;
        case 'unpin_block':
          result = await anton.unpinBlock({
            blockPuid: args['blockPuid'] as string,
            weekStartAt: args['weekStartAt'] as string,
            childPublicId: args['childPublicId'] as string | undefined,
            groupName: group,
          });
          break;
        case 'get_progress':
          result = await anton.getProgress({
            childName: args['childName'] as string,
            since: args['since'] as string | undefined,
            groupName: group,
          });
          break;
        case 'get_events':
          result = await anton.getEvents({
            childName: args['childName'] as string,
            since: args['since'] as string | undefined,
            eventType: args['eventType'] as string | undefined,
            limit: args['limit'] as number | undefined,
            groupName: group,
          });
          break;
        case 'get_level_progress':
          result = await anton.getLevelProgress({
            levelPuid: args['levelPuid'] as string,
            childName: args['childName'] as string | undefined,
            childPublicId: args['childPublicId'] as string | undefined,
            groupName: group,
          });
          break;
        case 'list_children':
          result = anton.listChildren({ groupName: group });
          break;
        case 'list_plans':
          result = await anton.listPlans({
            subject: args['subject'] as string | undefined,
            grade: args['grade'] as number | undefined,
            language: args['language'] as string | undefined,
          });
          break;
        case 'list_topics':
          result = await anton.listTopics({ project: args['project'] as string });
          break;
        case 'get_topic_blocks':
          result = await anton.getTopicBlocks({
            project: args['project'] as string,
            topicIndex: args['topicIndex'] as number | undefined,
            topicTitle: args['topicTitle'] as string | undefined,
          });
          break;
        case 'get_plan':
          result = await anton.getPlan({ project: args['project'] as string });
          break;
        case 'get_lesson':
          result = await anton.getLesson({ fileId: args['fileId'] as string });
          break;
        case 'check_assignment_completion':
          result = await anton.checkAssignmentCompletion({
            childName: args['childName'] as string,
            week: args['week'] as string | undefined,
            groupName: group,
          });
          break;
        case 'get_weekly_summary':
          result = await anton.getWeeklySummary({
            childName: args['childName'] as string,
            weekStartAt: args['weekStartAt'] as string | undefined,
            groupName: group,
          });
          break;
        case 'get_subject_summary':
          result = await anton.getSubjectSummary({
            childName: args['childName'] as string,
            subject: args['subject'] as string | undefined,
            groupName: group,
          });
          break;
        case 'get_activity_timeline':
          result = await anton.getActivityTimeline({
            childName: args['childName'] as string,
            since: args['since'] as string | undefined,
            groupName: group,
          });
          break;
        case 'compare_children':
          result = await anton.compareChildren({ groupName: group });
          break;
        case 'list_assignments':
          result = anton.listAssignments({
            childName: args['childName'] as string | undefined,
            status: args['status'] as 'pending' | 'completed' | 'cancelled' | undefined,
          });
          break;
        case 'assign_lesson':
          result = anton.assignLesson({
            childName: args['childName'] as string,
            fileId: args['fileId'] as string,
            lessonTitle: args['lessonTitle'] as string | undefined,
            note: args['note'] as string | undefined,
          });
          break;
        case 'update_assignment':
          result = anton.updateAssignment(args['id'] as string, {
            status: args['status'] as 'pending' | 'completed' | 'cancelled' | undefined,
            note: args['note'] as string | undefined,
          });
          break;
        case 'delete_assignment':
          anton.deleteAssignment(args['id'] as string);
          result = { deleted: true, id: args['id'] };
          break;
        default:
          throw new Error(`Unknown tool: ${name}`);
      }

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

  const transport = new StdioServerTransport();
  await server.connect(transport);
}
