/**
 * Pure per-subject and per-day summaries of a child's finishLevel events.
 * No HTTP calls here.
 */

import {
  accuracy,
  addDays,
  daysBetween,
  groupBy,
  projectOf,
  projectToSubjectName,
  sum,
} from './analysis.js';
import type {
  ActivityTimeline,
  DayActivity,
  FinishLevelEvent,
  SubjectSummary,
  SubjectSummaryResult,
} from './types.js';

// ---------------------------------------------------------------------------
// get_subject_summary
// ---------------------------------------------------------------------------

/** Compare the accuracy of the last N sessions with the N sessions before. */
function accuracyTrend(sorted: FinishLevelEvent[], windowSize: number): SubjectSummary['trend'] {
  if (sorted.length < windowSize * 2) return 'insufficient_data';
  const recent = sorted.slice(-windowSize);
  const prior = sorted.slice(-windowSize * 2, -windowSize);
  const delta = accuracy(recent) - accuracy(prior);
  if (delta > 0.05) return 'improving';
  if (delta < -0.05) return 'declining';
  return 'stable';
}

function summarizeSubject(
  project: string,
  events: FinishLevelEvent[],
  trendWindowSize: number,
): SubjectSummary {
  // Sort by date ascending for trend calculation
  const sorted = [...events].sort(
    (a, b) => new Date(a.created).getTime() - new Date(b.created).getTime(),
  );
  return {
    subject: project,
    subjectName: projectToSubjectName(project),
    totalLevelsCompleted: sorted.length,
    averageAccuracy: accuracy(sorted),
    // Every subject has at least one event, so sorted is never empty.
    averageStars: sum(sorted, 'score') / sorted.length,
    totalDurationSeconds: Math.round(sum(sorted, 'duration')),
    trend: accuracyTrend(sorted, trendWindowSize),
    recentSessions: Math.min(sorted.length, trendWindowSize),
    allTimeSessionCount: sorted.length,
  };
}

/**
 * Aggregate progress per subject with accuracy trend.
 */
export function getSubjectSummary(
  childName: string,
  finishEvents: FinishLevelEvent[],
  subjectFilter?: string,
  trendWindowSize = 5,
): SubjectSummaryResult {
  const needle = subjectFilter?.toLowerCase();
  const subjects = Array.from(groupBy(finishEvents, (e) => projectOf(e.puid)))
    .filter(([project]) => !needle || project.toLowerCase().includes(needle))
    .map(([project, events]) => summarizeSubject(project, events, trendWindowSize))
    // Sort by total levels completed descending
    .sort((a, b) => b.totalLevelsCompleted - a.totalLevelsCompleted);

  return { childName, subjects };
}

// ---------------------------------------------------------------------------
// get_activity_timeline
// ---------------------------------------------------------------------------

function dayActivity(date: string, events: FinishLevelEvent[]): DayActivity {
  return {
    date,
    levelsCompleted: events.length,
    durationSeconds: Math.round(sum(events, 'duration')),
    subjects: Array.from(new Set(events.map((e) => projectOf(e.puid)))),
  };
}

/** Longest run of consecutive days in an ascending list of dates. */
function longestStreak(dates: string[]): number {
  let longest = 0;
  let streak = 0;
  dates.forEach((date, i) => {
    streak = i > 0 && daysBetween(dates[i - 1], date) === 1 ? streak + 1 : 1;
    longest = Math.max(longest, streak);
  });
  return longest;
}

/** Consecutive active days counting backwards from today. */
function currentStreak(activeDates: Set<string>, today: string): number {
  let streak = 0;
  for (let d = today; activeDates.has(d); d = addDays(d, -1)) streak++;
  return streak;
}

/** Inactive periods of more than 2 days between active dates. */
function findGaps(dates: string[]): ActivityTimeline['gaps'] {
  const gaps: ActivityTimeline['gaps'] = [];
  for (let i = 1; i < dates.length; i++) {
    const prev = dates[i - 1];
    const curr = dates[i];
    const gap = daysBetween(prev, curr);
    if (gap > 2) {
      gaps.push({ from: addDays(prev, 1), to: addDays(curr, -1), days: gap - 1 });
    }
  }
  return gaps;
}

/**
 * Chronological summary of a child's learning activity.
 */
export function getActivityTimeline(
  childName: string,
  finishEvents: FinishLevelEvent[],
  since: string,
): ActivityTimeline {
  const today = new Date().toISOString().slice(0, 10);
  const filtered = finishEvents.filter((e) => e.created.slice(0, 10) >= since);
  const sortedDays = Array.from(groupBy(filtered, (e) => e.created.slice(0, 10))).sort(([a], [b]) =>
    a.localeCompare(b),
  );
  const sortedDates = sortedDays.map(([date]) => date);
  const activeDays = sortedDates.length;
  const totalLevels = filtered.length;
  const totalDuration = sortedDays.reduce((s, [, events]) => s + sum(events, 'duration'), 0);
  const firstDate = sortedDates[0] ?? since;

  return {
    childName,
    since,
    activeDays,
    totalDays: activeDays > 0 ? daysBetween(firstDate, today) + 1 : 0,
    longestStreak: longestStreak(sortedDates),
    currentStreak: currentStreak(new Set(sortedDates), today),
    totalLevels,
    totalDurationSeconds: Math.round(totalDuration),
    averageLevelsPerActiveDay: activeDays > 0 ? totalLevels / activeDays : 0,
    dailyActivity: sortedDays.map(([date, events]) => dayActivity(date, events)),
    gaps: findGaps(sortedDates),
  };
}
