/**
 * Unit tests for the pure analysis functions — no network access.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  checkAssignmentCompletion,
  compareChildren,
  getActivityTimeline,
  getSubjectSummary,
  getWeeklySummary,
} from '../../src/analysis.js';
import type { FinishLevelEvent, PinnedBlock, Plan } from '../../src/types.js';

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

function finish(overrides: Partial<FinishLevelEvent> = {}): FinishLevelEvent {
  return {
    event: 'finishLevel',
    puid: 'c-mat-4/lv1',
    type: 'normal',
    atoms: 0,
    level: '',
    round: 0,
    score: 3,
    total: 10,
    corrects: 10,
    duration: 60,
    mistakes: 0,
    blockPuid: 'c-mat-4/b1',
    blockTitle: 'Block 1',
    levelTitle: 'Level 1',
    created: '2099-01-05T10:00:00.000Z',
    ...overrides,
  } as FinishLevelEvent;
}

function pin(overrides: Partial<PinnedBlock> = {}): PinnedBlock {
  return {
    puid: 'c-mat-4/b1',
    block: '/../c-mat-4/topic-01/block-01/block',
    weekStartAt: '2099-01-05',
    created: '2099-01-05T00:00:00.000Z',
    ...overrides,
  };
}

const PLAN = {
  title: 'Mathe 4',
  project: 'c-mat-4',
  puid: 'c-mat-4',
  totalBlocks: 2,
  totalLevels: 3,
  etag: 'x',
  topics: [
    {
      title: 'Topic A',
      blocks: [{ puid: 'c-mat-4/other', title: 'Other block', levels: [] }],
    },
    {
      title: 'Topic B',
      blocks: [
        {
          puid: 'c-mat-4/b1',
          title: 'Block 1',
          levels: [
            { puid: 'c-mat-4/lv1', title: 'Level 1' },
            { puid: 'c-mat-4/lv2', title: 'Level 2' },
          ],
        },
        {
          puid: 'c-mat-4/b2',
          title: 'Block 2',
          levels: [{ puid: 'c-mat-4/lv3', title: 'Level 3' }],
        },
      ],
    },
  ],
} as unknown as Plan;

const planCache = new Map<string, Plan>([['c-mat-4', PLAN]]);

// ---------------------------------------------------------------------------
// checkAssignmentCompletion
// ---------------------------------------------------------------------------

describe('checkAssignmentCompletion', () => {
  it('reports per-level completion using the latest event per level', () => {
    const events = [
      finish({ puid: 'c-mat-4/lv1', score: 1, created: '2099-01-05T10:00:00.000Z' }),
      finish({ puid: 'c-mat-4/lv1', score: 3, created: '2099-01-06T10:00:00.000Z' }),
      // Older event after the newer one must not replace it.
      finish({ puid: 'c-mat-4/lv1', score: 2, created: '2099-01-04T10:00:00.000Z' }),
    ];
    const result = checkAssignmentCompletion('Kid', [pin()], planCache, events);

    expect(result.childName).toBe('Kid');
    expect(result.week).toBe('all');
    expect(result.assignments).toEqual([
      {
        blockPuid: 'c-mat-4/b1',
        blockTitle: 'Block 1',
        weekStartAt: '2099-01-05',
        totalLevels: 2,
        completedLevels: 1,
        completionRate: 0.5,
        levels: [
          {
            puid: 'c-mat-4/lv1',
            title: 'Level 1',
            completed: true,
            score: 3,
            lastCompletedAt: '2099-01-06T10:00:00.000Z',
          },
          {
            puid: 'c-mat-4/lv2',
            title: 'Level 2',
            completed: false,
            score: undefined,
            lastCompletedAt: undefined,
          },
        ],
      },
    ]);
    expect(result.summary).toEqual({
      totalAssignments: 1,
      fullyCompleted: 0,
      partiallyCompleted: 1,
      notStarted: 0,
    });
  });

  it('reports blocks of unknown plans with zero levels', () => {
    const result = checkAssignmentCompletion('Kid', [pin({ puid: 'c-eng-5/b9' })], planCache, []);
    expect(result.assignments).toEqual([
      {
        blockPuid: 'c-eng-5/b9',
        blockTitle: 'c-eng-5/b9',
        weekStartAt: '2099-01-05',
        totalLevels: 0,
        completedLevels: 0,
        completionRate: 0,
        levels: [],
      },
    ]);
    expect(result.summary.notStarted).toBe(1);
  });

  it('falls back to the puid when the block is missing from the plan', () => {
    const result = checkAssignmentCompletion(
      'Kid',
      [pin({ puid: 'c-mat-4/missing' })],
      planCache,
      [],
    );
    expect(result.assignments[0]).toMatchObject({
      blockTitle: 'c-mat-4/missing',
      totalLevels: 0,
      completionRate: 0,
    });
  });

  it('counts fully completed, partial and not started blocks', () => {
    const events = [finish({ puid: 'c-mat-4/lv3' }), finish({ puid: 'c-mat-4/lv1' })];
    const pins = [
      pin({ puid: 'c-mat-4/b2' }), // full
      pin({ puid: 'c-mat-4/b1' }), // partial
      pin({ puid: 'c-mat-4/other' }), // no levels → not started
    ];
    const result = checkAssignmentCompletion('Kid', pins, planCache, events);
    expect(result.summary).toEqual({
      totalAssignments: 3,
      fullyCompleted: 1,
      partiallyCompleted: 1,
      notStarted: 1,
    });
  });

  it('filters by child (keeping group-wide pins) and by week', () => {
    const pins = [
      pin({ puid: 'c-mat-4/b1', subgroup: 'P-kid' }),
      pin({ puid: 'c-mat-4/b2', subgroup: 'P-other' }),
      pin({ puid: 'c-mat-4/other' }), // group-wide
      pin({ puid: 'c-mat-4/b1', weekStartAt: '2099-01-12' }),
    ];
    const byChild = checkAssignmentCompletion('Kid', pins, planCache, [], undefined, 'P-kid');
    expect(byChild.assignments.map((a) => a.blockPuid)).toEqual([
      'c-mat-4/b1',
      'c-mat-4/other',
      'c-mat-4/b1',
    ]);

    const byWeek = checkAssignmentCompletion('Kid', pins, planCache, [], '2099-01-12', 'P-kid');
    expect(byWeek.week).toBe('2099-01-12');
    expect(byWeek.assignments).toHaveLength(1);
    expect(byWeek.assignments[0]?.weekStartAt).toBe('2099-01-12');
  });
});

// ---------------------------------------------------------------------------
// getWeeklySummary
// ---------------------------------------------------------------------------

describe('getWeeklySummary', () => {
  it('rolls up the week, deduplicating levels and splitting assigned/self-directed', () => {
    const events = [
      // In week, assigned; replaced by the later attempt of the same level.
      finish({ puid: 'c-mat-4/lv1', score: 1, corrects: 5, created: '2099-01-05T08:00:00.000Z' }),
      finish({
        puid: 'c-mat-4/lv1',
        score: 3,
        corrects: 9,
        duration: 30.4,
        created: '2099-01-06T08:00:00.000Z',
      }),
      // Older duplicate after the newer one is ignored.
      finish({ puid: 'c-mat-4/lv1', score: 0, created: '2099-01-05T07:00:00.000Z' }),
      // In week (last day), self-directed.
      finish({
        puid: 'c-natdeu-4/lv9',
        blockPuid: 'c-natdeu-4/b9',
        score: 2,
        corrects: 6,
        duration: 20.3,
        created: '2099-01-11T23:00:00.000Z',
      }),
      // Outside the week.
      finish({ puid: 'c-mat-4/lv2', created: '2099-01-12T00:00:00.000Z' }),
      finish({ puid: 'c-mat-4/lv3', created: '2099-01-04T23:59:59.000Z' }),
    ];
    const summary = getWeeklySummary('Kid', '2099-01-05', events, new Set(['c-mat-4/b1']));

    expect(summary).toEqual({
      childName: 'Kid',
      weekStartAt: '2099-01-05',
      weekEndAt: '2099-01-11',
      levelsCompleted: 2,
      totalDurationSeconds: 51,
      starsEarned: 5,
      starsMax: 6,
      averageAccuracy: 15 / 20,
      subjectsCovered: ['c-mat-4', 'c-natdeu-4'],
      assignedLevelsCompleted: 1,
      selfDirectedLevelsCompleted: 1,
      assignmentRatio: 0.5,
    });
  });

  it('returns zeros for an empty week', () => {
    const summary = getWeeklySummary('Kid', '2099-12-28', [], new Set());
    expect(summary).toMatchObject({
      weekEndAt: '2100-01-03',
      levelsCompleted: 0,
      averageAccuracy: 0,
      assignmentRatio: 0,
      subjectsCovered: [],
    });
  });
});

// ---------------------------------------------------------------------------
// getSubjectSummary
// ---------------------------------------------------------------------------

/** n events for a project at increasing days, with the given accuracy per event. */
function series(project: string, accuracies: number[], startDay = 1): FinishLevelEvent[] {
  return accuracies.map((acc, i) =>
    finish({
      puid: `${project}/lv${i}`,
      corrects: Math.round(acc * 10),
      total: 10,
      score: 2,
      duration: 10,
      created: `2099-02-${String(startDay + i).padStart(2, '0')}T00:00:00.000Z`,
    }),
  );
}

describe('getSubjectSummary', () => {
  it('aggregates per subject and sorts by levels completed', () => {
    const events = [
      ...series('c-mat-4', [1, 0.5]),
      finish({ puid: 'c-natdeu-4/lv1', score: 1, corrects: 3, total: 4, duration: 12.6 }),
      ...series('c-mat-4', [0], 10),
    ];
    const { childName, subjects } = getSubjectSummary('Kid', events);
    expect(childName).toBe('Kid');
    expect(subjects).toEqual([
      {
        subject: 'c-mat-4',
        subjectName: 'Mathematik',
        totalLevelsCompleted: 3,
        averageAccuracy: 15 / 30,
        averageStars: 2,
        totalDurationSeconds: 30,
        trend: 'insufficient_data',
        recentSessions: 3,
        allTimeSessionCount: 3,
      },
      {
        subject: 'c-natdeu-4',
        subjectName: 'Deutsch',
        totalLevelsCompleted: 1,
        averageAccuracy: 0.75,
        averageStars: 1,
        totalDurationSeconds: 13,
        trend: 'insufficient_data',
        recentSessions: 1,
        allTimeSessionCount: 1,
      },
    ]);
  });

  it('keeps the project code as name for unknown subjects', () => {
    const { subjects } = getSubjectSummary('Kid', [
      finish({ puid: 'c-xyz-2/lv1', total: 0, corrects: 0 }),
    ]);
    expect(subjects[0]?.subjectName).toBe('c-xyz-2');
    expect(subjects[0]?.averageAccuracy).toBe(0);
  });

  it('filters by subject case-insensitively', () => {
    const events = [...series('c-mat-4', [1]), ...series('c-natdeu-4', [1])];
    const { subjects } = getSubjectSummary('Kid', events, 'NATDEU');
    expect(subjects.map((s) => s.subject)).toEqual(['c-natdeu-4']);
  });

  it('detects improving, declining and stable trends', () => {
    const improving = getSubjectSummary('Kid', series('c-mat-4', [0.5, 0.5, 1, 1]), undefined, 2);
    expect(improving.subjects[0]?.trend).toBe('improving');
    expect(improving.subjects[0]?.recentSessions).toBe(2);

    const declining = getSubjectSummary('Kid', series('c-mat-4', [1, 1, 0.5, 0.5]), undefined, 2);
    expect(declining.subjects[0]?.trend).toBe('declining');

    const stable = getSubjectSummary('Kid', series('c-mat-4', [0.8, 0.8, 0.8, 0.8]), undefined, 2);
    expect(stable.subjects[0]?.trend).toBe('stable');
  });

  it('sorts events by date before computing the trend', () => {
    // Given newest-first, the recent window must still be the latest events.
    const events = series('c-mat-4', [0.5, 0.5, 1, 1]).reverse();
    const { subjects } = getSubjectSummary('Kid', events, undefined, 2);
    expect(subjects[0]?.trend).toBe('improving');
  });

  it('treats windows without questions as zero accuracy', () => {
    const events = series('c-mat-4', [0, 0, 0, 0]).map((e) => ({ ...e, total: 0 }));
    const { subjects } = getSubjectSummary('Kid', events, undefined, 2);
    expect(subjects[0]?.trend).toBe('stable');
  });
});

// ---------------------------------------------------------------------------
// getActivityTimeline
// ---------------------------------------------------------------------------

describe('getActivityTimeline', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2099-03-10T12:00:00.000Z'));
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  const day = (date: string, overrides: Partial<FinishLevelEvent> = {}): FinishLevelEvent =>
    finish({ created: `${date}T09:00:00.000Z`, ...overrides });

  it('computes active days, streaks, gaps and daily breakdown', () => {
    const events = [
      day('2099-02-20'), // before `since`, ignored
      day('2099-03-01', { duration: 10.4 }),
      day('2099-03-01', { puid: 'c-natdeu-4/lv1', duration: 20 }),
      day('2099-03-02'),
      day('2099-03-03'),
      // 2-day gap (03-04) is not reported
      day('2099-03-05'),
      // gap 03-06 … 03-08 (3 days)
      day('2099-03-09'),
      day('2099-03-10'),
    ];
    const t = getActivityTimeline('Kid', events, '2099-03-01');

    expect(t.childName).toBe('Kid');
    expect(t.since).toBe('2099-03-01');
    expect(t.activeDays).toBe(6);
    expect(t.totalDays).toBe(10);
    expect(t.longestStreak).toBe(3);
    expect(t.currentStreak).toBe(2);
    expect(t.totalLevels).toBe(7);
    expect(t.totalDurationSeconds).toBe(330);
    expect(t.averageLevelsPerActiveDay).toBe(7 / 6);
    expect(t.gaps).toEqual([{ from: '2099-03-06', to: '2099-03-08', days: 3 }]);
    expect(t.dailyActivity[0]).toEqual({
      date: '2099-03-01',
      levelsCompleted: 2,
      durationSeconds: 30,
      subjects: ['c-mat-4', 'c-natdeu-4'],
    });
    expect(t.dailyActivity.map((d) => d.date)).toEqual([
      '2099-03-01',
      '2099-03-02',
      '2099-03-03',
      '2099-03-05',
      '2099-03-09',
      '2099-03-10',
    ]);
  });

  it('has no current streak when today is inactive', () => {
    const t = getActivityTimeline('Kid', [day('2099-03-08')], '2099-03-01');
    expect(t.currentStreak).toBe(0);
    expect(t.longestStreak).toBe(1);
    expect(t.totalDays).toBe(3);
  });

  it('returns zeros without activity', () => {
    const t = getActivityTimeline('Kid', [], '2099-03-01');
    expect(t).toEqual({
      childName: 'Kid',
      since: '2099-03-01',
      activeDays: 0,
      totalDays: 0,
      longestStreak: 0,
      currentStreak: 0,
      totalLevels: 0,
      totalDurationSeconds: 0,
      averageLevelsPerActiveDay: 0,
      dailyActivity: [],
      gaps: [],
    });
  });
});

// ---------------------------------------------------------------------------
// compareChildren
// ---------------------------------------------------------------------------

describe('compareChildren', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2099-03-10T12:00:00.000Z'));
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('aggregates each child and sorts by stars descending', () => {
    const result = compareChildren([
      {
        name: 'Low',
        finishEvents: [finish({ score: 1, corrects: 0, total: 0, duration: 0.4 })],
      },
      {
        name: 'High',
        finishEvents: [
          finish({ created: '2099-03-02T10:00:00.000Z', corrects: 8, duration: 10.2 }),
          finish({
            puid: 'c-natdeu-4/lv1',
            created: '2099-03-01T10:00:00.000Z',
            corrects: 6,
            duration: 20.4,
          }),
          finish({ created: '2099-03-02T11:00:00.000Z', corrects: 10, duration: 5 }),
        ],
      },
      { name: 'None', finishEvents: [] },
    ]);

    expect(result.generatedAt).toBe('2099-03-10T12:00:00.000Z');
    expect(result.children).toEqual([
      {
        childName: 'High',
        totalStars: 9,
        averageAccuracy: 24 / 30,
        totalDurationSeconds: 36,
        activeDays: 2,
        levelsCompleted: 3,
        subjects: ['c-mat-4', 'c-natdeu-4'],
        lastActiveDate: '2099-03-02',
      },
      {
        childName: 'Low',
        totalStars: 1,
        averageAccuracy: 0,
        totalDurationSeconds: 0,
        activeDays: 1,
        levelsCompleted: 1,
        subjects: ['c-mat-4'],
        lastActiveDate: '2099-01-05',
      },
      {
        childName: 'None',
        totalStars: 0,
        averageAccuracy: 0,
        totalDurationSeconds: 0,
        activeDays: 0,
        levelsCompleted: 0,
        subjects: [],
        lastActiveDate: null,
      },
    ]);
  });
});
