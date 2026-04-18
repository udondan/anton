/**
 * Low-level HTTP client for the unofficial anton.app API.
 *
 * All knowledge here is derived from reverse-engineering and community
 * research (antonLib Python library, frontend bundle analysis).
 * The API is undocumented and may change without notice.
 */

import axios, { type AxiosRequestConfig } from 'axios';
import type {
  AntonEvent,
  FinishLevelEvent,
  GroupInfo,
  GroupMember,
  LessonContent,
  LevelReviewReport,
  Plan,
  PinnedBlock,
  PlanSummary,
  Session,
} from './types.js';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** Device log ID from the browser's localStorage */
const DEVICE_LOG_ID = 'D-YT8Q-uusgorxroQWveIBP2afCCXK3pYR';

/** Device source token */
const DEVICE_SRC = 'wl9a';

/** Headers that mimic the official Chrome-based web client */
const BASE_HEADERS: Record<string, string> = {
  'Content-Type': 'application/json',
  Accept: '*/*',
  Origin: 'https://anton.app',
  'User-Agent':
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/114.0.5735.91 Safari/537.36',
  'Accept-Language': 'de-DE,de;q=0.9,en-US;q=0.8,en;q=0.7',
};

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

/**
 * POST wrapper for the d-/f-/b-apis-db.anton.app endpoints (defReq pattern
 * from antonLib).  Merges boilerplate fields every endpoint expects.
 */
async function defReq<T>(
  url: string,
  serverPath: string,
  params: Record<string, unknown>,
  authToken: string,
  logId?: string,
): Promise<T> {
  const body: Record<string, unknown> = {
    deviceLogId: DEVICE_LOG_ID,
    isDebug: false,
    useAuthToken: true,
    authToken,
    path: serverPath,
    params,
    ...(logId != null ? { logId } : {}),
  };

  const cfg: AxiosRequestConfig = { headers: BASE_HEADERS };
  const response = await axios.post<T>(url, body, cfg);
  assertOk(response.data);
  return response.data;
}

/**
 * POST to the pllsCall endpoints ({a-f}-apis-db.anton.app).
 * Used for progress/review report queries.
 */
async function pllsCall<T>(
  apiPath: string,
  params: Record<string, unknown>,
  logId: string,
  authToken: string,
): Promise<T> {
  const letters = 'abcdef';
  const r = letters[Math.floor(Math.random() * letters.length)];
  const url = `https://${r}-apis-db.anton.app/?p=${apiPath}`;

  const body = {
    params,
    path: `/../server-apis-db2/apis/${apiPath}`,
    logId,
    deviceLogId: DEVICE_LOG_ID,
    isDebug: false,
    useAuthToken: true,
    authToken,
  };

  const cfg: AxiosRequestConfig = { headers: BASE_HEADERS };
  const response = await axios.post<T>(url, body, cfg);
  return response.data;
}

/** Throw a descriptive error when the API signals failure. */
function assertOk(data: unknown): void {
  if (typeof data !== 'object' || data === null) return;
  const d = data as Record<string, unknown>;
  if (d['status'] === 'error' || d['error'] === true || d['error'] === 'true') {
    const msg =
      (d['message'] as string | undefined) ??
      (d['status'] as string | undefined) ??
      'Unknown API error';
    throw new Error(`Anton API error: ${msg}`);
  }
}

// ---------------------------------------------------------------------------
// Auth
// ---------------------------------------------------------------------------

/**
 * Login with an 8-character ANTON code.
 * Returns a Session containing authToken, logId, displayName, etc.
 */
export async function loginWithCode(code: string): Promise<Session> {
  const data = await defReq<Session>(
    'https://d-apis-db.anton.app/?p=login/step1/step1',
    '/../server-apis-db2/apis/login/step1/step1',
    { value: code, checkCaptcha: false },
    'noStoredAuthTokenFound',
  );
  return data;
}

/**
 * Login via logId by first fetching the current login code from the events
 * logger and then calling loginWithCode.
 */
export async function loginWithLogId(logId: string): Promise<Session> {
  const code = await getLoginCodeFromLogId(logId);
  return loginWithCode(code);
}

// ---------------------------------------------------------------------------
// Events / subscribe
// ---------------------------------------------------------------------------

/**
 * Fetch events for a log (user or group) from the subscribe endpoint.
 *
 * @param logId   The user's internal log ID or group code
 * @param filter  "subscribeUser" for user logs, "subscribeGroup" for groups
 * @param since   ISO date string (defaults to epoch = all events)
 */
export async function getEvents(
  logId: string,
  filter: 'subscribeUser' | 'subscribeGroup' = 'subscribeUser',
  since = '1970-01-01',
): Promise<AntonEvent[]> {
  const response = await axios.get<{ events?: AntonEvent[]; totalEvents?: number }>(
    'https://apis-db-logger-s-lb-2.anton.app/apisLogger/subscribe/',
    {
      params: {
        path: 'subscribe',
        'params[logId]': logId,
        'params[filter][name]': filter,
        'params[inserted]': since,
        'params[readOnly]': 'true',
        deviceLogId: DEVICE_LOG_ID,
      },
      headers: BASE_HEADERS,
    },
  );
  return response.data.events ?? [];
}

/** Alias: get user events */
export const getUserEvents = (logId: string, since?: string) =>
  getEvents(logId, 'subscribeUser', since);

/** Alias: get group events */
export const getGroupEvents = (groupCode: string, since?: string) =>
  getEvents(groupCode, 'subscribeGroup', since);

/**
 * Extract the most recent setLoginCode event value for a given logId.
 * Used by loginWithLogId.
 */
async function getLoginCodeFromLogId(logId: string): Promise<string> {
  const events = await getUserEvents(logId);
  for (const evt of events) {
    if (evt.event === 'setLoginCode' && typeof evt.value === 'string') {
      return evt.value;
    }
  }
  throw new Error(`No setLoginCode event found for logId ${logId}`);
}

// ---------------------------------------------------------------------------
// Group / Family
// ---------------------------------------------------------------------------

/**
 * Extract the child's publicId from their event log (setPublicId event).
 */
export function extractPublicId(events: AntonEvent[]): string | undefined {
  for (const evt of events) {
    if (evt.event === 'setPublicId' && typeof evt.value === 'string') {
      return evt.value;
    }
  }
}

/**
 * Get the family group code for a user from their event log.
 * Reads the most recent `isGroupMember` event.
 */
export function extractGroupCodes(events: AntonEvent[]): string[] {
  const codes = new Set<string>();
  for (const evt of events) {
    if (evt.event === 'isGroupMember' && typeof evt['groupCode'] === 'string') {
      codes.add(evt['groupCode']);
    }
  }
  return Array.from(codes);
}

/**
 * Parse group info (name, type, members) from the group event log.
 */
export function parseGroupInfo(groupCode: string, events: AntonEvent[]): GroupInfo {
  const info: GroupInfo = {
    groupCode,
    groupType: 'family',
    groupName: groupCode,
    members: [],
  };

  for (const evt of events) {
    if (evt.event === 'setGroupType' && typeof evt.value === 'string') {
      info.groupType = evt.value;
    } else if (evt.event === 'setGroupName' && typeof evt.value === 'string') {
      info.groupName = evt.value;
    } else if (evt.event === 'setGroupMember') {
      const member: GroupMember = {
        publicId: evt['publicId'] as string,
        role: (evt['role'] as string) ?? 'pupil',
        originalCreatedAt: evt['originalCreatedAt'] as string | undefined,
      };
      // Deduplicate by publicId, keeping latest entry
      const existing = info.members.findIndex((m) => m.publicId === member.publicId);
      if (existing >= 0) {
        info.members[existing] = member;
      } else {
        info.members.push(member);
      }
    } else if (evt.event === 'isPlus' && typeof evt['validUntil'] === 'string') {
      info.isPlus = true;
      info.plusValidUntil = evt['validUntil'];
    }
  }

  return info;
}

/**
 * Parse pinned blocks (lesson assignments) from the group event log.
 */
export function parsePinnedBlocks(events: AntonEvent[]): PinnedBlock[] {
  return events
    .filter((evt) => evt.event === 'pinGroupBlock')
    .map((evt) => ({
      puid: evt['puid'] as string,
      block: evt['block'] as string,
      weekStartAt: evt['weekStartAt'] as string,
      subgroup: evt['subgroup'] as string | undefined,
      created: evt.created,
    }));
}

// ---------------------------------------------------------------------------
// Plan / Assign a block to the group log
// ---------------------------------------------------------------------------

// Serialise concurrent pinGroupBlock calls so each one sees the result of the
// previous write before fetching existing pins.
let _pinMutex: Promise<void> = Promise.resolve();

function withPinMutex<T>(fn: () => Promise<T>): Promise<T> {
  const next = _pinMutex.then(fn, fn);
  _pinMutex = next.then(
    () => {},
    () => {},
  );
  return next;
}

/**
 * Post a `pinGroupBlock` event to assign a lesson block to the family group.
 *
 * @param groupCode     Family group code (e.g. "GROUP-XLJ7-CRTE")
 * @param blockPuid     Block PUID (e.g. "c-mat-4/ro9ajj")
 * @param blockPath     Block path (e.g. "/../c-mat-4/topic-07-brueche/block-02-brueche-zuordnen/block")
 * @param weekStartAt   ISO date of the Monday of the week (e.g. "2025-02-24")
 * @param authToken     Parent's auth token
 * @param subgroupPublicId  Optional: restrict to one child by their publicId
 */
export function pinGroupBlock(
  groupCode: string,
  blockPuid: string,
  blockPath: string,
  weekStartAt: string,
  logId: string,
  authToken: string,
  subgroupPublicId?: string,
): Promise<void> {
  return withPinMutex(async () => {
    const letters = 'abcdef';
    const r = letters[Math.floor(Math.random() * letters.length)];
    const body = {
      params: {
        groupCode,
        pinContent: { type: 'block', puid: blockPuid, path: blockPath },
        weekStartAt,
        members: subgroupPublicId ? [subgroupPublicId] : [],
        unselectedLevels: [],
      },
      path: '/../server-apis-db2/apis/group/pinContentNext/create/query',
      logId,
      deviceLogId: DEVICE_LOG_ID,
      isDebug: false,
      useAuthToken: true,
      authToken,
    };
    try {
      const cfg: AxiosRequestConfig = { headers: BASE_HEADERS };
      const response = await axios.post<{ status?: string }>(
        `https://${r}-apis-db.anton.app/?p=group/pinContentNext/create/query`,
        body,
        cfg,
      );
      assertOk(response.data);
    } catch (err: unknown) {
      if (axios.isAxiosError(err)) {
        throw new Error(
          `pinGroupBlock failed: HTTP ${err.response?.status} — ${JSON.stringify(err.response?.data)}`,
        );
      }
      throw err;
    }
  });
}

/**
 * Delete a pinned block from the group by its creation timestamp.
 */
export async function unpinGroupBlock(
  groupCode: string,
  pinCreatedAt: string,
  logId: string,
  authToken: string,
): Promise<void> {
  const letters = 'abcdef';
  const r = letters[Math.floor(Math.random() * letters.length)];
  const body = {
    params: { groupCode, pinCreatedAt },
    path: '/../server-apis-db2/apis/group/pinContentNext/delete/query',
    logId,
    deviceLogId: DEVICE_LOG_ID,
    isDebug: false,
    useAuthToken: true,
    authToken,
  };
  try {
    const cfg: AxiosRequestConfig = { headers: BASE_HEADERS };
    const response = await axios.post<{ status?: string }>(
      `https://${r}-apis-db.anton.app/?p=group/pinContentNext/delete/query`,
      body,
      cfg,
    );
    assertOk(response.data);
  } catch (err: unknown) {
    if (axios.isAxiosError(err)) {
      throw new Error(
        `unpinGroupBlock failed: HTTP ${err.response?.status} — ${JSON.stringify(err.response?.data)}`,
      );
    }
    throw err;
  }
}

// ---------------------------------------------------------------------------
// Content / Plans
// ---------------------------------------------------------------------------

/**
 * Fetch the master list of all available courses/plans.
 * Returns ~285 plans covering grades 1–13 and all subjects.
 */
export async function getPlansCatalogue(): Promise<PlanSummary[]> {
  const response = await axios.get<{ plans: PlanSummary[] }>(
    'https://content.anton.app/files/',
    {
      params: { fileId: 'list/plans', etag: 'latest' },
      headers: { Accept: 'application/json', Origin: 'https://anton.app' },
    },
  );
  return response.data.plans ?? [];
}

/**
 * Fetch the full topic→block→level hierarchy for a single course.
 *
 * @param project  Course project ID, e.g. "c-mat-4" or "c-natdeu-2"
 * @param etag     Optional ETag for cache control (defaults to "0")
 */
export async function getPlan(project: string, etag = '0'): Promise<Plan> {
  const response = await axios.get<Plan>('https://content.anton.app/files/', {
    params: { fileId: `plan/${project}`, etag },
    headers: { Accept: 'application/json', Origin: 'https://anton.app' },
  });
  return response.data;
}

/**
 * Fetch the content of a specific lesson level.
 *
 * @param fileId  Lesson path relative to "level/", e.g.
 *                "c-natdeu-9/topic-04-.../block-01-.../level-03"
 *                (the "level/" prefix is added automatically if missing)
 */
export async function getLessonContent(fileId: string, etag = '0'): Promise<LessonContent> {
  // Accept: "level/c-mat-4/...", "c-mat-4/...", or "/../c-mat-4/..." (path from plan data)
  const stripped = fileId.replace(/^\/\.\.\//, '');
  const normalised = stripped.startsWith('level/') ? stripped : `level/${stripped}`;
  const response = await axios.get<LessonContent>('https://content.anton.app/files/', {
    params: { fileId: normalised, etag },
    headers: { Accept: 'application/json', Origin: 'https://anton.app' },
  });
  return response.data;
}

// ---------------------------------------------------------------------------
// Group member descriptions
// ---------------------------------------------------------------------------

export interface MemberDescription {
  publicId: string;
  role: string;
  displayName: string;
  logId?: string;
  loginCode?: string;
  [key: string]: unknown;
}

interface GroupMemberDescriptionsResponse {
  status: string;
  memberDescriptions: {
    pupil: MemberDescription[];
    teacher: MemberDescription[];
    admin: MemberDescription[];
  };
}

/**
 * Fetch display names, logIds, and other metadata for all group members.
 * Uses only the parent's auth token — no child login codes required.
 */
export async function getGroupMemberDescriptions(
  groupCode: string,
  logId: string,
  authToken: string,
): Promise<MemberDescription[]> {
  const data = await pllsCall<GroupMemberDescriptionsResponse>(
    'group/members/getDescriptions/get',
    { groupCode },
    logId,
    authToken,
  );
  const { pupil = [], teacher = [], admin = [] } = data.memberDescriptions ?? {};
  return [...pupil, ...teacher, ...admin];
}

// ---------------------------------------------------------------------------
// Progress
// ---------------------------------------------------------------------------

/**
 * Get detailed review events for a specific level and child (by publicId).
 * Uses the `level/reviewReport/get` pllsCall endpoint.
 */
export async function getLevelReviewReport(
  levelPuid: string,
  publicId: string,
  parentLogId: string,
  parentAuthToken: string,
): Promise<LevelReviewReport> {
  return pllsCall<LevelReviewReport>(
    'level/reviewReport/get',
    { levelPuid, publicId },
    parentLogId,
    parentAuthToken,
  );
}

// ---------------------------------------------------------------------------
// Progress helpers (derived from user events)
// ---------------------------------------------------------------------------

export interface ProgressSummary {
  logId: string;
  totalEvents: number;
  /** Events grouped by type with counts */
  eventCounts: Record<string, number>;
  /** Completed levels with full detail */
  completedLevels: FinishLevelEvent[];
  /** Stars per subject (from finishLevel events) */
  starsBySubject: Record<string, number>;
  /** Number of distinct blocks completed */
  distinctBlocksCompleted: number;
}

/**
 * Derive a progress summary from a user's event stream.
 */
export function summariseProgress(logId: string, events: AntonEvent[]): ProgressSummary {
  const counts: Record<string, number> = {};
  const completedLevels: FinishLevelEvent[] = [];
  const starsBySubject: Record<string, number> = {};
  const seenLevels = new Map<string, FinishLevelEvent>();

  for (const evt of events) {
    counts[evt.event] = (counts[evt.event] ?? 0) + 1;

    if (evt.event === 'finishLevel') {
      const fe = evt as FinishLevelEvent;
      // Keep only the latest run per level puid
      const prev = seenLevels.get(fe.puid);
      if (!prev || new Date(fe.created) > new Date(prev.created)) {
        seenLevels.set(fe.puid, fe);
      }
    }
  }

  for (const fe of seenLevels.values()) {
    completedLevels.push(fe);
    const subject = fe.puid.split('/')[0] ?? 'unknown';
    starsBySubject[subject] = (starsBySubject[subject] ?? 0) + (fe.score ?? 0);
  }

  // Sort by created date descending
  completedLevels.sort((a, b) => new Date(b.created).getTime() - new Date(a.created).getTime());

  return {
    logId,
    totalEvents: events.length,
    eventCounts: counts,
    completedLevels,
    starsBySubject,
    distinctBlocksCompleted: new Set(completedLevels.map((e) => e.blockPuid)).size,
  };
}
