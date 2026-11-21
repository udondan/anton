/**
 * @udondan/anton — SDK entry point.
 *
 * Import the `Anton` class and any types you need:
 *
 * @example
 * ```ts
 * import { Anton } from '@udondan/anton';
 *
 * const anton = new Anton({ loginCode: 'YOUR-CODE' });
 * await anton.connect();
 *
 * console.log(anton.getStatus());
 * ```
 */

export { Anton } from './Anton.js';
export type { AntonConfig } from './Anton.js';

// Re-export public types
export type {
  AntonEvent,
  Assignment,
  AssignmentStatus,
  ActivityTimeline,
  AssignmentCompletionResult,
  Block,
  ChildComparisonRow,
  CompareChildrenResult,
  DayActivity,
  FinishLevelEvent,
  GroupInfo,
  GroupMember,
  LessonContent,
  LevelReviewReport,
  Level,
  Plan,
  PinnedBlock,
  PlanSummary,
  Session,
  SubjectSummary,
  SubjectSummaryResult,
  Topic,
  WeeklySummary,
} from './types.js';
export { SUBJECT_CODES } from './types.js';
