/**
 * MCP integration tests — spawns the MCP server as a subprocess and drives it
 * using the @modelcontextprotocol/sdk Client over stdio.
 *
 * This is equivalent to what `npx @modelcontextprotocol/inspector --cli` does
 * but without the inspector wrapper, testing the raw MCP protocol directly.
 *
 * Prerequisites:
 *   ANTON_LOGIN_CODE=<parent 8-char code>
 *   npm run build   (dist/ must be up-to-date)
 *
 * Run:
 *   npm test test/mcp.test.ts
 */

import { spawn } from 'node:child_process';
import { resolve } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const CHILD_NAME = 'Test';
const CLI = resolve(import.meta.dirname, '../dist/cli.js');

// Each test file uses a distinct far-future week so concurrent runs never
// collide on the same pin (sdk=2099-03, mcp=2099-06, integration=2099-01).
const FAR_FUTURE_WEEK = '2099-06-01';

// ---------------------------------------------------------------------------
// Shared MCP client — connected once for the entire test suite
// ---------------------------------------------------------------------------

let client: Client;
let transport: StdioClientTransport;

beforeAll(async () => {
  if (!process.env['ANTON_LOGIN_CODE']) {
    throw new Error(
      'ANTON_LOGIN_CODE is not set — cannot run MCP integration tests.\n' +
        'Export it before running: ANTON_LOGIN_CODE=YOUR-CODE npm test',
    );
  }

  transport = new StdioClientTransport({
    command: 'node',
    args: [CLI, 'mcp'],
    env: { ...process.env, ANTON_LOGIN_CODE: process.env['ANTON_LOGIN_CODE'] },
  });

  client = new Client({ name: 'anton-test', version: '0.0.1' });
  await client.connect(transport);
}, 60_000);

afterAll(async () => {
  await client?.close();
});

// ---------------------------------------------------------------------------
// Helper: call a tool and parse the text content
// ---------------------------------------------------------------------------

async function callTool(name: string, args: Record<string, unknown> = {}): Promise<unknown> {
  const response = await client.callTool({ name, arguments: args });
  const content = response.content as Array<{ type: string; text: string }>;
  if (content[0]?.type !== 'text') throw new Error(`Unexpected content type: ${content[0]?.type}`);
  return JSON.parse(content[0].text);
}

// ---------------------------------------------------------------------------
// tools/list
// ---------------------------------------------------------------------------

describe('MCP tools/list', () => {
  it('returns exactly 24 tools', async () => {
    const response = await client.listTools();
    expect(response.tools).toHaveLength(24);
  });

  it('every tool has a name, description, and inputSchema', async () => {
    const { tools } = await client.listTools();
    for (const tool of tools) {
      expect(tool.name).toBeTruthy();
      expect(tool.description).toBeTruthy();
      expect(tool.inputSchema).toBeDefined();
    }
  });

  it('includes all expected tool names', async () => {
    const { tools } = await client.listTools();
    const names = tools.map((t) => t.name);
    const expected = [
      'get_status', 'list_groups', 'get_group', 'get_group_assignments', 'pin_block', 'unpin_block',
      'get_progress', 'get_events', 'get_level_progress', 'list_children',
      'list_plans', 'list_topics', 'get_topic_blocks', 'get_plan', 'get_lesson',
      'check_assignment_completion', 'get_weekly_summary', 'get_subject_summary',
      'get_activity_timeline', 'compare_children',
      'list_assignments', 'assign_lesson', 'update_assignment', 'delete_assignment',
    ];
    for (const name of expected) {
      expect(names).toContain(name);
    }
  });
});

// ---------------------------------------------------------------------------
// tools/call — read-only tools
// ---------------------------------------------------------------------------

describe('MCP tools/call get_status', () => {
  it('returns parent, group, totalGroups, and children', async () => {
    const result = await callTool('get_status') as {
      parent: { logId: string; displayName: string };
      group: { groupCode: string };
      totalGroups: number;
      children: unknown[];
    };
    expect(result.parent.logId).toBeTruthy();
    expect(result.parent.displayName).toBeTruthy();
    expect(result.group.groupCode).toBeTruthy();
    expect(typeof result.totalGroups).toBe('number');
    expect(result.totalGroups).toBeGreaterThan(0);
    expect(Array.isArray(result.children)).toBe(true);
  });
});

describe('MCP tools/call list_groups', () => {
  it('returns at least one group with members', async () => {
    const groups = await callTool('list_groups') as Array<{
      groupCode: string;
      groupName: string;
      members: Array<{ publicId: string; role: string }>;
    }>;
    expect(Array.isArray(groups)).toBe(true);
    expect(groups.length).toBeGreaterThan(0);
    expect(groups[0]!.groupCode).toBeTruthy();
    expect(groups[0]!.groupName).toBeTruthy();
    expect(Array.isArray(groups[0]!.members)).toBe(true);
    expect(groups[0]!.members.length).toBeGreaterThan(0);
    expect(groups[0]!.members[0]!.publicId).toBeTruthy();
    expect(groups[0]!.members[0]!.role).toBeTruthy();
  });
});

describe('MCP tools/call list_children', () => {
  it('returns at least one child including Test', async () => {
    const children = await callTool('list_children') as Array<{ displayName?: string; publicId: string }>;
    expect(children.length).toBeGreaterThan(0);
    const test = children.find((c) => c.displayName?.toLowerCase() === CHILD_NAME.toLowerCase());
    expect(test).toBeDefined();
    expect(test!.publicId).toBeTruthy();
  });
});

describe('MCP tools/call list_plans', () => {
  it('returns plans without filters', async () => {
    const plans = await callTool('list_plans') as unknown[];
    expect(plans.length).toBeGreaterThan(50);
  });

  it('can filter by subject', async () => {
    const plans = await callTool('list_plans', { subject: 'mat' }) as Array<{ subject: string }>;
    expect(plans.length).toBeGreaterThan(0);
    for (const p of plans) {
      expect(p.subject?.toLowerCase()).toContain('mat');
    }
  });
});

describe('MCP tools/call get_progress', () => {
  it('returns a progress summary for the Test child', async () => {
    const result = await callTool('get_progress', { childName: CHILD_NAME }) as {
      logId: string;
      totalEvents: number;
      completedLevels: unknown[];
    };
    expect(result.logId).toBeTruthy();
    expect(typeof result.totalEvents).toBe('number');
    expect(Array.isArray(result.completedLevels)).toBe(true);
  });
});

describe('MCP tools/call list_topics', () => {
  it('returns topics for c-mat-4', async () => {
    const result = await callTool('list_topics', { project: 'c-mat-4' }) as {
      project: string;
      topics: Array<{ title: string }>;
    };
    expect(result.project).toBe('c-mat-4');
    expect(result.topics.length).toBeGreaterThan(0);
  });
});

// ---------------------------------------------------------------------------
// tools/call get_group
// ---------------------------------------------------------------------------

describe('MCP tools/call get_group', () => {
  it('returns group info with members and pinnedBlocks', async () => {
    const result = await callTool('get_group') as {
      groupCode: string;
      members: unknown[];
      pinnedBlocks: unknown[];
    };
    expect(result.groupCode).toBeTruthy();
    expect(Array.isArray(result.members)).toBe(true);
    expect(Array.isArray(result.pinnedBlocks)).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// tools/call get_topic_blocks / get_plan
// ---------------------------------------------------------------------------

describe('MCP tools/call get_topic_blocks', () => {
  it('returns blocks for topic index 0 of c-mat-4', async () => {
    const result = await callTool('get_topic_blocks', { project: 'c-mat-4', topicIndex: 0 }) as {
      project: string;
      blocks: Array<{ puid: string; blockPath: string; levels: unknown[] }>;
    };
    expect(result.project).toBe('c-mat-4');
    expect(result.blocks.length).toBeGreaterThan(0);
    expect(result.blocks[0]!.puid).toBeTruthy();
  });
});

describe('MCP tools/call get_plan', () => {
  it('returns the full hierarchy for c-mat-4', async () => {
    const result = await callTool('get_plan', { project: 'c-mat-4' }) as {
      project: string;
      topics: Array<{ title: string; blocks: unknown[] }>;
    };
    expect(result.project).toBe('c-mat-4');
    expect(result.topics.length).toBeGreaterThan(0);
  });
});

// ---------------------------------------------------------------------------
// tools/call get_lesson
// ---------------------------------------------------------------------------

describe('MCP tools/call get_lesson', () => {
  it('returns lesson content for a real level fileId', async () => {
    const topicResult = await callTool('get_topic_blocks', { project: 'c-mat-4', topicIndex: 0 }) as {
      blocks: Array<{ levels: Array<{ fileId?: string }> }>;
    };
    const level = topicResult.blocks[0]!.levels.find((lv) => lv.fileId);
    expect(level).toBeDefined();
    const result = await callTool('get_lesson', { fileId: level!.fileId });
    expect(result).toBeDefined();
  }, 30_000);
});

// ---------------------------------------------------------------------------
// tools/call get_events
// ---------------------------------------------------------------------------

describe('MCP tools/call get_events', () => {
  it('returns raw events for the Test child', async () => {
    const events = await callTool('get_events', { childName: CHILD_NAME, limit: 10 }) as unknown[];
    expect(Array.isArray(events)).toBe(true);
    expect(events.length).toBeLessThanOrEqual(10);
  });

  it('can filter by event type', async () => {
    const events = await callTool('get_events', {
      childName: CHILD_NAME,
      eventType: 'finishLevel',
      limit: 5,
    }) as Array<{ event: string }>;
    for (const e of events) {
      expect(e.event).toBe('finishLevel');
    }
  });
});

// ---------------------------------------------------------------------------
// tools/call get_level_progress
// ---------------------------------------------------------------------------

describe('MCP tools/call get_level_progress', () => {
  it('returns level progress for the Test child', async () => {
    const topicResult = await callTool('get_topic_blocks', { project: 'c-mat-4', topicIndex: 0 }) as {
      blocks: Array<{ puid: string }>;
    };
    const blockPuid = topicResult.blocks[0]!.puid;
    const result = await callTool('get_level_progress', { levelPuid: blockPuid, childName: CHILD_NAME });
    expect(result).toBeDefined();
  }, 30_000);
});

// ---------------------------------------------------------------------------
// tools/call check_assignment_completion
// ---------------------------------------------------------------------------

describe('MCP tools/call check_assignment_completion', () => {
  it('returns a completion report for the Test child', async () => {
    const result = await callTool('check_assignment_completion', { childName: CHILD_NAME }) as {
      childName: string;
      assignments: unknown[];
    };
    expect(result.childName).toBe(CHILD_NAME);
    expect(Array.isArray(result.assignments)).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// tools/call get_weekly_summary
// ---------------------------------------------------------------------------

describe('MCP tools/call get_weekly_summary', () => {
  it('returns a weekly summary for the Test child', async () => {
    const result = await callTool('get_weekly_summary', {
      childName: CHILD_NAME,
      weekStartAt: '2025-01-06',
    }) as {
      childName: string;
      weekStartAt: string;
      levelsCompleted: number;
      averageAccuracy: number;
    };
    expect(result.childName).toBe(CHILD_NAME);
    expect(result.weekStartAt).toBe('2025-01-06');
    expect(typeof result.levelsCompleted).toBe('number');
    expect(typeof result.averageAccuracy).toBe('number');
  }, 30_000);
});

// ---------------------------------------------------------------------------
// tools/call get_subject_summary
// ---------------------------------------------------------------------------

describe('MCP tools/call get_subject_summary', () => {
  it('returns per-subject stats for the Test child', async () => {
    const result = await callTool('get_subject_summary', { childName: CHILD_NAME }) as {
      childName: string;
      subjects: unknown[];
    };
    expect(result.childName).toBe(CHILD_NAME);
    expect(Array.isArray(result.subjects)).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// tools/call get_activity_timeline
// ---------------------------------------------------------------------------

describe('MCP tools/call get_activity_timeline', () => {
  it('returns an activity timeline for the Test child', async () => {
    const result = await callTool('get_activity_timeline', {
      childName: CHILD_NAME,
      since: '2025-01-01',
    }) as {
      childName: string;
      activeDays: number;
      dailyActivity: unknown[];
    };
    expect(result.childName).toBe(CHILD_NAME);
    expect(typeof result.activeDays).toBe('number');
    expect(Array.isArray(result.dailyActivity)).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// tools/call compare_children
// ---------------------------------------------------------------------------

describe('MCP tools/call compare_children', () => {
  it('returns a side-by-side comparison of all children', async () => {
    const result = await callTool('compare_children') as {
      children: Array<{ childName: string; totalStars: number }>;
    };
    expect(Array.isArray(result.children)).toBe(true);
    expect(result.children.length).toBeGreaterThan(0);
    expect(result.children[0]!.childName).toBeTruthy();
    expect(typeof result.children[0]!.totalStars).toBe('number');
  }, 30_000);
});

// ---------------------------------------------------------------------------
// tools/call local assignments CRUD
// Atomic: create → list → update → delete in one test to avoid leftover state.
// ---------------------------------------------------------------------------

describe('MCP tools/call local assignments CRUD', () => {
  it('creates, lists, updates, and deletes a local assignment', async () => {
    const FILE_ID = 'c-mat-4/topic-01/block-01/level-01';

    // Create
    const created = await callTool('assign_lesson', {
      childName: CHILD_NAME,
      fileId: FILE_ID,
      lessonTitle: 'MCP Test Level',
    }) as { id: string; status: string };
    expect(created.id).toBeTruthy();
    expect(created.status).toBe('pending');

    // List — should include our entry
    const list = await callTool('list_assignments', { childName: CHILD_NAME }) as Array<{ id: string }>;
    expect(list.some((a) => a.id === created.id)).toBe(true);

    // Update status
    const updated = await callTool('update_assignment', {
      id: created.id,
      status: 'completed',
    }) as { id: string; status: string };
    expect(updated.id).toBe(created.id);
    expect(updated.status).toBe('completed');

    // Delete
    const deleted = await callTool('delete_assignment', { id: created.id }) as { deleted: boolean };
    expect(deleted.deleted).toBe(true);

    // Verify gone
    const after = await callTool('list_assignments', { childName: CHILD_NAME }) as Array<{ id: string }>;
    expect(after.some((a) => a.id === created.id)).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// tools/call group parameter
// ---------------------------------------------------------------------------

describe('MCP tools/call group parameter', () => {
  it('get_group with valid group name returns same groupCode as default', async () => {
    const groups = await callTool('list_groups') as Array<{ groupName: string; groupCode: string }>;
    const groupName = groups[0]!.groupName;

    const [named, unnamed] = await Promise.all([
      callTool('get_group', { group: groupName }),
      callTool('get_group'),
    ]) as [{ groupCode: string }, { groupCode: string }];
    expect(named.groupCode).toBe(unnamed.groupCode);
  });

  it('get_group with invalid group name returns isError=true', async () => {
    const response = await client.callTool({ name: 'get_group', arguments: { group: 'NoSuchGroupXYZ' } });
    expect(response.isError).toBe(true);
    const text = (response.content as Array<{ text: string }>)[0]!.text;
    expect(text).toMatch(/not found/i);
  });

  it('list_children with valid group name returns same count as default', async () => {
    const groups = await callTool('list_groups') as Array<{ groupName: string }>;
    const groupName = groups[0]!.groupName;

    const [named, unnamed] = await Promise.all([
      callTool('list_children', { group: groupName }),
      callTool('list_children'),
    ]) as [unknown[], unknown[]];
    expect(named.length).toBe(unnamed.length);
  });
}, 30_000);

// ---------------------------------------------------------------------------
// tools/call pin_block / unpin_block
// Pin and unpin are a single atomic test — they must not be split across
// separate it() blocks or run concurrently with other files' pin tests.
// This file uses FAR_FUTURE_WEEK=2099-06 (sdk=2099-03, integration=2099-01).
// ---------------------------------------------------------------------------

describe('MCP tools/call pin_block / unpin_block', () => {
  it('pins a block for the Test child then unpins it', async () => {
    // Resolve the Test child publicId
    const children = await callTool('list_children') as Array<{ displayName?: string; publicId: string }>;
    const testChild = children.find((c) => c.displayName?.toLowerCase() === CHILD_NAME.toLowerCase())!;
    expect(testChild).toBeDefined();

    // Resolve a real block puid from the catalogue
    const topicResult = await callTool('get_topic_blocks', { project: 'c-mat-4', topicIndex: 0 }) as {
      blocks: Array<{ puid: string; blockPath: string }>;
    };
    const block = topicResult.blocks[0]!;

    // Pin for the Test child in the far-future week
    const pinResult = await callTool('pin_block', {
      project: 'c-mat-4',
      topicIndex: 0,
      blockIndex: 0,
      weekStartAt: FAR_FUTURE_WEEK,
      childName: CHILD_NAME,
    }) as { pinned: boolean; blockPuid: string; weekStartAt: string };
    expect(pinResult.pinned).toBe(true);
    expect(pinResult.blockPuid).toBe(block.puid);
    expect(pinResult.weekStartAt).toBe(FAR_FUTURE_WEEK);

    // Verify the pin appears in group assignments
    const assignments = await callTool('get_group_assignments', {
      week: FAR_FUTURE_WEEK,
      childPublicId: testChild.publicId,
    }) as Array<{ puid: string; weekStartAt: string }>;
    const ourPin = assignments.find(
      (a) => a.puid === block.puid && a.weekStartAt === FAR_FUTURE_WEEK,
    );
    expect(ourPin).toBeDefined();

    // Unpin and verify it is gone
    const unpinResult = await callTool('unpin_block', {
      blockPuid: block.puid,
      weekStartAt: FAR_FUTURE_WEEK,
    }) as { unpinned: boolean };
    expect(unpinResult.unpinned).toBe(true);

    const after = await callTool('get_group_assignments', {
      week: FAR_FUTURE_WEEK,
      childPublicId: testChild.publicId,
    }) as Array<{ puid: string; weekStartAt: string }>;
    expect(after.find((a) => a.puid === block.puid && a.weekStartAt === FAR_FUTURE_WEEK)).toBeUndefined();
  }, 60_000);
});
