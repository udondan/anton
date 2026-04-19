/**
 * Pure analysis functions for Anton learning data.
 * All functions receive already-fetched data — no HTTP calls here.
 */

import type {
  ActivityTimeline,
  AssignmentCompletionResult,
  AssignmentCompletionStatus,
  ChildComparisonRow,
  CompareChildrenResult,
  DayActivity,
  FinishLevelEvent,
  Plan,
  PinnedBlock,
  SubjectSummary,
  SubjectSummaryResult,
  WeeklySummary,
} from './types.js';
import { SUBJECT_CODES } from './types.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Convert project prefix (e.g. "c-mat-4") to human-readable subject name. */
function projectToSubjectName(project: string): string {
  // Strip leading "c-" and trailing grade suffix "-N" or "-NN"
  const code = project.replace(/^c-/, '').replace(/-\d+$/, '');
  return SUBJECT_CODES[code] ?? project;
}

/** Add N days to a YYYY-MM-DD string. */
function addDays(date: string, n: number): string {
  const d = new Date(date + 'T00:00:00Z');
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

/** Difference in calendar days between two YYYY-MM-DD strings. */
function daysBetween(a: string, b: string): number {
  const msPerDay = 86_400_000;
  return Math.round(
    (new Date(b + 'T00:00:00Z').getTime() - new Date(a + 'T00:00:00Z').getTime()) / msPerDay,
  );
}

// ---------------------------------------------------------------------------
// check_assignment_completion
// ---------------------------------------------------------------------------

/**
 * Cross-reference pinned blocks (assignments) with a child's finishLevel events
 * to determine which assigned levels have been completed.
 */
export function checkAssignmentCompletion(
  childName: string,
  pinnedBlocks: PinnedBlock[],
  planCache: Map<string, Plan>,
  finishEvents: FinishLevelEvent[],
  filterWeek?: string,
  filterPublicId?: string,
): AssignmentCompletionResult {
  // Build a map: levelPuid → latest finishLevel event
  const completedMap = new Map<string, FinishLevelEvent>();
  for (const evt of finishEvents) {
    const prev = completedMap.get(evt.puid);
    if (!prev || new Date(evt.created) > new Date(prev.created)) {
      completedMap.set(evt.puid, evt);
    }
  }

  // When a filter is given, restrict to group-wide pins and this child's pins.
  // Without a filter, include all pinned blocks (group-wide and per-child).
  let blocks =
    filterPublicId === undefined
      ? pinnedBlocks
      : pinnedBlocks.filter((b) => b.subgroup == null || b.subgroup === filterPublicId);
  if (filterWeek) {
    blocks = blocks.filter((b) => b.weekStartAt === filterWeek);
  }

  const assignments: AssignmentCompletionStatus[] = [];

  for (const block of blocks) {
    const project = block.puid.split('/')[0];
    const plan = planCache.get(project);

    if (!plan) {
      // Plan not available — report as unknown
      assignments.push({
        blockPuid: block.puid,
        blockTitle: block.puid,
        weekStartAt: block.weekStartAt,
        totalLevels: 0,
        completedLevels: 0,
        completionRate: 0,
        levels: [],
      });
      continue;
    }

    // Find the block in the plan hierarchy
    let blockTitle = block.puid;
    let levels: { puid: string; title: string }[] = [];

    topicSearch: for (const topic of plan.topics) {
      for (const b of topic.blocks) {
        if (b.puid === block.puid) {
          blockTitle = b.title;
          levels = b.levels.map((lv) => ({ puid: lv.puid, title: lv.title }));
          break topicSearch;
        }
      }
    }

    const levelStatuses = levels.map((lv) => {
      const done = completedMap.get(lv.puid);
      return {
        puid: lv.puid,
        title: lv.title,
        completed: done != null,
        score: done?.score,
        lastCompletedAt: done?.created,
      };
    });

    const completedCount = levelStatuses.filter((l) => l.completed).length;

    assignments.push({
      blockPuid: block.puid,
      blockTitle,
      weekStartAt: block.weekStartAt,
      totalLevels: levels.length,
      completedLevels: completedCount,
      completionRate: levels.length > 0 ? completedCount / levels.length : 0,
      levels: levelStatuses,
    });
  }

  const fullyCompleted = assignments.filter((a) => a.completionRate === 1).length;
  const notStarted = assignments.filter((a) => a.completedLevels === 0).length;
  const partiallyCompleted = assignments.length - fullyCompleted - notStarted;

  return {
    childName,
    week: filterWeek ?? 'all',
    assignments,
    summary: {
      totalAssignments: assignments.length,
      fullyCompleted,
      partiallyCompleted,
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
  const seenInWeek = new Map<string, FinishLevelEvent>();
  for (const evt of inWeek) {
    const prev = seenInWeek.get(evt.puid);
    if (!prev || new Date(evt.created) > new Date(prev.created)) {
      seenInWeek.set(evt.puid, evt);
    }
  }

  for (const evt of seenInWeek.values()) {
    totalCorrects += evt.corrects;
    totalQuestions += evt.total;
    starsEarned += evt.score;
    starsMax += 3; // max 3 stars per level in Anton
    totalDurationSeconds += evt.duration;
    subjects.add(evt.puid.split('/')[0]);
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
// get_subject_summary
// ---------------------------------------------------------------------------

/**
 * Aggregate progress per subject with accuracy trend.
 */
export function getSubjectSummary(
  childName: string,
  finishEvents: FinishLevelEvent[],
  subjectFilter?: string,
  trendWindowSize = 5,
): SubjectSummaryResult {
  // Group events by project prefix
  const bySubject = new Map<string, FinishLevelEvent[]>();
  for (const evt of finishEvents) {
    const project = evt.puid.split('/')[0];
    let projectEvents = bySubject.get(project);
    if (!projectEvents) {
      projectEvents = [];
      bySubject.set(project, projectEvents);
    }
    projectEvents.push(evt);
  }

  const subjects: SubjectSummary[] = [];

  for (const [project, events] of bySubject) {
    if (subjectFilter && !project.toLowerCase().includes(subjectFilter.toLowerCase())) {
      continue;
    }

    // Sort by date ascending for trend calculation
    const sorted = [...events].sort(
      (a, b) => new Date(a.created).getTime() - new Date(b.created).getTime(),
    );

    let totalCorrects = 0;
    let totalQuestions = 0;
    let totalStars = 0;
    let totalDuration = 0;

    for (const evt of sorted) {
      totalCorrects += evt.corrects;
      totalQuestions += evt.total;
      totalStars += evt.score;
      totalDuration += evt.duration;
    }

    // Trend: compare accuracy of last N vs second-to-last N sessions
    let trend: SubjectSummary['trend'] = 'insufficient_data';
    if (sorted.length >= trendWindowSize * 2) {
      const recent = sorted.slice(-trendWindowSize);
      const prior = sorted.slice(-trendWindowSize * 2, -trendWindowSize);
      const recentAcc =
        recent.reduce((s, e) => s + e.corrects, 0) /
        Math.max(
          1,
          recent.reduce((s, e) => s + e.total, 0),
        );
      const priorAcc =
        prior.reduce((s, e) => s + e.corrects, 0) /
        Math.max(
          1,
          prior.reduce((s, e) => s + e.total, 0),
        );
      const delta = recentAcc - priorAcc;
      if (delta > 0.05) trend = 'improving';
      else if (delta < -0.05) trend = 'declining';
      else trend = 'stable';
    }

    subjects.push({
      subject: project,
      subjectName: projectToSubjectName(project),
      totalLevelsCompleted: sorted.length,
      averageAccuracy: totalQuestions > 0 ? totalCorrects / totalQuestions : 0,
      averageStars: sorted.length > 0 ? totalStars / sorted.length : 0,
      totalDurationSeconds: Math.round(totalDuration),
      trend,
      recentSessions: Math.min(sorted.length, trendWindowSize),
      allTimeSessionCount: sorted.length,
    });
  }

  // Sort by total levels completed descending
  subjects.sort((a, b) => b.totalLevelsCompleted - a.totalLevelsCompleted);

  return { childName, subjects };
}

// ---------------------------------------------------------------------------
// get_activity_timeline
// ---------------------------------------------------------------------------

/**
 * Chronological summary of a child's learning activity.
 */
export function getActivityTimeline(
  childName: string,
  finishEvents: FinishLevelEvent[],
  since: string,
  asOf: string,
): ActivityTimeline {
  const filtered = finishEvents.filter((e) => e.created.slice(0, 10) >= since);

  // Group by date
  const byDate = new Map<string, FinishLevelEvent[]>();
  for (const evt of filtered) {
    const d = evt.created.slice(0, 10);
    let dayEvents = byDate.get(d);
    if (!dayEvents) {
      dayEvents = [];
      byDate.set(d, dayEvents);
    }
    dayEvents.push(evt);
  }

  const sortedDates = Array.from(byDate.keys()).sort();
  const activeDays = sortedDates.length;

  let totalLevels = 0;
  let totalDuration = 0;
  const dailyActivity: DayActivity[] = [];

  for (const date of sortedDates) {
    const events = byDate.get(date) ?? [];
    const dayDuration = events.reduce((s, e) => s + e.duration, 0);
    const daySubjects = Array.from(new Set(events.map((e) => e.puid.split('/')[0])));
    totalLevels += events.length;
    totalDuration += dayDuration;
    dailyActivity.push({
      date,
      levelsCompleted: events.length,
      durationSeconds: Math.round(dayDuration),
      subjects: daySubjects,
    });
  }

  // Streak calculation
  let longestStreak = 0;
  let currentStreak: number;
  let streak = 0;
  const todayStr = asOf;

  for (let i = 0; i < sortedDates.length; i++) {
    if (i === 0) {
      streak = 1;
    } else {
      const prev = sortedDates[i - 1];
      const curr = sortedDates[i];
      streak = daysBetween(prev, curr) === 1 ? streak + 1 : 1;
    }
    if (streak > longestStreak) longestStreak = streak;
  }

  // Current streak: count backwards from today
  currentStreak = 0;
  let checkDate = todayStr;
  while (byDate.has(checkDate)) {
    currentStreak++;
    checkDate = addDays(checkDate, -1);
  }

  // Gaps: inactive periods > 2 days
  const gaps: ActivityTimeline['gaps'] = [];
  for (let i = 1; i < sortedDates.length; i++) {
    const prev = sortedDates[i - 1];
    const curr = sortedDates[i];
    const gap = daysBetween(prev, curr);
    if (gap > 2) {
      gaps.push({ from: addDays(prev, 1), to: addDays(curr, -1), days: gap - 1 });
    }
  }

  const firstDate = sortedDates[0] ?? since;
  const totalDays = activeDays > 0 ? daysBetween(firstDate, todayStr) + 1 : 0;

  return {
    childName,
    since,
    activeDays,
    totalDays,
    longestStreak,
    currentStreak,
    totalLevels,
    totalDurationSeconds: Math.round(totalDuration),
    averageLevelsPerActiveDay: activeDays > 0 ? totalLevels / activeDays : 0,
    dailyActivity,
    gaps,
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
      subjects.add(evt.puid.split('/')[0]);
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
