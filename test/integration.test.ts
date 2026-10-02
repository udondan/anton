/**
 * Integration tests – hit the live anton.app API.
 *
 * Prerequisites:
 *   ANTON_LOGIN_CODE=<parent 8-char code>   (required)
 *
 * Child-specific tests exclusively use the child named "Test".
 *
 * Run:
 *   npm test
 *   ANTON_LOGIN_CODE=YOUR-CODE npm test
 */

import { existsSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import {
  extractGroupCodes,
  getGroupEvents,
  getGroupMemberDescriptions,
  getLevelReviewReport,
  getLessonContent,
  getPlan,
  getPlansCatalogue,
  getUserEvents,
  loginWithCode,
  parseGroupInfo,
  parsePinnedBlocks,
  pinGroupBlock,
  summariseProgress,
  unpinGroupBlock,
} from '../src/client.js';
import {
  checkAssignmentCompletion,
  compareChildren,
  getActivityTimeline,
  getSubjectSummary,
  getWeeklySummary,
} from '../src/analysis.js';
import {
  createAssignment,
  deleteAssignment,
  listAssignments,
  updateAssignment,
} from '../src/assignments.js';
import type { FinishLevelEvent, GroupInfo, Session } from '../src/types.js';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const CHILD_NAME = 'Test';

// Use a temp file so integration tests never touch the real assignments store
const TEMP_ASSIGNMENTS = join(tmpdir(), `anton-test-assignments-${process.pid}.json`);

// ---------------------------------------------------------------------------
// Shared fixtures – populated once in beforeAll
// ---------------------------------------------------------------------------

let parentSession: Session;
let groupInfo: GroupInfo;
let testChildLogId: string;
let testChildPublicId: string;
let testFinishEvents: FinishLevelEvent[];
let familyGroupInfo: GroupInfo | undefined;
let familyChildLogId: string | undefined;
let _familyChildPublicId: string | undefined;

// ---------------------------------------------------------------------------
// Setup / teardown
// ---------------------------------------------------------------------------

beforeAll(async () => {
  const code = process.env['ANTON_LOGIN_CODE'];
  if (!code) {
    throw new Error(
      'ANTON_LOGIN_CODE is not set – cannot run integration tests.\n' +
        'Export it before running: ANTON_LOGIN_CODE=YOUR-CODE npm test',
    );
  }

  // Redirect local assignment store to a temp file for the duration of tests
  process.env['ANTON_ASSIGNMENTS_FILE'] = TEMP_ASSIGNMENTS;

  // ── Authenticate parent ──────────────────────────────────────────────────
  parentSession = await loginWithCode(code);

  // ── Discover family group ────────────────────────────────────────────────
  // Retry up to 3 times: getUserEvents can temporarily return empty right after
  // login (API eventual consistency), especially when running the full test suite.
  let groupCodes: string[] = [];
  for (const delay of [0, 2_000, 5_000]) {
    if (delay > 0) await new Promise((r) => setTimeout(r, delay));
    const userEvents = await getUserEvents(parentSession.logId);
    groupCodes = extractGroupCodes(userEvents);
    if (groupCodes.length > 0) break;
  }
  if (groupCodes.length === 0) throw new Error('No family group found for the parent account');

  // Fetch and enrich all groups in parallel, then pick the target group.
  // The target is selected by ANTON_GROUP (case-insensitive) or falls back to
  // the first group. The Test child's logId is searched across all groups
  // because some groups may not expose it via getGroupMemberDescriptions.
  const allGroupInfos = await Promise.all(
    groupCodes.map(async (code) => {
      const events = await getGroupEvents(code);
      const info = parseGroupInfo(code, events);
      try {
        const descriptions = await getGroupMemberDescriptions(
          code,
          parentSession.logId,
          parentSession.authToken,
        );
        const byPublicId = new Map(descriptions.map((d) => [d.publicId, d]));
        for (const member of info.members) {
          const desc = byPublicId.get(member.publicId);
          if (desc) {
            member.displayName = desc.displayName;
            member.logId = desc.logId;
          }
        }
      } catch {
        // Member descriptions unavailable for this group; continue without them.
      }
      return info;
    }),
  );

  const targetGroupName = process.env['ANTON_GROUP'];
  groupInfo =
    (targetGroupName
      ? allGroupInfos.find((g) => g.groupName.toLowerCase() === targetGroupName.toLowerCase())
      : undefined) ?? allGroupInfos[0]!;

  // ── Capture family group for family-path tests ───────────────────────────
  familyGroupInfo = allGroupInfos.find((g) => g.groupType === 'family');
  if (familyGroupInfo) {
    const familyChild = familyGroupInfo.members.find((m) => m.role === 'pupil' && m.logId);
    if (familyChild) {
      familyChildLogId = familyChild.logId;
      _familyChildPublicId = familyChild.publicId;
    }
  }

  // ── Resolve "Test" child ─────────────────────────────────────────────────
  // Search all groups — the logId may only be available in a group where the
  // child account is fully set up (e.g. the family group).
  let testMember: (typeof allGroupInfos)[0]['members'][0] | undefined;
  for (const info of allGroupInfos) {
    testMember = info.members.find(
      (m) =>
        m.role === 'pupil' && m.displayName?.toLowerCase() === CHILD_NAME.toLowerCase() && m.logId,
    );
    if (testMember) break;
  }
  if (!testMember?.logId) {
    throw new Error(
      `Child "${CHILD_NAME}" not found with a logId in any group. ` +
        'Make sure a pupil named "Test" exists in the group.',
    );
  }
  testChildLogId = testMember.logId;
  testChildPublicId = testMember.publicId;

  // Pre-fetch events once and share them across all child-specific tests
  const childEvents = await getUserEvents(testChildLogId);
  testFinishEvents = childEvents.filter((e): e is FinishLevelEvent => e.event === 'finishLevel');
}, 60_000);

afterAll(() => {
  if (existsSync(TEMP_ASSIGNMENTS)) {
    rmSync(TEMP_ASSIGNMENTS);
  }
});

// ---------------------------------------------------------------------------
// Helper: find the next Monday on or after a given UTC date string
// ---------------------------------------------------------------------------
function nextMonday(fromDate: string): string {
  const d = new Date(fromDate + 'T00:00:00Z');
  const dow = d.getUTCDay(); // 0=Sun, 1=Mon, …
  const skip = dow === 1 ? 0 : (8 - dow) % 7 || 7;
  d.setUTCDate(d.getUTCDate() + skip);
  return d.toISOString().slice(0, 10);
}

// A week so far in the future it will never collide with a real assignment
const FAR_FUTURE_WEEK = nextMonday('2099-01-01');

// ---------------------------------------------------------------------------
// 1. get_status  ──────────────────────────────────────────────────────────
// ---------------------------------------------------------------------------

describe('get_status', () => {
  it('parent session has logId and authToken', () => {
    expect(parentSession.logId).toBeTruthy();
    expect(parentSession.authToken).toBeTruthy();
    expect(parentSession.displayName).toBeTruthy();
  });

  it('family group is loaded', () => {
    expect(groupInfo.groupCode).toBeTruthy();
    expect(groupInfo.groupName).toBeTruthy();
    expect(groupInfo.members.length).toBeGreaterThan(0);
  });

  it('Test child is among the pupils', () => {
    const pupils = groupInfo.members.filter((m) => m.role === 'pupil');
    const test = pupils.find((m) => m.displayName?.toLowerCase() === CHILD_NAME.toLowerCase());
    expect(test).toBeDefined();
    expect(test!.publicId).toBeTruthy();
  });
});

// ---------------------------------------------------------------------------
// 2. get_group  ───────────────────────────────────────────────────────────
// ---------------------------------------------------------------------------

describe('get_group', () => {
  it('returns fresh group info with members', async () => {
    const events = await getGroupEvents(groupInfo.groupCode);
    const fresh = parseGroupInfo(groupInfo.groupCode, events);
    expect(fresh.groupCode).toBe(groupInfo.groupCode);
    expect(fresh.members.length).toBeGreaterThan(0);
  });

  it('parses pinned blocks without throwing', async () => {
    const events = await getGroupEvents(groupInfo.groupCode);
    const pins = parsePinnedBlocks(events);
    expect(Array.isArray(pins)).toBe(true);
    for (const p of pins) {
      expect(p.puid).toBeTruthy();
      expect(p.weekStartAt).toMatch(/^\d{4}-\d{2}-\d{2}$/);
      expect(p.created).toBeTruthy();
    }
  });
});

// ---------------------------------------------------------------------------
// 3. get_group_assignments  ───────────────────────────────────────────────
// ---------------------------------------------------------------------------

describe('get_group_assignments', () => {
  it('returns an array of pinned blocks', async () => {
    const events = await getGroupEvents(groupInfo.groupCode);
    const blocks = parsePinnedBlocks(events);
    expect(Array.isArray(blocks)).toBe(true);
  });

  it('can filter by child publicId', async () => {
    const events = await getGroupEvents(groupInfo.groupCode);
    const all = parsePinnedBlocks(events);
    const filtered = all.filter((b) => b.subgroup === testChildPublicId || b.subgroup == null);
    expect(filtered.length).toBeLessThanOrEqual(all.length);
  });

  it('can filter by week', async () => {
    const events = await getGroupEvents(groupInfo.groupCode);
    const all = parsePinnedBlocks(events);
    const week = '2025-01-06';
    const filtered = all.filter((b) => b.weekStartAt === week);
    expect(filtered.length).toBeLessThanOrEqual(all.length);
  });
});

// ---------------------------------------------------------------------------
// 4 & 5. pin_block + unpin_block  ────────────────────────────────────────
// ---------------------------------------------------------------------------

describe('pin_block and unpin_block', () => {
  it('pins a block for the Test child then unpins it', async () => {
    // Resolve a real block from the plan catalogue
    const plan = await getPlan('c-mat-4');
    const topic = plan.topics[0]!;
    const block = topic.blocks[0]!;
    const blockPuid = block.puid;
    // Construct the block path the same way the server handler does
    const topicSlug = topic.puid.split('/')[1]!;
    const blockSlug = block.puid.split('/')[1]!;
    const blockPath = `/../c-mat-4/${topicSlug}/${blockSlug}/block`;

    // Pin for Test child in a far-future week
    await pinGroupBlock(
      groupInfo.groupCode,
      blockPuid,
      blockPath,
      FAR_FUTURE_WEEK,
      parentSession.logId,
      parentSession.authToken,
      testChildPublicId,
    );

    // Verify the pin appears in the group log
    const eventsAfterPin = await getGroupEvents(groupInfo.groupCode);
    const pinsAfterPin = parsePinnedBlocks(eventsAfterPin);
    const ourPin = pinsAfterPin.find(
      (p) =>
        p.puid === blockPuid &&
        p.weekStartAt === FAR_FUTURE_WEEK &&
        p.subgroup === testChildPublicId,
    );
    expect(ourPin).toBeDefined();

    // Unpin using the created timestamp
    await unpinGroupBlock(
      groupInfo.groupCode,
      ourPin!.created,
      parentSession.logId,
      parentSession.authToken,
    );

    // Verify the pin is gone
    const eventsAfterUnpin = await getGroupEvents(groupInfo.groupCode);
    const pinsAfterUnpin = parsePinnedBlocks(eventsAfterUnpin);
    const stillThere = pinsAfterUnpin.find(
      (p) =>
        p.puid === blockPuid &&
        p.weekStartAt === FAR_FUTURE_WEEK &&
        p.subgroup === testChildPublicId,
    );
    expect(stillThere).toBeUndefined();
  }, 30_000);
});

// ---------------------------------------------------------------------------
// 6. get_progress  ───────────────────────────────────────────────────────
// ---------------------------------------------------------------------------

describe('get_progress', () => {
  it('returns a progress summary for the Test child', async () => {
    const events = await getUserEvents(testChildLogId);
    const summary = summariseProgress(testChildLogId, events);
    expect(summary.logId).toBe(testChildLogId);
    expect(typeof summary.totalEvents).toBe('number');
    expect(Array.isArray(summary.completedLevels)).toBe(true);
    expect(typeof summary.distinctBlocksCompleted).toBe('number');
    expect(typeof summary.starsByProject).toBe('object');
  });
});

// ---------------------------------------------------------------------------
// 7. get_events  ─────────────────────────────────────────────────────────
// ---------------------------------------------------------------------------

describe('get_events', () => {
  it('returns an event array for the Test child', async () => {
    const events = await getUserEvents(testChildLogId);
    expect(Array.isArray(events)).toBe(true);
  });

  it('each event has an event name and created timestamp', async () => {
    const events = await getUserEvents(testChildLogId);
    for (const evt of events.slice(0, 20)) {
      expect(evt.event).toBeTruthy();
      expect(evt.created).toMatch(/^\d{4}-\d{2}-\d{2}/);
    }
  });

  it('can filter by event type (finishLevel)', async () => {
    const events = await getUserEvents(testChildLogId);
    const finish = events.filter((e) => e.event === 'finishLevel');
    expect(Array.isArray(finish)).toBe(true);
    // finishLevel events must have a puid field
    for (const f of finish) {
      expect((f as FinishLevelEvent).puid).toBeTruthy();
    }
  });

  it('can limit results', async () => {
    const events = await getUserEvents(testChildLogId);
    const limited = events.slice(0, 5);
    expect(limited.length).toBeLessThanOrEqual(5);
  });
});

// ---------------------------------------------------------------------------
// 8. get_level_progress  ─────────────────────────────────────────────────
// ---------------------------------------------------------------------------

describe('get_level_progress', () => {
  it('returns a review report for the Test child on a known level', async () => {
    const plan = await getPlan('c-mat-4');
    const levelPuid = plan.topics[0]!.blocks[0]!.levels[0]!.puid;

    const report = await getLevelReviewReport(
      levelPuid,
      testChildPublicId,
      parentSession.logId,
      parentSession.authToken,
    );

    expect(report).toBeDefined();
    // status can be 'ok' or 'noData' – both are valid API responses
    expect(typeof report.status).toBe('string');
  });
});

// ---------------------------------------------------------------------------
// 9. list_children  ──────────────────────────────────────────────────────
// ---------------------------------------------------------------------------

describe('list_children', () => {
  it('returns at least one pupil', () => {
    const pupils = groupInfo.members.filter((m) => m.role === 'pupil');
    expect(pupils.length).toBeGreaterThan(0);
  });

  it('Test child is in the list with publicId', () => {
    const pupils = groupInfo.members.filter((m) => m.role === 'pupil');
    const test = pupils.find((m) => m.displayName?.toLowerCase() === CHILD_NAME.toLowerCase());
    expect(test?.publicId).toBeTruthy();
  });
});

// ---------------------------------------------------------------------------
// 10. list_plans  ────────────────────────────────────────────────────────
// ---------------------------------------------------------------------------

describe('list_plans', () => {
  it('returns more than 100 plans', async () => {
    const plans = await getPlansCatalogue();
    expect(plans.length).toBeGreaterThan(100);
  });

  it('each plan has a project and title', async () => {
    const plans = await getPlansCatalogue();
    const sample = plans.slice(0, 10);
    for (const p of sample) {
      expect(p.project).toBeTruthy();
      expect(p.title).toBeTruthy();
      expect(Array.isArray(p.grades)).toBe(true);
    }
  });

  it('can find math plans by project prefix', async () => {
    const plans = await getPlansCatalogue();
    const mat = plans.filter((p) => p.project.startsWith('c-mat-'));
    expect(mat.length).toBeGreaterThan(0);
  });

  it('can find grade-4 plans', async () => {
    const plans = await getPlansCatalogue();
    const grade4 = plans.filter((p) => (p.grades ?? []).includes(4));
    expect(grade4.length).toBeGreaterThan(0);
  });
});

// ---------------------------------------------------------------------------
// 11. list_topics  ───────────────────────────────────────────────────────
// ---------------------------------------------------------------------------

describe('list_topics', () => {
  it('returns topics for c-mat-4', async () => {
    const plan = await getPlan('c-mat-4');
    const topics = plan.topics ?? [];
    expect(topics.length).toBeGreaterThan(0);
    for (const [i, t] of topics.entries()) {
      expect(t.title).toBeTruthy();
      expect(t.puid).toBeTruthy();
      expect(typeof i).toBe('number');
    }
  });

  it('topics have at least one block each', async () => {
    const plan = await getPlan('c-mat-4');
    for (const topic of plan.topics ?? []) {
      expect((topic.blocks ?? []).length).toBeGreaterThan(0);
    }
  });
});

// ---------------------------------------------------------------------------
// 12. get_topic_blocks  ──────────────────────────────────────────────────
// ---------------------------------------------------------------------------

describe('get_topic_blocks', () => {
  it('returns blocks for the first topic of c-mat-4 by index', async () => {
    const plan = await getPlan('c-mat-4');
    const topic = plan.topics[0]!;
    expect(topic.blocks.length).toBeGreaterThan(0);
    const block = topic.blocks[0]!;
    expect(block.puid).toBeTruthy();
    expect(block.title).toBeTruthy();
    expect(block.levels.length).toBeGreaterThan(0);
  });

  it('can find a topic by partial title match', async () => {
    const plan = await getPlan('c-mat-4');
    // Most German math plans have a "Zahl" (number) or "Rechnen" topic
    const topic = plan.topics.find(
      (t) =>
        t.title.toLowerCase().includes('zahl') ||
        t.title.toLowerCase().includes('rechnen') ||
        t.title.toLowerCase().includes('bruch') ||
        t.title.toLowerCase().includes('addition'),
    );
    expect(topic).toBeDefined();
    expect(topic!.blocks.length).toBeGreaterThan(0);
  });
});

// ---------------------------------------------------------------------------
// 13. get_plan  ──────────────────────────────────────────────────────────
// ---------------------------------------------------------------------------

describe('get_plan', () => {
  it('returns full hierarchy for c-mat-4', async () => {
    const plan = await getPlan('c-mat-4');
    expect(plan.project).toBe('c-mat-4');
    expect(plan.topics.length).toBeGreaterThan(0);
    expect(plan.totalBlocks).toBeGreaterThan(0);
    expect(plan.totalLevels).toBeGreaterThan(0);
  });

  it('each block has levels', async () => {
    const plan = await getPlan('c-mat-4');
    const blocks = plan.topics.flatMap((t) => t.blocks);
    expect(blocks.length).toBeGreaterThan(0);
    for (const b of blocks.slice(0, 5)) {
      expect(b.levels.length).toBeGreaterThan(0);
    }
  });
});

// ---------------------------------------------------------------------------
// 14. get_lesson  ────────────────────────────────────────────────────────
// ---------------------------------------------------------------------------

describe('get_lesson', () => {
  it('returns lesson content for a level resolved from the plan', async () => {
    const plan = await getPlan('c-mat-4');

    // Find the first level that has a path property (used to build the fileId)
    let fileId: string | undefined;
    outer: for (const topic of plan.topics) {
      for (const block of topic.blocks) {
        for (const level of block.levels) {
          const lv = level as Record<string, unknown>;
          if (typeof lv['path'] === 'string') {
            // path is like "/../c-mat-4/topic-01-.../block-01-.../level-01"
            fileId = `level${lv['path'].replace('/..', '')}`;
            break outer;
          }
        }
      }
    }

    if (!fileId) {
      // Fallback: construct from puids (may not always work with the API)
      const topic = plan.topics[0]!;
      const block = topic.blocks[0]!;
      const level = block.levels[0]!;
      fileId = `level/${plan.project}/${topic.puid.split('/')[1]}/${block.puid.split('/')[1]}/${level.puid.split('/')[1]}`;
    }

    const content = await getLessonContent(fileId);
    expect(content.title).toBeTruthy();
    expect(Array.isArray(content.trainers)).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// 15. check_assignment_completion  ───────────────────────────────────────
// ---------------------------------------------------------------------------

describe('check_assignment_completion', () => {
  it('returns completion status for the Test child across all weeks', async () => {
    const groupEvents = await getGroupEvents(groupInfo.groupCode);
    const pinnedBlocks = parsePinnedBlocks(groupEvents);

    // Load plans for all projects that appear in pinned blocks
    const projects = Array.from(new Set(pinnedBlocks.map((b) => b.puid.split('/')[0]!)));
    const plans = await Promise.all(projects.map((p) => getPlan(p)));
    const planCache = new Map(projects.map((p, i) => [p, plans[i]!]));

    const result = checkAssignmentCompletion(
      CHILD_NAME,
      pinnedBlocks,
      planCache,
      testFinishEvents,
      undefined,
      testChildPublicId,
    );

    expect(result.childName).toBe(CHILD_NAME);
    expect(typeof result.summary.totalAssignments).toBe('number');
    expect(typeof result.summary.fullyCompleted).toBe('number');
    expect(typeof result.summary.partiallyCompleted).toBe('number');
    expect(typeof result.summary.notStarted).toBe('number');
    expect(Array.isArray(result.assignments)).toBe(true);

    for (const a of result.assignments) {
      expect(a.blockPuid).toBeTruthy();
      expect(a.weekStartAt).toMatch(/^\d{4}-\d{2}-\d{2}$/);
      expect(typeof a.completionRate).toBe('number');
      expect(a.completionRate).toBeGreaterThanOrEqual(0);
      expect(a.completionRate).toBeLessThanOrEqual(1);
    }
  }, 45_000);
});

// ---------------------------------------------------------------------------
// 16. get_weekly_summary  ────────────────────────────────────────────────
// ---------------------------------------------------------------------------

describe('get_weekly_summary', () => {
  it('returns a valid weekly summary for the Test child', async () => {
    const weekStartAt = '2025-01-06'; // A known Monday
    const groupEvents = await getGroupEvents(groupInfo.groupCode);
    const assignedPuids = new Set(
      parsePinnedBlocks(groupEvents)
        .filter(
          (b) =>
            b.weekStartAt === weekStartAt &&
            (b.subgroup == null || b.subgroup === testChildPublicId),
        )
        .map((b) => b.puid),
    );

    const summary = getWeeklySummary(CHILD_NAME, weekStartAt, testFinishEvents, assignedPuids);

    expect(summary.childName).toBe(CHILD_NAME);
    expect(summary.weekStartAt).toBe(weekStartAt);
    expect(summary.weekEndAt).toBe('2025-01-12');
    expect(typeof summary.levelsCompleted).toBe('number');
    expect(typeof summary.totalDurationSeconds).toBe('number');
    expect(typeof summary.starsEarned).toBe('number');
    expect(typeof summary.averageAccuracy).toBe('number');
    expect(summary.averageAccuracy).toBeGreaterThanOrEqual(0);
    expect(summary.averageAccuracy).toBeLessThanOrEqual(1);
    expect(Array.isArray(summary.subjectsCovered)).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// 17. get_subject_summary  ───────────────────────────────────────────────
// ---------------------------------------------------------------------------

describe('get_subject_summary', () => {
  it('returns subject summary for the Test child', () => {
    const result = getSubjectSummary(CHILD_NAME, testFinishEvents);
    expect(result.childName).toBe(CHILD_NAME);
    expect(Array.isArray(result.subjects)).toBe(true);
  });

  it('each subject entry has required fields', () => {
    const result = getSubjectSummary(CHILD_NAME, testFinishEvents);
    for (const s of result.subjects) {
      expect(s.subject).toBeTruthy();
      expect(s.subjectName).toBeTruthy();
      expect(typeof s.totalLevelsCompleted).toBe('number');
      expect(typeof s.averageAccuracy).toBe('number');
      expect(['improving', 'declining', 'stable', 'insufficient_data']).toContain(s.trend);
    }
  });

  it('can filter by subject prefix', () => {
    const result = getSubjectSummary(CHILD_NAME, testFinishEvents, 'mat');
    for (const s of result.subjects) {
      expect(s.subject.toLowerCase()).toContain('mat');
    }
  });
});

// ---------------------------------------------------------------------------
// 18. get_activity_timeline  ─────────────────────────────────────────────
// ---------------------------------------------------------------------------

describe('get_activity_timeline', () => {
  it('returns a valid activity timeline for the Test child', () => {
    const timeline = getActivityTimeline(CHILD_NAME, testFinishEvents, '1970-01-01');
    expect(timeline.childName).toBe(CHILD_NAME);
    expect(typeof timeline.activeDays).toBe('number');
    expect(typeof timeline.totalDays).toBe('number');
    expect(typeof timeline.longestStreak).toBe('number');
    expect(typeof timeline.currentStreak).toBe('number');
    expect(typeof timeline.totalLevels).toBe('number');
    expect(Array.isArray(timeline.dailyActivity)).toBe(true);
    expect(Array.isArray(timeline.gaps)).toBe(true);
  });

  it('daily activity entries have date, levels, duration, and subjects', () => {
    const timeline = getActivityTimeline(CHILD_NAME, testFinishEvents, '1970-01-01');
    for (const day of timeline.dailyActivity) {
      expect(day.date).toMatch(/^\d{4}-\d{2}-\d{2}$/);
      expect(typeof day.levelsCompleted).toBe('number');
      expect(typeof day.durationSeconds).toBe('number');
      expect(Array.isArray(day.subjects)).toBe(true);
    }
  });

  it('respects the since filter', () => {
    const since = '2025-01-01';
    const timeline = getActivityTimeline(CHILD_NAME, testFinishEvents, since);
    for (const day of timeline.dailyActivity) {
      expect(day.date >= since).toBe(true);
    }
  });
});

// ---------------------------------------------------------------------------
// 19. compare_children  ──────────────────────────────────────────────────
// ---------------------------------------------------------------------------

describe('compare_children', () => {
  it('includes the Test child and returns a valid comparison', async () => {
    const pupils = groupInfo.members.filter((m) => m.role === 'pupil');
    const childRows = await Promise.all(
      pupils.map(async (m) => {
        if (!m.logId) {
          return { name: m.displayName ?? m.publicId, finishEvents: [] as FinishLevelEvent[] };
        }
        const events = await getUserEvents(m.logId);
        const finishEvents = events.filter((e): e is FinishLevelEvent => e.event === 'finishLevel');
        return { name: m.displayName ?? m.publicId, finishEvents };
      }),
    );

    const result = compareChildren(childRows);

    expect(result.children.length).toBe(pupils.length);
    expect(result.generatedAt).toBeTruthy();

    const testChild = result.children.find(
      (c) => c.childName.toLowerCase() === CHILD_NAME.toLowerCase(),
    );
    expect(testChild).toBeDefined();
    expect(typeof testChild!.totalStars).toBe('number');
    expect(typeof testChild!.averageAccuracy).toBe('number');
    expect(typeof testChild!.activeDays).toBe('number');
    expect(typeof testChild!.levelsCompleted).toBe('number');
    expect(Array.isArray(testChild!.subjects)).toBe(true);
  }, 45_000);
});

// ---------------------------------------------------------------------------
// 20. family group code path (getUserEvents / logId)
// Skipped automatically if the parent belongs to no family group.
// ---------------------------------------------------------------------------

describe('family group code path (getUserEvents / logId)', () => {
  it('family group is detected by groupType', () => {
    if (!familyGroupInfo) return;
    expect(familyGroupInfo.groupType).toBe('family');
    expect(familyGroupInfo.groupCode).toBeTruthy();
    expect(familyGroupInfo.members.length).toBeGreaterThan(0);
  });

  it('getUserEvents with logId returns events', async () => {
    if (!familyChildLogId) return;
    const events = await getUserEvents(familyChildLogId);
    expect(Array.isArray(events)).toBe(true);
    expect(events.length).toBeGreaterThan(0);
    for (const evt of events.slice(0, 5)) {
      expect(evt.event).toBeTruthy();
      expect(evt.created).toMatch(/^\d{4}-\d{2}-\d{2}/);
    }
  }, 30_000);

  it('summariseProgress via logId returns totalEvents > 0', async () => {
    if (!familyChildLogId) return;
    const events = await getUserEvents(familyChildLogId);
    const summary = summariseProgress(familyChildLogId, events);
    expect(summary.logId).toBe(familyChildLogId);
    expect(typeof summary.totalEvents).toBe('number');
    expect(summary.totalEvents).toBeGreaterThan(0);
    expect(Array.isArray(summary.completedLevels)).toBe(true);
  }, 30_000);

  it('compare_children uses logId path for family group members', async () => {
    if (!familyGroupInfo || !familyChildLogId) return;
    const pupils = familyGroupInfo.members.filter((m) => m.role === 'pupil');
    const childRows = await Promise.all(
      pupils.map(async (m) => {
        if (!m.logId)
          return { name: m.displayName ?? m.publicId, finishEvents: [] as FinishLevelEvent[] };
        const events = await getUserEvents(m.logId);
        return {
          name: m.displayName ?? m.publicId,
          finishEvents: events.filter((e): e is FinishLevelEvent => e.event === 'finishLevel'),
        };
      }),
    );
    const result = compareChildren(childRows);
    expect(result.children.length).toBe(pupils.length);
    const withData = result.children.find((c) => c.levelsCompleted > 0);
    expect(withData).toBeDefined();
  }, 45_000);
});

// ---------------------------------------------------------------------------
// 21–24. list_assignments / assign_lesson / update_assignment / delete_assignment
// ---------------------------------------------------------------------------

describe('local assignments CRUD', () => {
  let assignmentId: string;

  it('list_assignments returns an empty store initially', () => {
    const list = listAssignments();
    expect(Array.isArray(list)).toBe(true);
    expect(list.length).toBe(0);
  });

  it('assign_lesson creates a pending assignment for the Test child', () => {
    const a = createAssignment({
      childName: CHILD_NAME,
      fileId: 'c-mat-4/topic-01/block-01/level-01',
      lessonTitle: 'Integration Test Level',
      note: 'Created by integration test',
    });
    expect(a.id).toBeTruthy();
    expect(a.childName).toBe(CHILD_NAME);
    expect(a.status).toBe('pending');
    expect(a.assignedAt).toBeTruthy();
    assignmentId = a.id;

    // Verify the assignment was persisted by re-reading via list_assignments
    const persisted = listAssignments({ childName: CHILD_NAME });
    expect(persisted.length).toBe(1);
    expect(persisted[0]!.id).toBe(assignmentId);
    expect(persisted[0]!.status).toBe('pending');
    expect(persisted[0]!.fileId).toBe('c-mat-4/topic-01/block-01/level-01');
    expect(persisted[0]!.lessonTitle).toBe('Integration Test Level');
    expect(persisted[0]!.note).toBe('Created by integration test');
  });

  it('list_assignments returns the newly created assignment', () => {
    const list = listAssignments({ childName: CHILD_NAME });
    expect(list.length).toBe(1);
    expect(list[0]!.id).toBe(assignmentId);
  });

  it('list_assignments filters by status (pending)', () => {
    const pending = listAssignments({ status: 'pending' });
    expect(pending.length).toBe(1);
    const completed = listAssignments({ status: 'completed' });
    expect(completed.length).toBe(0);
  });

  it('update_assignment changes status to completed and sets completedAt', () => {
    updateAssignment(assignmentId, { status: 'completed' });

    // Verify the status change was persisted by re-reading via list_assignments
    const after = listAssignments({ childName: CHILD_NAME });
    expect(after.length).toBe(1);
    expect(after[0]!.status).toBe('completed');
    expect(after[0]!.completedAt).toBeTruthy();
  });

  it('update_assignment can update the note', () => {
    updateAssignment(assignmentId, { note: 'Updated by test' });

    // Verify the note change was persisted by re-reading via list_assignments
    const after = listAssignments({ childName: CHILD_NAME });
    expect(after.length).toBe(1);
    expect(after[0]!.note).toBe('Updated by test');
  });

  it('delete_assignment removes the assignment', () => {
    deleteAssignment(assignmentId);
    const list = listAssignments();
    expect(list.find((a) => a.id === assignmentId)).toBeUndefined();
  });

  it('delete_assignment throws for a non-existent id', () => {
    expect(() => deleteAssignment('00000000-0000-0000-0000-000000000000')).toThrow(
      'Assignment not found',
    );
  });
});
