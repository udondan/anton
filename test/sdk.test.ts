/**
 * SDK integration tests — exercise the Anton class directly.
 *
 * Prerequisites:
 *   ANTON_LOGIN_CODE=<parent 8-char code>
 *
 * Run:
 *   npm test test/sdk.test.ts
 */

import { existsSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { Anton } from '../src/index.js';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const CHILD_NAME = 'Test';
const TEMP_ASSIGNMENTS = join(tmpdir(), `anton-sdk-test-${process.pid}.json`);

// Each test file uses a distinct far-future week so concurrent runs never
// collide on the same pin (sdk=2099-03, mcp=2099-06, integration=2099-01).
const FAR_FUTURE_WEEK = '2099-03-01';
const FAR_FUTURE_WEEK_TITLE = '2099-09-01'; // sdk title-based pin test
const FAR_FUTURE_WEEK_GROUP = '2099-12-01'; // sdk group-wide (no child) pin test

// ---------------------------------------------------------------------------
// Shared fixture
// ---------------------------------------------------------------------------

let anton: Anton;

beforeAll(async () => {
  const loginCode = process.env['ANTON_LOGIN_CODE'];
  if (!loginCode) {
    throw new Error(
      'ANTON_LOGIN_CODE is not set — cannot run SDK integration tests.\n' +
        'Export it before running: ANTON_LOGIN_CODE=YOUR-CODE npm test',
    );
  }
  process.env['ANTON_ASSIGNMENTS_FILE'] = TEMP_ASSIGNMENTS;

  anton = new Anton({ loginCode, groupName: process.env['ANTON_GROUP'] });
  await anton.connect();
}, 60_000);

afterAll(() => {
  if (existsSync(TEMP_ASSIGNMENTS)) rmSync(TEMP_ASSIGNMENTS);
});

// ---------------------------------------------------------------------------
// connect / getStatus
// ---------------------------------------------------------------------------

describe('Anton.connect / getStatus', () => {
  it('returns parent session info after connect', () => {
    const status = anton.getStatus();
    expect(status.parent).not.toBeNull();
    expect(status.parent!.logId).toBeTruthy();
    expect(status.parent!.loginCode).toBeTruthy();
    expect(status.parent!.displayName).toBeTruthy();
  });

  it('returns group info after connect', () => {
    const status = anton.getStatus();
    expect(status.group).not.toBeNull();
    expect(status.group!.groupCode).toBeTruthy();
    expect(status.group!.groupName).toBeTruthy();
    expect(status.group!.memberCount).toBeGreaterThan(0);
  });

  it('returns totalGroups count', () => {
    const status = anton.getStatus();
    expect(typeof status.totalGroups).toBe('number');
    expect(status.totalGroups).toBeGreaterThan(0);
  });

  it('lists pupil children', () => {
    const status = anton.getStatus();
    expect(status.children.length).toBeGreaterThan(0);
    for (const c of status.children) {
      expect(c.publicId).toBeTruthy();
    }
  });

  it('connect() is idempotent — second call is a no-op', async () => {
    await expect(anton.connect()).resolves.toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// connect via logId
// ---------------------------------------------------------------------------

describe('Anton.connect via logId', () => {
  it('authenticates using the parent logId from an existing session', async () => {
    const { parent } = anton.getStatus();
    const antonViaLogId = new Anton({ logId: parent!.logId });
    await antonViaLogId.connect();
    const newStatus = antonViaLogId.getStatus();
    expect(newStatus.parent!.logId).toBe(parent!.logId);
    expect(newStatus.totalGroups).toBeGreaterThan(0);
  }, 30_000);
});

// ---------------------------------------------------------------------------
// listGroups
// ---------------------------------------------------------------------------

describe('Anton.listGroups', () => {
  it('returns at least one group', () => {
    const groups = anton.listGroups();
    expect(groups.length).toBeGreaterThan(0);
  });

  it('each group has required fields', () => {
    for (const g of anton.listGroups()) {
      expect(g.groupCode).toBeTruthy();
      expect(g.groupName).toBeTruthy();
      expect(g.groupType).toBeTruthy();
      expect(Array.isArray(g.members)).toBe(true);
    }
  });

  it('groups include members with publicId and role', () => {
    for (const g of anton.listGroups()) {
      expect(g.members.length).toBeGreaterThan(0);
      for (const m of g.members) {
        expect(m.publicId).toBeTruthy();
        expect(m.role).toBeTruthy();
      }
    }
  });
});

// ---------------------------------------------------------------------------
// Multi-group selection (groupName parameter)
// ---------------------------------------------------------------------------

describe('Anton multi-group selection', () => {
  let defaultGroupName: string;

  beforeAll(() => {
    defaultGroupName = anton.getStatus().group!.groupName;
  });

  it('getGroup accepts groupName and returns the same group as default', async () => {
    const [named, unnamed] = await Promise.all([
      anton.getGroup({ groupName: defaultGroupName }),
      anton.getGroup(),
    ]);
    expect(named.groupCode).toBe(unnamed.groupCode);
  });

  it('getGroup throws for an unknown group name', async () => {
    await expect(anton.getGroup({ groupName: 'NoSuchGroupXYZ' })).rejects.toThrow(/not found/i);
  });

  it('listChildren accepts groupName and returns the same children as default', () => {
    const named = anton.listChildren({ groupName: defaultGroupName });
    const unnamed = anton.listChildren();
    expect(named.length).toBe(unnamed.length);
  });

  it('listChildren throws for an unknown group name', () => {
    expect(() => anton.listChildren({ groupName: 'NoSuchGroupXYZ' })).toThrow(/not found/i);
  });

  it('getGroupAssignments accepts groupName', async () => {
    const result = await anton.getGroupAssignments({ groupName: defaultGroupName });
    expect(Array.isArray(result)).toBe(true);
  });

  it('compareChildren accepts groupName', async () => {
    const result = await anton.compareChildren({ groupName: defaultGroupName });
    expect(Array.isArray((result as { children: unknown[] }).children)).toBe(true);
  }, 30_000);
});

// ---------------------------------------------------------------------------
// getGroup
// ---------------------------------------------------------------------------

describe('Anton.getGroup', () => {
  it('returns group members and pinned blocks', async () => {
    const group = await anton.getGroup();
    expect(group.groupCode).toBeTruthy();
    expect(group.members.length).toBeGreaterThan(0);
    expect(Array.isArray(group.pinnedBlocks)).toBe(true);
  });

  it('pinned blocks have the expected shape', async () => {
    const group = await anton.getGroup();
    for (const pin of group.pinnedBlocks) {
      expect(pin.puid).toBeTruthy();
      expect(pin.weekStartAt).toMatch(/^\d{4}-\d{2}-\d{2}$/);
      expect(pin.created).toBeTruthy();
    }
  });
});

// ---------------------------------------------------------------------------
// listChildren
// ---------------------------------------------------------------------------

describe('Anton.listChildren', () => {
  it('returns at least one child', () => {
    const children = anton.listChildren();
    expect(children.length).toBeGreaterThan(0);
  });

  it('includes the Test child with publicId', () => {
    const children = anton.listChildren();
    const test = children.find((c) => c.displayName?.toLowerCase() === CHILD_NAME.toLowerCase());
    expect(test).toBeDefined();
    expect(test!.publicId).toBeTruthy();
  });
});

// ---------------------------------------------------------------------------
// listPlans
// ---------------------------------------------------------------------------

describe('Anton.listPlans', () => {
  it('returns plans (filtered to default language)', async () => {
    const plans = await anton.listPlans();
    expect(plans.length).toBeGreaterThan(50);
  });

  it('can filter by subject', async () => {
    const plans = await anton.listPlans({ subject: 'mat' });
    expect(plans.length).toBeGreaterThan(0);
    for (const p of plans) {
      expect(p.subject?.toString().toLowerCase()).toContain('mat');
    }
  });

  it('can filter by grade', async () => {
    const plans = await anton.listPlans({ grade: 4 });
    expect(plans.length).toBeGreaterThan(0);
    for (const p of plans) {
      expect(p.grades).toContain(4);
    }
  });

  it('can filter by language', async () => {
    const de = await anton.listPlans({ language: 'de' });
    expect(de.length).toBeGreaterThan(50);
  });
});

// ---------------------------------------------------------------------------
// listTopics / getTopicBlocks
// ---------------------------------------------------------------------------

describe('Anton.listTopics', () => {
  it('returns topics for c-mat-4', async () => {
    const result = await anton.listTopics({ project: 'c-mat-4' });
    expect(result.project).toBe('c-mat-4');
    expect(result.topics.length).toBeGreaterThan(0);
    for (const [i, t] of result.topics.entries()) {
      expect(t.index).toBe(i);
      expect(t.title).toBeTruthy();
      expect(t.puid).toBeTruthy();
      expect(t.totalBlocks).toBeGreaterThan(0);
    }
  });
});

describe('Anton.getTopicBlocks', () => {
  it('returns blocks for topic index 0 of c-mat-4', async () => {
    const result = await anton.getTopicBlocks({ project: 'c-mat-4', topicIndex: 0 });
    expect(result.project).toBe('c-mat-4');
    expect(result.blocks.length).toBeGreaterThan(0);
    for (const b of result.blocks) {
      expect(b.puid).toBeTruthy();
      expect(b.blockPath).toMatch(/^\/\.\./);
      expect(b.levels.length).toBeGreaterThan(0);
    }
  });

  it('can find a topic by partial title', async () => {
    const topics = await anton.listTopics({ project: 'c-mat-4' });
    const firstTitle = topics.topics[0]!.title;
    const partial = firstTitle.slice(0, 4);
    const result = await anton.getTopicBlocks({ project: 'c-mat-4', topicTitle: partial });
    expect(result.blocks.length).toBeGreaterThan(0);
  });
});

// ---------------------------------------------------------------------------
// getProgress
// ---------------------------------------------------------------------------

describe('Anton.getProgress', () => {
  it('returns a progress summary for the Test child', async () => {
    const summary = await anton.getProgress({ childName: CHILD_NAME });
    expect(summary.logId).toBeTruthy();
    expect(typeof summary.totalEvents).toBe('number');
    expect(Array.isArray(summary.completedLevels)).toBe(true);
    expect(typeof summary.distinctBlocksCompleted).toBe('number');
  });

  it('respects the since date — far-future yields 0 events', async () => {
    const summary = await anton.getProgress({ childName: CHILD_NAME, since: '2099-01-01' });
    expect(summary.totalEvents).toBe(0);
    expect(summary.completedLevels).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// getWeeklySummary
// ---------------------------------------------------------------------------

describe('Anton.getWeeklySummary', () => {
  it('returns a weekly summary for the Test child', async () => {
    const summary = await anton.getWeeklySummary({
      childName: CHILD_NAME,
      weekStartAt: '2025-01-06',
    });
    expect(summary.childName).toBe(CHILD_NAME);
    expect(summary.weekStartAt).toBe('2025-01-06');
    expect(summary.weekEndAt).toBe('2025-01-12');
    expect(typeof summary.levelsCompleted).toBe('number');
    expect(typeof summary.averageAccuracy).toBe('number');
    expect(summary.averageAccuracy).toBeGreaterThanOrEqual(0);
    expect(summary.averageAccuracy).toBeLessThanOrEqual(1);
  }, 30_000);

  it('defaults weekStartAt to the current Monday when omitted', async () => {
    const now = new Date();
    const day = now.getDay();
    const diff = day === 0 ? -6 : 1 - day;
    now.setDate(now.getDate() + diff);
    const expectedMonday = now.toISOString().slice(0, 10);

    const summary = await anton.getWeeklySummary({ childName: CHILD_NAME });
    expect(summary.weekStartAt).toBe(expectedMonday);
  }, 30_000);
});

// ---------------------------------------------------------------------------
// pinBlock / unpinBlock
// ---------------------------------------------------------------------------

describe('Anton.pinBlock / unpinBlock', () => {
  it('pins a block for the Test child then unpins it', async () => {
    // Resolve a real block from the catalogue
    const plan = await anton.getPlan({ project: 'c-mat-4' });
    const topic = plan.topics[0]!;
    const block = topic.blocks[0]!;

    // Pin for the Test child in the far-future week
    const pinResult = await anton.pinBlock({
      project: 'c-mat-4',
      topicIndex: 0,
      blockIndex: 0,
      weekStartAt: FAR_FUTURE_WEEK,
      childName: CHILD_NAME,
    });
    expect(pinResult.pinned).toBe(true);
    expect(pinResult.blockPuid).toBe(block.puid);
    expect(pinResult.weekStartAt).toBe(FAR_FUTURE_WEEK);

    // Verify it appears in the group assignments
    const children = anton.listChildren();
    const testChild = children.find((c) => c.displayName?.toLowerCase() === CHILD_NAME.toLowerCase())!;
    const assignments = await anton.getGroupAssignments({
      week: FAR_FUTURE_WEEK,
      childPublicId: testChild.publicId,
    });
    const ourPin = assignments.find(
      (a) => a.puid === block.puid && a.weekStartAt === FAR_FUTURE_WEEK,
    );
    expect(ourPin).toBeDefined();

    // Unpin and verify it is gone
    await anton.unpinBlock({ blockPuid: block.puid, weekStartAt: FAR_FUTURE_WEEK });
    const after = await anton.getGroupAssignments({
      week: FAR_FUTURE_WEEK,
      childPublicId: testChild.publicId,
    });
    expect(after.find((a) => a.puid === block.puid && a.weekStartAt === FAR_FUTURE_WEEK)).toBeUndefined();
  }, 45_000);

  it('pins using topicTitle and blockTitle then unpins', async () => {
    const topics = await anton.listTopics({ project: 'c-mat-4' });
    const firstTopicTitle = topics.topics[0]!.title;
    const blocks = await anton.getTopicBlocks({ project: 'c-mat-4', topicIndex: 0 });
    const firstBlockTitle = blocks.blocks[0]!.title;

    const pinResult = await anton.pinBlock({
      project: 'c-mat-4',
      topicTitle: firstTopicTitle.slice(0, 8),
      blockTitle: firstBlockTitle.slice(0, 8),
      weekStartAt: FAR_FUTURE_WEEK_TITLE,
      childName: CHILD_NAME,
    });
    expect(pinResult.pinned).toBe(true);
    expect(pinResult.blockPuid).toBe(blocks.blocks[0]!.puid);

    await anton.unpinBlock({ blockPuid: pinResult.blockPuid, weekStartAt: FAR_FUTURE_WEEK_TITLE });
  }, 45_000);

  it('defaults weekStartAt to the current Monday when omitted', async () => {
    const now = new Date();
    const day = now.getDay();
    const diff = day === 0 ? -6 : 1 - day;
    now.setDate(now.getDate() + diff);
    const expectedMonday = now.toISOString().slice(0, 10);

    const children = anton.listChildren();
    const testChild = children.find((c) => c.displayName?.toLowerCase() === CHILD_NAME.toLowerCase())!;

    const pinResult = await anton.pinBlock({
      project: 'c-mat-4',
      topicIndex: 0,
      blockIndex: 0,
      childName: CHILD_NAME,
    });
    expect(pinResult.weekStartAt).toBe(expectedMonday);

    await anton.unpinBlock({
      blockPuid: pinResult.blockPuid,
      weekStartAt: pinResult.weekStartAt,
      childPublicId: testChild.publicId,
    });
  }, 45_000);

  it('pins group-wide without a child (childPublicId is null)', async () => {
    const pinResult = await anton.pinBlock({
      project: 'c-mat-4',
      topicIndex: 0,
      blockIndex: 0,
      weekStartAt: FAR_FUTURE_WEEK_GROUP,
    });
    expect(pinResult.pinned).toBe(true);
    expect(pinResult.childPublicId).toBeNull();

    await anton.unpinBlock({ blockPuid: pinResult.blockPuid, weekStartAt: FAR_FUTURE_WEEK_GROUP });
  }, 45_000);
});

// ---------------------------------------------------------------------------
// getEvents
// ---------------------------------------------------------------------------

describe('Anton.getEvents', () => {
  it('returns an array of raw events for the Test child', async () => {
    const events = await anton.getEvents({ childName: CHILD_NAME, limit: 10 });
    expect(Array.isArray(events)).toBe(true);
    expect(events.length).toBeLessThanOrEqual(10);
  });

  it('can filter by event type', async () => {
    const events = await anton.getEvents({ childName: CHILD_NAME, eventType: 'finishLevel', limit: 5 });
    for (const e of events) {
      expect((e as { event: string }).event).toBe('finishLevel');
    }
  });

  it('returns empty array when since is in the far future', async () => {
    const events = await anton.getEvents({ childName: CHILD_NAME, since: '2099-01-01' });
    expect(events).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// getLevelProgress
// ---------------------------------------------------------------------------

describe('Anton.getLevelProgress', () => {
  it('returns level progress data for the Test child', async () => {
    // Get a block puid from the catalogue to use as levelPuid
    const topicResult = await anton.getTopicBlocks({ project: 'c-mat-4', topicIndex: 0 });
    const blockPuid = topicResult.blocks[0]!.puid;

    const result = await anton.getLevelProgress({ levelPuid: blockPuid, childName: CHILD_NAME });
    // The API returns an object or array — just verify it is defined and not an error
    expect(result).toBeDefined();
  }, 30_000);
});

// ---------------------------------------------------------------------------
// getLesson
// ---------------------------------------------------------------------------

describe('Anton.getLesson', () => {
  let baseFileId: string;

  beforeAll(async () => {
    const topicResult = await anton.getTopicBlocks({ project: 'c-mat-4', topicIndex: 0 });
    const level = topicResult.blocks[0]!.levels.find((lv) => (lv as { fileId?: string }).fileId);
    baseFileId = (level as { fileId: string }).fileId; // e.g. "level/c-mat-4/..."
  }, 30_000);

  it('returns lesson content for a known level fileId', async () => {
    const lesson = await anton.getLesson({ fileId: baseFileId });
    expect(lesson).toBeDefined();
  }, 30_000);

  it('accepts fileId without the level/ prefix', async () => {
    const noPrefix = baseFileId.replace(/^level\//, ''); // "c-mat-4/..."
    const lesson = await anton.getLesson({ fileId: noPrefix });
    expect(lesson).toBeDefined();
  }, 30_000);

  it('accepts fileId with the /../ prefix from plan data', async () => {
    const dirtyPath = '/..' + baseFileId.slice('level'.length); // "/../c-mat-4/..."
    const lesson = await anton.getLesson({ fileId: dirtyPath });
    expect(lesson).toBeDefined();
  }, 30_000);
});

// ---------------------------------------------------------------------------
// checkAssignmentCompletion
// ---------------------------------------------------------------------------

describe('Anton.checkAssignmentCompletion', () => {
  it('returns a completion report for the Test child', async () => {
    const result = await anton.checkAssignmentCompletion({ childName: CHILD_NAME });
    expect((result as { childName: string }).childName).toBe(CHILD_NAME);
    expect(Array.isArray((result as { assignments: unknown[] }).assignments)).toBe(true);
  }, 30_000);

  it('filtered to a far-future week returns empty assignments', async () => {
    const result = await anton.checkAssignmentCompletion({ childName: CHILD_NAME, week: '2099-01-01' });
    expect((result as { assignments: unknown[] }).assignments).toHaveLength(0);
  }, 30_000);
});

// ---------------------------------------------------------------------------
// getSubjectSummary
// ---------------------------------------------------------------------------

describe('Anton.getSubjectSummary', () => {
  it('returns per-subject stats for the Test child', async () => {
    const result = await anton.getSubjectSummary({ childName: CHILD_NAME });
    expect((result as { childName: string }).childName).toBe(CHILD_NAME);
    expect(Array.isArray((result as { subjects: unknown[] }).subjects)).toBe(true);
  }, 30_000);

  it('can filter by subject prefix', async () => {
    const result = await anton.getSubjectSummary({ childName: CHILD_NAME, subject: 'mat' });
    expect((result as { subjects: Array<{ subject: string }> }).subjects.every(
      (s) => s.subject.toLowerCase().includes('mat'),
    )).toBe(true);
  }, 30_000);
});

// ---------------------------------------------------------------------------
// getActivityTimeline
// ---------------------------------------------------------------------------

describe('Anton.getActivityTimeline', () => {
  it('returns an activity timeline for the Test child', async () => {
    const result = await anton.getActivityTimeline({ childName: CHILD_NAME, since: '2025-01-01' });
    expect((result as { childName: string }).childName).toBe(CHILD_NAME);
    expect(typeof (result as { activeDays: number }).activeDays).toBe('number');
    expect(Array.isArray((result as { dailyActivity: unknown[] }).dailyActivity)).toBe(true);
  }, 30_000);

  it('returns 0 active days when since is in the far future', async () => {
    const result = await anton.getActivityTimeline({ childName: CHILD_NAME, since: '2099-01-01' });
    expect((result as { activeDays: number }).activeDays).toBe(0);
    expect((result as { dailyActivity: unknown[] }).dailyActivity).toHaveLength(0);
  }, 30_000);
});

// ---------------------------------------------------------------------------
// compareChildren
// ---------------------------------------------------------------------------

describe('Anton.compareChildren', () => {
  it('returns a comparison across all children', async () => {
    const result = await anton.compareChildren();
    expect(Array.isArray((result as { children: unknown[] }).children)).toBe(true);
    expect((result as { children: unknown[] }).children.length).toBeGreaterThan(0);
    const first = (result as { children: Array<{ childName: string; totalStars: number }> }).children[0]!;
    expect(first.childName).toBeTruthy();
    expect(typeof first.totalStars).toBe('number');
  }, 30_000);
});

// ---------------------------------------------------------------------------
// Error paths
// ---------------------------------------------------------------------------

describe('Error paths', () => {
  it('resolveChild throws for an unknown child name', async () => {
    await expect(anton.getProgress({ childName: 'NoSuchChildXYZ' })).rejects.toThrow(/not found/i);
  });

  it('getTopicBlocks throws for an out-of-range topicIndex', async () => {
    await expect(
      anton.getTopicBlocks({ project: 'c-mat-4', topicIndex: 9999 }),
    ).rejects.toThrow(/out of range/i);
  });

  it('pinBlock throws when neither project nor blockPuid is provided', async () => {
    await expect(anton.pinBlock({ weekStartAt: FAR_FUTURE_WEEK })).rejects.toThrow();
  });

  it('unpinBlock throws when no matching pin exists', async () => {
    await expect(
      anton.unpinBlock({ blockPuid: 'nonexistent/puid', weekStartAt: '2099-01-01' }),
    ).rejects.toThrow(/no pin found/i);
  }, 15_000);

  it('getLevelProgress throws when neither childName nor childPublicId is provided', async () => {
    await expect(
      anton.getLevelProgress({ levelPuid: 'c-mat-4/xxxxx' }),
    ).rejects.toThrow(/provide childName or childPublicId/i);
  });
});

// ---------------------------------------------------------------------------
// Local assignments CRUD (no network)
// ---------------------------------------------------------------------------

describe('Anton local assignments', () => {
  let id: string;

  it('starts with an empty list', () => {
    expect(anton.listAssignments()).toHaveLength(0);
  });

  it('assignLesson creates a pending entry', () => {
    const a = anton.assignLesson({
      childName: CHILD_NAME,
      fileId: 'c-mat-4/topic-01/block-01/level-01',
      lessonTitle: 'SDK Test Level',
    });
    expect(a.id).toBeTruthy();
    expect(a.status).toBe('pending');
    id = a.id;
  });

  it('listAssignments returns the new entry', () => {
    const list = anton.listAssignments({ childName: CHILD_NAME });
    expect(list).toHaveLength(1);
    expect(list[0]!.id).toBe(id);
  });

  it('updateAssignment changes status', () => {
    const updated = anton.updateAssignment(id, { status: 'completed' });
    expect(updated.status).toBe('completed');
    expect(updated.completedAt).toBeTruthy();
  });

  it('deleteAssignment removes the entry', () => {
    anton.deleteAssignment(id);
    expect(anton.listAssignments()).toHaveLength(0);
  });

  it('updateAssignment throws for an unknown id', () => {
    expect(() =>
      anton.updateAssignment('00000000-0000-0000-0000-000000000000', { status: 'completed' }),
    ).toThrow(/not found/i);
  });
});
