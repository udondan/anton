// ---------------------------------------------------------------------------
// Config
// ---------------------------------------------------------------------------

export interface ChildConfig {
  /** Human-readable name for the child (e.g. "Emma") */
  name: string;
  /** 8-character ANTON login code */
  loginCode?: string;
  /** Internal user ID – alternative to loginCode */
  logId?: string;
}

export interface Config {
  children: ChildConfig[];
}

// ---------------------------------------------------------------------------
// Sessions (returned by the anton.app login endpoint)
// ---------------------------------------------------------------------------

export interface Session {
  loginCode: string;
  logId: string;
  authToken: string;
  displayName: string;
  grade?: number;
  subject?: string;
  avatar?: unknown;
}

export interface ChildSession extends Session {
  /** Name from the local config */
  configName: string;
  /** Public ID from the setPublicId event (used for group membership) */
  publicId?: string;
}

// ---------------------------------------------------------------------------
// Events (from the apisLogger/subscribe endpoint)
// ---------------------------------------------------------------------------

export interface AntonEvent {
  /** Event type identifier, e.g. "setLoginCode", "finishLevel", "adjustCoins" */
  event: string;
  /** Event payload – type varies by event */
  value?: unknown;
  /** ISO-8601 creation timestamp */
  created: string;
  /** ISO-8601 server insertion timestamp */
  inserted?: string;
  logId?: string;
  src?: string;
  [key: string]: unknown;
}

/** Specific shape of a finishLevel event payload */
export interface FinishLevelEvent extends AntonEvent {
  event: 'finishLevel';
  puid: string;
  type: 'normal' | 'test' | 'bulb';
  atoms: number;
  level: string;
  round: number;
  score: number;
  total: number;
  corrects: number;
  duration: number;
  mistakes: number;
  blockPuid: string;
  blockTitle: string;
  levelTitle: string;
  progressColors: string;
}

// ---------------------------------------------------------------------------
// Plans / Course catalogue
// ---------------------------------------------------------------------------

export interface PlanSummary {
  project: string;
  fileId: string;
  etag: string;
  title: string | Record<string, string>;
  subject: string | Record<string, string>;
  grades: number[];
  totalBlocks?: number;
  totalLevels?: number;
  guiLanguages: string[];
  isDebug?: boolean;
  [key: string]: unknown;
}

export interface Level {
  title: string;
  puid: string;
  type?: string;
  slug?: string;
  [key: string]: unknown;
}

export interface Block {
  title: string;
  puid: string;
  levels: Level[];
  [key: string]: unknown;
}

export interface Topic {
  title: string;
  puid: string;
  blocks: Block[];
  [key: string]: unknown;
}

export interface Plan {
  title: string;
  project: string;
  puid: string;
  topics: Topic[];
  totalBlocks: number;
  totalLevels: number;
  etag: string;
  [key: string]: unknown;
}

// ---------------------------------------------------------------------------
// Group / Family
// ---------------------------------------------------------------------------

export interface GroupMember {
  publicId: string;
  role: 'admin' | 'pupil' | 'teacher' | string;
  /** ISO-8601 date when they joined */
  originalCreatedAt?: string;
  /** Display name resolved from group/members/getDescriptions/get */
  displayName?: string;
  /** Log ID resolved from group/members/getDescriptions/get */
  logId?: string;
}

export interface GroupInfo {
  groupCode: string;
  groupType: string;
  groupName: string;
  members: GroupMember[];
  isPlus?: boolean;
  plusValidUntil?: string;
}

/** A block pinned to the group (assigned lesson) */
export interface PinnedBlock {
  puid: string;
  /** Block path, e.g. "/../c-natdeu-4/topic-01-.../block-01-.../block" */
  block: string;
  /** Week this assignment is for (YYYY-MM-DD Monday) */
  weekStartAt: string;
  /** If set, the assignment is for this specific child publicId only */
  subgroup?: string;
  created: string;
}

// ---------------------------------------------------------------------------
// Lesson / Content API
// ---------------------------------------------------------------------------

export interface LessonContent {
  title: string;
  puid: string;
  type?: string;
  parentTopic?: { title: string; puid?: string };
  parentBlock?: { title: string; puid?: string };
  trainers: Array<{
    trainer: string;
    atoms?: unknown[];
    cats?: string[];
    instruction?: string;
  }>;
  [key: string]: unknown;
}

// ---------------------------------------------------------------------------
// Progress / review report
// ---------------------------------------------------------------------------

export interface LevelReviewEvent {
  event: string;
  round?: number;
  created?: string;
  [key: string]: unknown;
}

export interface LevelReviewReport {
  status: string;
  events: LevelReviewEvent[];
  [key: string]: unknown;
}

// ---------------------------------------------------------------------------
// Assignments (local, stored in a JSON file)
// ---------------------------------------------------------------------------

export type AssignmentStatus = 'pending' | 'completed' | 'cancelled';

export interface Assignment {
  id: string;
  /** configName of the child (or publicId if child is not in local config) */
  childName: string;
  /** fileId of the lesson (without the "level/" prefix) */
  fileId: string;
  /** Optional human-readable lesson title (filled in when known) */
  lessonTitle?: string;
  note?: string;
  status: AssignmentStatus;
  assignedAt: string;
  completedAt?: string;
}

export interface AssignmentStore {
  assignments: Assignment[];
}

// ---------------------------------------------------------------------------
// Known subject codes (from antonLib documentation)
// ---------------------------------------------------------------------------

export const SUBJECT_CODES: Record<string, string> = {
  mat: 'Mathematik',
  natdeu: 'Deutsch',
  eng: 'Englisch',
  geo: 'Geografie',
  chem: 'Chemie',
  his: 'Geschichte',
  sci: 'Sachunterricht',
  bio: 'Biologie',
  phy: 'Physik',
  mus: 'Musik',
  deu: 'Deutsch als Zweitsprache',
  preschool: 'Vorschule',
};

// ---------------------------------------------------------------------------
// Analysis result types
// ---------------------------------------------------------------------------

export interface AssignmentLevelStatus {
  puid: string;
  title: string;
  completed: boolean;
  score?: number;
  lastCompletedAt?: string;
}

export interface AssignmentCompletionStatus {
  blockPuid: string;
  blockTitle: string;
  weekStartAt: string;
  totalLevels: number;
  completedLevels: number;
  completionRate: number;
  levels: AssignmentLevelStatus[];
}

export interface AssignmentCompletionResult {
  childName: string;
  week: string;
  assignments: AssignmentCompletionStatus[];
  summary: {
    totalAssignments: number;
    fullyCompleted: number;
    partiallyCompleted: number;
    notStarted: number;
  };
}

export interface WeeklySummary {
  childName: string;
  weekStartAt: string;
  weekEndAt: string;
  levelsCompleted: number;
  totalDurationSeconds: number;
  starsEarned: number;
  starsMax: number;
  averageAccuracy: number;
  subjectsCovered: string[];
  assignedLevelsCompleted: number;
  selfDirectedLevelsCompleted: number;
  assignmentRatio: number;
}

export interface SubjectSummary {
  subject: string;
  subjectName: string;
  totalLevelsCompleted: number;
  averageAccuracy: number;
  averageStars: number;
  totalDurationSeconds: number;
  trend: 'improving' | 'declining' | 'stable' | 'insufficient_data';
  recentSessions: number;
  allTimeSessionCount: number;
}

export interface SubjectSummaryResult {
  childName: string;
  subjects: SubjectSummary[];
}

export interface DayActivity {
  date: string;
  levelsCompleted: number;
  durationSeconds: number;
  subjects: string[];
}

export interface ActivityTimeline {
  childName: string;
  since: string;
  activeDays: number;
  totalDays: number;
  longestStreak: number;
  currentStreak: number;
  totalLevels: number;
  totalDurationSeconds: number;
  averageLevelsPerActiveDay: number;
  dailyActivity: DayActivity[];
  gaps: Array<{ from: string; to: string; days: number }>;
}

export interface ChildComparisonRow {
  childName: string;
  totalStars: number;
  averageAccuracy: number;
  totalDurationSeconds: number;
  activeDays: number;
  levelsCompleted: number;
  subjects: string[];
  lastActiveDate: string | null;
}

export interface CompareChildrenResult {
  children: ChildComparisonRow[];
  generatedAt: string;
}
