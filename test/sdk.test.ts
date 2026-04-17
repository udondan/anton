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

  anton = new Anton({ loginCode });
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

  it('includes the Test child with logId and publicId', () => {
    const children = anton.listChildren();
    const test = children.find((c) => c.displayName?.toLowerCase() === CHILD_NAME.toLowerCase());
    expect(test).toBeDefined();
    expect(test!.logId).toBeTruthy();
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
  it('returns lesson content for a known level fileId', async () => {
    const topicResult = await anton.getTopicBlocks({ project: 'c-mat-4', topicIndex: 0 });
    const level = topicResult.blocks[0]!.levels.find((lv) => (lv as { fileId?: string }).fileId);
    expect(level).toBeDefined();
    const fileId = (level as { fileId: string }).fileId;

    const lesson = await anton.getLesson({ fileId });
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
});
