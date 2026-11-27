/**
 * Offline unit tests for the MCP server: a mocked Anton instance driven by a
 * real MCP client over an in-memory transport.
 */

import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { Anton } from '../../src/Anton.js';
import { createServer, startMcpServer } from '../../src/mcp.js';

const stdio = vi.hoisted(() => ({ instances: [] as unknown[] }));

vi.mock('@modelcontextprotocol/sdk/server/stdio.js', () => ({
  StdioServerTransport: class {
    constructor() {
      stdio.instances.push(this);
    }
    start = vi.fn(() => Promise.resolve());
    close = vi.fn(() => Promise.resolve());
    send = vi.fn(() => Promise.resolve());
  },
}));

const METHODS = [
  'getStatus',
  'listGroups',
  'getGroup',
  'getGroupAssignments',
  'pinBlock',
  'unpinBlock',
  'getProgress',
  'getEvents',
  'getLevelProgress',
  'listChildren',
  'listPlans',
  'listTopics',
  'getTopicBlocks',
  'getPlan',
  'getLesson',
  'checkAssignmentCompletion',
  'getWeeklySummary',
  'getSubjectSummary',
  'getActivityTimeline',
  'compareChildren',
  'listAssignments',
  'assignLesson',
  'updateAssignment',
  'deleteAssignment',
] as const;

type MockAnton = Record<(typeof METHODS)[number], ReturnType<typeof vi.fn>>;

let anton: MockAnton;

beforeEach(() => {
  anton = Object.fromEntries(
    METHODS.map((m) => [m, vi.fn(() => ({ method: m }))]),
  ) as unknown as MockAnton;
});

interface ToolResult {
  content: { type: string; text: string }[];
  isError?: boolean;
}

async function withClient<T>(
  fn: (client: Client) => Promise<T>,
  connect?: () => Promise<void>,
): Promise<T> {
  const [serverTransport, clientTransport] = InMemoryTransport.createLinkedPair();
  const server = createServer(anton as unknown as Anton, connect);
  const client = new Client({ name: 'test-client', version: '1.0.0' });
  await Promise.all([server.connect(serverTransport), client.connect(clientTransport)]);
  try {
    return await fn(client);
  } finally {
    await client.close();
    await server.close();
  }
}

function callTool(name: string, args?: Record<string, unknown>): Promise<ToolResult> {
  return withClient(
    async (client) =>
      (await client.callTool(
        args === undefined ? { name } : { name, arguments: args },
      )) as ToolResult,
  );
}

describe('tools/list', () => {
  it('lists all 24 tools with input schemas', async () => {
    const { tools } = await withClient((client) => client.listTools());
    expect(tools).toHaveLength(24);
    for (const tool of tools) {
      expect(tool.inputSchema.type).toBe('object');
      expect(tool.description).toBeTruthy();
    }
  });

  it('gives every tool a title and annotations, and marks only the changes as writing', async () => {
    const { tools } = await withClient((client) => client.listTools());
    const writing = tools.filter((tool) => tool.annotations?.readOnlyHint === false);
    expect(writing.map((tool) => tool.name).sort()).toEqual([
      'assign_lesson',
      'delete_assignment',
      'pin_block',
      'unpin_block',
      'update_assignment',
    ]);
    for (const tool of tools) {
      expect(tool.title).toBeTruthy();
      expect(tool.annotations?.openWorldHint).toBe(false);
    }
    const destructive = writing.filter((tool) => tool.annotations?.destructiveHint === true);
    expect(destructive.map((tool) => tool.name).sort()).toEqual([
      'delete_assignment',
      'unpin_block',
    ]);
  });
});

// [tool, arguments, Anton method, expected call arguments]
const CASES: [string, Record<string, unknown>, (typeof METHODS)[number], unknown[]][] = [
  ['get_status', { group: 'G' }, 'getStatus', [{ groupName: 'G' }]],
  ['list_groups', {}, 'listGroups', []],
  ['get_group', { group: 'G' }, 'getGroup', [{ groupName: 'G' }]],
  [
    'get_group_assignments',
    { childPublicId: 'P-1', week: '2099-01-05', group: 'G' },
    'getGroupAssignments',
    [{ childPublicId: 'P-1', week: '2099-01-05', groupName: 'G' }],
  ],
  [
    'pin_block',
    { project: 'c-mat-4', topicIndex: 1, blockTitle: 'Brüche', childName: 'Kid', group: 'G' },
    'pinBlock',
    // pin_block passes all arguments through, including the raw `group`.
    [
      {
        project: 'c-mat-4',
        topicIndex: 1,
        blockTitle: 'Brüche',
        childName: 'Kid',
        group: 'G',
        groupName: 'G',
      },
    ],
  ],
  [
    'unpin_block',
    { blockPuid: 'c-mat-4/x', weekStartAt: '2099-01-05', childPublicId: 'P-1', group: 'G' },
    'unpinBlock',
    [{ blockPuid: 'c-mat-4/x', weekStartAt: '2099-01-05', childPublicId: 'P-1', groupName: 'G' }],
  ],
  [
    'get_progress',
    { childName: 'Kid', since: '2025-01-01', group: 'G' },
    'getProgress',
    [{ childName: 'Kid', since: '2025-01-01', groupName: 'G' }],
  ],
  [
    'get_events',
    { childName: 'Kid', since: '2025-01-01', eventType: 'finishLevel', limit: 5, group: 'G' },
    'getEvents',
    [
      {
        childName: 'Kid',
        since: '2025-01-01',
        eventType: 'finishLevel',
        limit: 5,
        groupName: 'G',
      },
    ],
  ],
  [
    'get_level_progress',
    { levelPuid: 'c-mat-4/l', childName: 'Kid', childPublicId: 'P-1', group: 'G' },
    'getLevelProgress',
    [{ levelPuid: 'c-mat-4/l', childName: 'Kid', childPublicId: 'P-1', groupName: 'G' }],
  ],
  ['list_children', { group: 'G' }, 'listChildren', [{ groupName: 'G' }]],
  [
    'list_plans',
    { subject: 'mat', grade: 4, language: 'de' },
    'listPlans',
    [{ subject: 'mat', grade: 4, language: 'de' }],
  ],
  ['list_topics', { project: 'c-mat-4' }, 'listTopics', [{ project: 'c-mat-4' }]],
  [
    'get_topic_blocks',
    { project: 'c-mat-4', topicIndex: 2, topicTitle: 'Brüche' },
    'getTopicBlocks',
    [{ project: 'c-mat-4', topicIndex: 2, topicTitle: 'Brüche' }],
  ],
  ['get_plan', { project: 'c-mat-4' }, 'getPlan', [{ project: 'c-mat-4' }]],
  ['get_lesson', { fileId: 'level/x' }, 'getLesson', [{ fileId: 'level/x' }]],
  [
    'check_assignment_completion',
    { childName: 'Kid', week: '2099-01-05', group: 'G' },
    'checkAssignmentCompletion',
    [{ childName: 'Kid', week: '2099-01-05', groupName: 'G' }],
  ],
  [
    'get_weekly_summary',
    { childName: 'Kid', weekStartAt: '2099-01-05', group: 'G' },
    'getWeeklySummary',
    [{ childName: 'Kid', weekStartAt: '2099-01-05', groupName: 'G' }],
  ],
  [
    'get_subject_summary',
    { childName: 'Kid', subject: 'mat', group: 'G' },
    'getSubjectSummary',
    [{ childName: 'Kid', subject: 'mat', groupName: 'G' }],
  ],
  [
    'get_activity_timeline',
    { childName: 'Kid', since: '2025-01-01', group: 'G' },
    'getActivityTimeline',
    [{ childName: 'Kid', since: '2025-01-01', groupName: 'G' }],
  ],
  ['compare_children', { group: 'G' }, 'compareChildren', [{ groupName: 'G' }]],
  [
    'list_assignments',
    { childName: 'Kid', status: 'pending' },
    'listAssignments',
    [{ childName: 'Kid', status: 'pending' }],
  ],
  [
    'assign_lesson',
    { childName: 'Kid', fileId: 'level/x', lessonTitle: 'T', note: 'N' },
    'assignLesson',
    [{ childName: 'Kid', fileId: 'level/x', lessonTitle: 'T', note: 'N' }],
  ],
  [
    'update_assignment',
    { id: 'abc', status: 'completed', note: 'done' },
    'updateAssignment',
    ['abc', { status: 'completed', note: 'done' }],
  ],
];

describe('tools/call', () => {
  it.each(CASES)(
    '%s calls Anton with the mapped arguments',
    async (tool, args, method, expected) => {
      const result = await callTool(tool, args);
      expect(result.isError).toBeFalsy();
      expect(anton[method]).toHaveBeenCalledWith(...expected);
      expect(JSON.parse(result.content[0]!.text)).toEqual({ method });
    },
  );

  it('delete_assignment deletes and reports the id', async () => {
    const result = await callTool('delete_assignment', { id: 'abc' });
    expect(anton.deleteAssignment).toHaveBeenCalledWith('abc');
    expect(JSON.parse(result.content[0]!.text)).toEqual({ deleted: true, id: 'abc' });
  });

  it('works when no arguments are sent', async () => {
    const result = await callTool('get_status');
    expect(result.isError).toBeFalsy();
    expect(anton.getStatus).toHaveBeenCalledWith({ groupName: undefined });
  });

  it('returns an error result for an unknown tool', async () => {
    const result = await callTool('no_such_tool', {});
    expect(result.isError).toBe(true);
    expect(result.content[0]!.text).toBe('Error: Unknown tool: no_such_tool');
  });

  it('does not treat inherited object properties as tools', async () => {
    const result = await callTool('constructor', {});
    expect(result.isError).toBe(true);
    expect(result.content[0]!.text).toBe('Error: Unknown tool: constructor');
  });

  it('returns an error result when Anton throws', async () => {
    anton.getGroup.mockRejectedValueOnce(new Error('boom'));
    const result = await callTool('get_group', {});
    expect(result.isError).toBe(true);
    expect(result.content[0]!.text).toBe('Error: boom');
  });
});

describe('sign-in', () => {
  const call = (client: Client, name: string) =>
    client.callTool({ name, arguments: {} }) as Promise<ToolResult>;

  it('does not sign in to list the tools', async () => {
    const connect = vi.fn(async () => {});
    await withClient((client) => client.listTools(), connect);
    expect(connect).not.toHaveBeenCalled();
  });

  it('signs in once, on the first tool call', async () => {
    const connect = vi.fn(async () => {});
    await withClient(async (client) => {
      expect((await call(client, 'get_status')).isError).toBeFalsy();
      expect((await call(client, 'list_groups')).isError).toBeFalsy();
    }, connect);
    expect(connect).toHaveBeenCalledOnce();
  });

  it('does not sign in for unknown tools', async () => {
    const connect = vi.fn(async () => {});
    await withClient((client) => call(client, 'nope'), connect);
    expect(connect).not.toHaveBeenCalled();
  });

  it('returns a failed sign-in as error and retries on the next call', async () => {
    const connect = vi
      .fn<() => Promise<void>>()
      .mockRejectedValueOnce(new Error('bad token'))
      .mockResolvedValueOnce();
    await withClient(async (client) => {
      const failed = await call(client, 'get_status');
      expect(failed.isError).toBe(true);
      expect(failed.content[0]!.text).toBe('Error: Authentication failed: bad token');
      expect(anton.getStatus).not.toHaveBeenCalled();
      expect((await call(client, 'get_status')).isError).toBeFalsy();
    }, connect);
    expect(connect).toHaveBeenCalledTimes(2);
  });
});

describe('startMcpServer', () => {
  it('connects the server to a stdio transport', async () => {
    stdio.instances.length = 0;
    await startMcpServer(anton as unknown as Anton);
    expect(stdio.instances).toHaveLength(1);
  });
});
