/**
 * Pure analysis functions for Anton learning data.
 * All functions receive already-fetched data — no HTTP calls here.
 * Subject and activity summaries live in activity.ts.
 */

import { filterPinnedBlocks } from './group-select.js';
import type {
  AssignmentCompletionResult,
  AssignmentCompletionStatus,
  Block,
  ChildComparisonRow,
  CompareChildrenResult,
  FinishLevelEvent,
  Plan,
  PinnedBlock,
  WeeklySummary,
} from './types.js';
import { SUBJECT_CODES } from './types.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Project prefix of a puid, e.g. "c-mat-4" for "c-mat-4/pr7gkb". */
export function projectOf(puid: string): string {
  return puid.split('/')[0];
}

/** Convert project prefix (e.g. "c-mat-4") to human-readable subject name. */
export function projectToSubjectName(project: string): string {
  // Strip leading "c-" and trailing grade suffix "-N" or "-NN"
  const code = project.replace(/^c-/, '').replace(/-\d+$/, '');
  return SUBJECT_CODES[code] ?? project;
}

/** Add N days to a YYYY-MM-DD string. */
export function addDays(date: string, n: number): string {
  const d = new Date(date + 'T00:00:00Z');
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

/** Difference in calendar days between two YYYY-MM-DD strings. */
export function daysBetween(a: string, b: string): number {
  const msPerDay = 86_400_000;
  return Math.round(
    (new Date(b + 'T00:00:00Z').getTime() - new Date(a + 'T00:00:00Z').getTime()) / msPerDay,
  );
}

/** Group items by a key, keeping the order in which keys first appear. */
export function groupBy<T>(items: T[], key: (item: T) => string): Map<string, T[]> {
  const groups = new Map<string, T[]>();
  for (const item of items) {
    const k = key(item);
    const group = groups.get(k);
    if (group) group.push(item);
    else groups.set(k, [item]);
  }
  return groups;
}

/** Sum a numeric field over finishLevel events. */
export function sum(
  events: FinishLevelEvent[],
  field: 'corrects' | 'total' | 'score' | 'duration',
): number {
  return events.reduce((s, e) => s + e[field], 0);
}

/** Share of correct answers over all questions, 0 without questions. */
export function accuracy(events: FinishLevelEvent[]): number {
  const total = sum(events, 'total');
  return total > 0 ? sum(events, 'corrects') / total : 0;
}

/** The latest finishLevel event per level puid. */
export function latestPerLevel(events: FinishLevelEvent[]): Map<string, FinishLevelEvent> {
  const latest = new Map<string, FinishLevelEvent>();
  for (const evt of events) {
    const prev = latest.get(evt.puid);
    if (!prev || new Date(evt.created) > new Date(prev.created)) {
      latest.set(evt.puid, evt);
    }
  }
  return latest;
}

// ---------------------------------------------------------------------------
// check_assignment_completion
// ---------------------------------------------------------------------------

function findPlanBlock(plan: Plan, puid: string): Block | undefined {
  return plan.topics.flatMap((t) => t.blocks).find((b) => b.puid === puid);
}

/** Completion of one pinned block. Unknown plans or blocks count as zero levels. */
function blockCompletion(
  pin: PinnedBlock,
  plan: Plan | undefined,
  completed: Map<string, FinishLevelEvent>,
): AssignmentCompletionStatus {
  const block = plan ? findPlanBlock(plan, pin.puid) : undefined;
  const levels = (block?.levels ?? []).map((lv) => {
    const done = completed.get(lv.puid);
    return {
      puid: lv.puid,
      title: lv.title,
      completed: done != null,
      score: done?.score,
      lastCompletedAt: done?.created,
    };
  });
  const completedLevels = levels.filter((l) => l.completed).length;
  return {
    blockPuid: pin.puid,
    blockTitle: block?.title ?? pin.puid,
    weekStartAt: pin.weekStartAt,
    totalLevels: levels.length,
    completedLevels,
    completionRate: levels.length > 0 ? completedLevels / levels.length : 0,
    levels,
  };
}

/**
 * Cross-reference pinned blocks (assignments) with a child's finishLevel events
 * to determine which assigned levels have been completed.
 *
 * With `filter.publicId`, only group-wide pins and this child's pins count.
 * Without it, all pinned blocks (group-wide and per-child) are included.
 */
export function checkAssignmentCompletion(
  childName: string,
  pinnedBlocks: PinnedBlock[],
  planCache: Map<string, Plan>,
  finishEvents: FinishLevelEvent[],
  filter: { week?: string; publicId?: string } = {},
): AssignmentCompletionResult {
  const completed = latestPerLevel(finishEvents);
  const blocks = filterPinnedBlocks(pinnedBlocks, {
    childPublicId: filter.publicId,
    week: filter.week,
  });
  const assignments = blocks.map((pin) =>
    blockCompletion(pin, planCache.get(projectOf(pin.puid)), completed),
  );

  const fullyCompleted = assignments.filter((a) => a.completionRate === 1).length;
  const notStarted = assignments.filter((a) => a.completedLevels === 0).length;

  return {
    childName,
    week: filter.week ?? 'all',
    assignments,
    summary: {
      totalAssignments: assignments.length,
      fullyCompleted,
      partiallyCompleted: assignments.length - fullyCompleted - notStarted,
      notStarted,
    },
  };
}

// ---------------------------------------------------------------------------
// get_weekly_summary
// ---------------------------------------------------------------------------

/**
 * Roll up a child's activity for a given week.
 */
export function getWeeklySummary(
  childName: string,
  weekStartAt: string,
  finishEvents: FinishLevelEvent[],
  assignedBlockPuids: Set<string>,
): WeeklySummary {
  const weekEndAt = addDays(weekStartAt, 6);

  const inWeek = finishEvents.filter((e) => {
    const d = e.created.slice(0, 10);
    return d >= weekStartAt && d <= weekEndAt;
  });

  let totalCorrects = 0;
  let totalQuestions = 0;
  let starsEarned = 0;
  let starsMax = 0;
  let totalDurationSeconds = 0;
  let assignedCount = 0;
  const subjects = new Set<string>();

  // Deduplicate within the week (keep latest per level)
  const seenInWeek = latestPerLevel(inWeek);

  for (const evt of seenInWeek.values()) {
    totalCorrects += evt.corrects;
    totalQuestions += evt.total;
    starsEarned += evt.score;
    starsMax += 3; // max 3 stars per level in Anton
    totalDurationSeconds += evt.duration;
    subjects.add(projectOf(evt.puid));
    if (assignedBlockPuids.has(evt.blockPuid)) {
      assignedCount++;
    }
  }

  const levelsCompleted = seenInWeek.size;
  const selfDirected = levelsCompleted - assignedCount;

  return {
    childName,
    weekStartAt,
    weekEndAt,
    levelsCompleted,
    totalDurationSeconds: Math.round(totalDurationSeconds),
    starsEarned,
    starsMax,
    averageAccuracy: totalQuestions > 0 ? totalCorrects / totalQuestions : 0,
    subjectsCovered: Array.from(subjects),
    assignedLevelsCompleted: assignedCount,
    selfDirectedLevelsCompleted: selfDirected,
    assignmentRatio: levelsCompleted > 0 ? assignedCount / levelsCompleted : 0,
  };
}

// ---------------------------------------------------------------------------
// compare_children
// ---------------------------------------------------------------------------

/**
 * Side-by-side comparison of all configured children.
 */
export function compareChildren(
  childRows: { name: string; finishEvents: FinishLevelEvent[] }[],
): CompareChildrenResult {
  const children: ChildComparisonRow[] = childRows.map(({ name, finishEvents }) => {
    let totalStars = 0;
    let totalCorrects = 0;
    let totalQuestions = 0;
    let totalDuration = 0;
    const activeDates = new Set<string>();
    const subjects = new Set<string>();
    let lastActiveDate: string | null = null;

    for (const evt of finishEvents) {
      totalStars += evt.score;
      totalCorrects += evt.corrects;
      totalQuestions += evt.total;
      totalDuration += evt.duration;
      const d = evt.created.slice(0, 10);
      activeDates.add(d);
      subjects.add(projectOf(evt.puid));
      if (!lastActiveDate || d > lastActiveDate) lastActiveDate = d;
    }

    return {
      childName: name,
      totalStars,
      averageAccuracy: totalQuestions > 0 ? totalCorrects / totalQuestions : 0,
      totalDurationSeconds: Math.round(totalDuration),
      activeDays: activeDates.size,
      levelsCompleted: finishEvents.length,
      subjects: Array.from(subjects),
      lastActiveDate,
    };
  });

  children.sort((a, b) => b.totalStars - a.totalStars);

  return {
    children,
    generatedAt: new Date().toISOString(),
  };
}
