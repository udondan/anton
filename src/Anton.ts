/**
 * Anton SDK — core class.
 *
 * Wraps the unofficial anton.app API and exposes all functionality as typed
 * async methods. Instantiate with your parent login code, call connect() once
 * to authenticate, then use any of the methods below.
 *
 * @example
 * ```ts
 * import { Anton } from '@udondan/anton';
 *
 * const anton = new Anton({ loginCode: 'YOUR-CODE' });
 * await anton.connect();
 *
 * const status = anton.getStatus();
 * console.log(status);
 * ```
 */

import {
  loginWithCode,
  loginWithLogId,
  getUserEvents,
  getGroupMemberEvents,
  getGroupEvents,
  extractGroupCodes,
  parseGroupInfo,
  parsePinnedBlocks,
  pinGroupBlock,
  unpinGroupBlock,
  getGroupMemberDescriptions,
  getPlansCatalogue,
  getPlan,
  getLessonContent,
  getLevelReviewReport,
  summariseProgress,
} from './client.js';
import {
  checkAssignmentCompletion,
  compareChildren,
  getWeeklySummary,
  projectOf,
} from './analysis.js';
import { getActivityTimeline, getSubjectSummary } from './activity.js';
import {
  defaultGroup,
  filterPinnedBlocks,
  findChild,
  findPin,
  pupilsOf,
  selectGroup,
  toResolvedChild,
  type ResolvedChild,
} from './group-select.js';
import {
  buildTopicBlocks,
  filterPlans,
  pickByIndexOrTitle,
  resolveBlockRef,
  type BlockQuery,
} from './plan-lookup.js';
import {
  listAssignments,
  createAssignment,
  updateAssignment as updateAssignmentStore,
  deleteAssignment as deleteAssignmentStore,
} from './assignments.js';
import type {
  AntonEvent,
  Assignment,
  AssignmentStatus,
  FinishLevelEvent,
  GroupInfo,
  PinnedBlock,
  Session,
} from './types.js';

// ---------------------------------------------------------------------------
// Config types
// ---------------------------------------------------------------------------

export interface AntonConfig {
  /** 8-character parent login code, e.g. "ABCD-1234" */
  loginCode?: string;
  /** Internal log ID — alternative to loginCode */
  logId?: string;
  /**
   * Default group name to use when the parent belongs to multiple groups.
   * Matched case-insensitively against groupName. Falls back to the first group
   * discovered if not set. Can also be set via the ANTON_GROUP environment
   * variable (CLI / MCP layer reads it and passes it here).
   */
  groupName?: string;
}

const EPOCH = '1970-01-01';

function currentWeekMonday(): string {
  const now = new Date();
  const day = now.getUTCDay();
  const diff = day === 0 ? -6 : 1 - day;
  now.setUTCDate(now.getUTCDate() + diff);
  return now.toISOString().slice(0, 10);
}

function onlyFinishLevel(events: AntonEvent[]): FinishLevelEvent[] {
  return events.filter((e): e is FinishLevelEvent => e.event === 'finishLevel');
}

function childrenOf(group: GroupInfo) {
  return pupilsOf(group).map((m) => ({
    displayName: m.displayName,
    publicId: m.publicId,
    logId: m.logId,
  }));
}

// ---------------------------------------------------------------------------
// Anton class
// ---------------------------------------------------------------------------

export class Anton {
  private readonly config: AntonConfig;
  private parentSession: Session | null = null;
  private allGroups: GroupInfo[] = [];

  constructor(config: AntonConfig) {
    this.config = config;
  }

  /**
   * Authenticate with the parent account and load all family groups.
   * Must be called before using any other method.
   * Safe to call multiple times — subsequent calls are no-ops if already connected.
   */
  async connect(): Promise<void> {
    if (this.parentSession) return;

    if (this.config.loginCode) {
      this.parentSession = await loginWithCode(this.config.loginCode);
    } else if (this.config.logId) {
      this.parentSession = await loginWithLogId(this.config.logId);
    } else {
      throw new Error('Anton requires either loginCode or logId in config.');
    }

    // Resolve all family groups
    try {
      const groupCodes = await this.discoverGroupCodes(this.parentSession.logId);
      if (groupCodes.length > 0) {
        this.allGroups = await this.fetchAllGroups(groupCodes, this.parentSession);
      }
    } catch (err) {
      this.parentSession = null;
      this.allGroups = [];
      throw new Error(`Failed to load family group: ${(err as Error).message}`, { cause: err });
    }
  }

  /**
   * Fast-path connect using a cached parent session.
   *
   * groupCodes must always be supplied (read from the stale or fresh cache entry).
   *
   * When groups is provided (TTL still valid): zero API calls — both the
   * parent session and group membership are restored directly from cache.
   *
   * When groups is omitted (TTL expired): uses the known groupCodes to
   * re-fetch group events and member descriptions, skipping loginWithCode
   * and getUserEvents.  Throws on failure so the caller can fall back to a
   * full connect() and clear the session cache.
   *
   * @internal Used by the CLI session cache. Not part of the public SDK API.
   */
  async connectFromCache(
    session: Session,
    groupCodes: string[],
    groups?: GroupInfo[],
  ): Promise<void> {
    if (this.parentSession) return;
    this.parentSession = session;

    try {
      // With groups: zero API calls. Without (TTL expired): re-fetch using the known groupCodes.
      this.allGroups = groups ?? (await this.fetchAllGroups(groupCodes, session));
    } catch (err) {
      // Reset to clean state so connect() can perform a full login.
      this.parentSession = null;
      this.allGroups = [];
      throw err;
    }
  }

  /**
   * Returns the internal session and enriched group info needed to write the
   * CLI session cache after a successful connect() or group info refresh.
   *
   * @internal Used by the CLI session cache. Not part of the public SDK API.
   */
  getCacheData(): { session: Session; groups: GroupInfo[] } | null {
    if (!this.parentSession || this.allGroups.length === 0) return null;
    return { session: this.parentSession, groups: this.allGroups };
  }

  // ---------------------------------------------------------------------------
  // Private helpers
  // ---------------------------------------------------------------------------

  /**
   * Read the group codes from the user's event log. The API can exhibit
   * eventual consistency: right after login the log may be temporarily empty,
   * so retry up to 3 times with back-off.
   */
  private async discoverGroupCodes(logId: string): Promise<string[]> {
    let groupCodes: string[] = [];
    for (const delay of [0, 2_000, 5_000]) {
      if (delay > 0) await new Promise((r) => setTimeout(r, delay));
      groupCodes = extractGroupCodes(await getUserEvents(logId));
      if (groupCodes.length > 0) break;
    }
    return groupCodes;
  }

  private async fetchAllGroups(groupCodes: string[], session: Session): Promise<GroupInfo[]> {
    return Promise.all(groupCodes.map((code) => this.fetchGroup(code, session)));
  }

  private async fetchGroup(code: string, session: Session): Promise<GroupInfo> {
    const info = parseGroupInfo(code, await getGroupEvents(code));
    try {
      const descriptions = await getGroupMemberDescriptions(code, session.logId, session.authToken);
      const byPublicId = new Map(descriptions.map((d) => [d.publicId, d]));
      for (const member of info.members) {
        const desc = byPublicId.get(member.publicId);
        if (desc) {
          member.displayName = desc.displayName;
          member.logId = desc.logId;
        }
      }
    } catch {
      // Non-fatal: members will have no displayName/logId
    }
    return info;
  }

  private requireParent(): Session {
    if (!this.parentSession) {
      throw new Error('Not connected. Call connect() first.');
    }
    return this.parentSession;
  }

  /**
   * Return the GroupInfo to operate on.
   * Priority: explicit groupName arg > config.groupName > first group.
   */
  private requireGroup(groupName?: string): GroupInfo {
    return selectGroup(this.allGroups, groupName ?? this.config.groupName);
  }

  /** Find a pupil by display name or publicId within the configured group. */
  private resolveChild(name: string, groupName?: string): ResolvedChild {
    return findChild(this.requireGroup(groupName), name);
  }

  /** The publicId of the named child, or the given childPublicId when no name is given. */
  private childPublicIdOf(opts: {
    childName?: string;
    childPublicId?: string;
    groupName?: string;
  }): string | undefined {
    return opts.childName
      ? this.resolveChild(opts.childName, opts.groupName).publicId
      : opts.childPublicId;
  }

  /** Fetch all events of a child, using logId (family groups) or publicId+groupCode (class groups). */
  private async fetchChildEvents(child: ResolvedChild, since = EPOCH): Promise<AntonEvent[]> {
    const parent = this.requireParent();
    if (child.logId) return getUserEvents(child.logId, since);
    const events = await getGroupMemberEvents(
      child.publicId,
      child.groupCode,
      parent.logId,
      parent.authToken,
    );
    return since === EPOCH ? events : events.filter((e) => e.created >= since);
  }

  /** Fetch the finishLevel events of a child. */
  private async getChildEvents(child: ResolvedChild, since = EPOCH): Promise<FinishLevelEvent[]> {
    return onlyFinishLevel(await this.fetchChildEvents(child, since));
  }

  /** Fetch the pins currently set in a group. */
  private async fetchPins(group: GroupInfo): Promise<PinnedBlock[]> {
    return parsePinnedBlocks(await getGroupEvents(group.groupCode));
  }

  // ---------------------------------------------------------------------------
  // Status
  // ---------------------------------------------------------------------------

  /** Return current auth and group status (synchronous — no network call). */
  getStatus(opts?: { groupName?: string }) {
    const group = opts?.groupName
      ? this.requireGroup(opts.groupName)
      : defaultGroup(this.allGroups, this.config.groupName);
    const parent = this.parentSession;
    return {
      parent: parent
        ? { displayName: parent.displayName, logId: parent.logId, loginCode: parent.loginCode }
        : null,
      groups: this.allGroups.map((g) => ({
        groupCode: g.groupCode,
        groupName: g.groupName,
        groupType: g.groupType,
        memberCount: g.members.length,
        isPlus: g.isPlus,
        plusValidUntil: g.plusValidUntil,
      })),
      children: group ? childrenOf(group) : [],
    };
  }

  // ---------------------------------------------------------------------------
  // Groups
  // ---------------------------------------------------------------------------

  /** List all groups the parent account belongs to, with their members. */
  listGroups() {
    return this.allGroups.map((g) => ({
      groupCode: g.groupCode,
      groupName: g.groupName,
      groupType: g.groupType,
      isPlus: g.isPlus,
      plusValidUntil: g.plusValidUntil,
      members: g.members.map((m) => ({
        publicId: m.publicId,
        role: m.role,
        displayName: m.displayName,
        logId: m.logId,
      })),
    }));
  }

  /** Fetch fresh group info + currently pinned blocks. */
  async getGroup(opts?: { groupName?: string }) {
    const group = this.requireGroup(opts?.groupName);
    const groupEvents = await getGroupEvents(group.groupCode);
    const pinnedBlocks = parsePinnedBlocks(groupEvents);
    const freshGroup = parseGroupInfo(group.groupCode, groupEvents);

    // Re-apply cached displayName/logId enrichment — the fresh parse from events
    // only has publicIds; enrichment requires a separate API call done at connect time.
    const enrichedById = new Map(group.members.map((m) => [m.publicId, m]));
    const members = freshGroup.members.map((m) => {
      const cached = enrichedById.get(m.publicId);
      return cached == null ? m : { ...m, displayName: cached.displayName, logId: cached.logId };
    });

    return { ...freshGroup, members, pinnedBlocks };
  }

  /** List all pinned blocks (assignments) in the group, with optional filters. */
  async getGroupAssignments(opts?: { childPublicId?: string; week?: string; groupName?: string }) {
    const pins = await this.fetchPins(this.requireGroup(opts?.groupName));
    return filterPinnedBlocks(pins, { childPublicId: opts?.childPublicId, week: opts?.week });
  }

  /**
   * Assign a lesson block to the group or a specific child.
   *
   * Identify the block either by (project + topic + block) lookup or
   * directly by (blockPuid + blockPath).
   */
  async pinBlock(
    opts: BlockQuery & {
      project?: string;
      blockPuid?: string;
      blockPath?: string;
      weekStartAt?: string;
      childName?: string;
      childPublicId?: string;
      groupName?: string;
    },
  ) {
    const parent = this.requireParent();
    const group = this.requireGroup(opts.groupName);
    const childPublicId = this.childPublicIdOf(opts);

    const { blockPuid, blockPath } = opts.project
      ? resolveBlockRef(opts.project, await getPlan(opts.project), opts)
      : opts;
    if (!blockPuid || !blockPath) {
      throw new Error(
        'Provide either (project + topicIndex/topicTitle + blockIndex/blockTitle) or (blockPuid + blockPath)',
      );
    }

    const weekStartAt = opts.weekStartAt ?? currentWeekMonday();
    await pinGroupBlock(
      { groupCode: group.groupCode, blockPuid, blockPath, weekStartAt, childPublicId },
      parent.logId,
      parent.authToken,
    );

    return {
      pinned: true,
      groupCode: group.groupCode,
      blockPuid,
      blockPath,
      weekStartAt,
      childPublicId: childPublicId ?? null,
    };
  }

  /** Remove a pinned block from the group. */
  async unpinBlock(opts: {
    blockPuid: string;
    weekStartAt: string;
    childPublicId?: string;
    groupName?: string;
  }) {
    const parent = this.requireParent();
    const group = this.requireGroup(opts.groupName);
    const match = findPin(await this.fetchPins(group), opts);
    await unpinGroupBlock(group.groupCode, match.created, parent.logId, parent.authToken);
    return {
      unpinned: true,
      groupCode: group.groupCode,
      blockPuid: opts.blockPuid,
      weekStartAt: opts.weekStartAt,
    };
  }

  // ---------------------------------------------------------------------------
  // Children
  // ---------------------------------------------------------------------------

  /** List all pupil members of the family group. */
  listChildren(opts?: { groupName?: string }) {
    return childrenOf(this.requireGroup(opts?.groupName));
  }

  // ---------------------------------------------------------------------------
  // Progress / Events
  // ---------------------------------------------------------------------------

  /** Summarise completed levels and stars for a child. */
  async getProgress(opts: { childName: string; since?: string; groupName?: string }) {
    const child = this.resolveChild(opts.childName, opts.groupName);
    const events = await this.fetchChildEvents(child, opts.since);
    return summariseProgress(child.logId ?? child.publicId, events);
  }

  /** Fetch raw event log for a child. */
  async getEvents(opts: {
    childName: string;
    since?: string;
    eventType?: string;
    limit?: number;
    groupName?: string;
  }) {
    const child = this.resolveChild(opts.childName, opts.groupName);
    const events = await this.fetchChildEvents(child, opts.since);
    return events
      .filter((e) => !opts.eventType || e.event === opts.eventType)
      .sort((a, b) => b.created.localeCompare(a.created))
      .slice(0, opts.limit ?? 100);
  }

  /** Get per-level performance data from the reviewReport endpoint. */
  async getLevelProgress(opts: {
    levelPuid: string;
    childName?: string;
    childPublicId?: string;
    groupName?: string;
  }) {
    const parent = this.requireParent();
    const childPublicId = this.childPublicIdOf(opts);
    if (!childPublicId) throw new Error('Provide childName or childPublicId');
    return getLevelReviewReport(opts.levelPuid, childPublicId, parent.logId, parent.authToken);
  }

  // ---------------------------------------------------------------------------
  // Lesson catalogue
  // ---------------------------------------------------------------------------

  /** List all available Anton courses (~285 plans). */
  async listPlans(opts?: { subject?: string; grade?: number; language?: string }) {
    return filterPlans(await getPlansCatalogue(), opts);
  }

  /** List topic titles + indices for a course (lightweight, no blocks). */
  async listTopics(opts: { project: string }) {
    const plan = await getPlan(opts.project);
    return {
      project: plan.project,
      title: plan.title,
      topics: plan.topics.map((t, i) => ({
        index: i,
        title: t.title,
        puid: t.puid,
        totalBlocks: t.blocks.length,
      })),
    };
  }

  /** Fetch all blocks (and levels) for a single topic within a course. */
  async getTopicBlocks(opts: { project: string; topicIndex?: number; topicTitle?: string }) {
    const plan = await getPlan(opts.project);
    const topic = pickByIndexOrTitle(
      plan.topics,
      'Topic',
      opts.topicIndex,
      opts.topicTitle,
      'Provide topicIndex or topicTitle',
    );
    return {
      project: opts.project,
      topicTitle: topic.title,
      topicPuid: topic.puid,
      blocks: buildTopicBlocks(opts.project, topic),
    };
  }

  /** Fetch the full topic→block→level hierarchy for a course. */
  async getPlan(opts: { project: string }) {
    const plan = await getPlan(opts.project);
    return {
      title: plan.title,
      project: plan.project,
      totalBlocks: plan.totalBlocks,
      totalLevels: plan.totalLevels,
      topics: plan.topics.map((t) => ({
        title: t.title,
        puid: t.puid,
        blocks: buildTopicBlocks(opts.project, t),
      })),
    };
  }

  /** Fetch lesson content (questions/trainers) by fileId. */
  async getLesson(opts: { fileId: string }) {
    return getLessonContent(opts.fileId);
  }

  // ---------------------------------------------------------------------------
  // Analysis
  // ---------------------------------------------------------------------------

  /** Check which assigned blocks a child has completed. */
  async checkAssignmentCompletion(opts: { childName: string; week?: string; groupName?: string }) {
    const child = this.resolveChild(opts.childName, opts.groupName);
    const pinnedBlocks = await this.fetchPins(this.requireGroup(opts.groupName));

    const relevant = filterPinnedBlocks(pinnedBlocks, {
      childPublicId: child.publicId,
      week: opts.week,
    });
    const projects = Array.from(new Set(relevant.map((b) => projectOf(b.puid))));
    const plans = await Promise.all(projects.map((p) => getPlan(p)));
    const planCache = new Map(projects.map((p, i) => [p, plans[i]]));

    const finishEvents = await this.getChildEvents(child);
    return checkAssignmentCompletion(child.displayName, pinnedBlocks, planCache, finishEvents, {
      week: opts.week,
      publicId: child.publicId,
    });
  }

  /** Weekly rollup of a child's activity. */
  async getWeeklySummary(opts: { childName: string; weekStartAt?: string; groupName?: string }) {
    const child = this.resolveChild(opts.childName, opts.groupName);
    const weekStartAt = opts.weekStartAt ?? currentWeekMonday();
    const pins = filterPinnedBlocks(await this.fetchPins(this.requireGroup(opts.groupName)), {
      childPublicId: child.publicId,
      week: weekStartAt,
    });
    const assignedBlockPuids = new Set(pins.map((b) => b.puid));
    const finishEvents = await this.getChildEvents(child);
    return getWeeklySummary(child.displayName, weekStartAt, finishEvents, assignedBlockPuids);
  }

  /** Per-subject accuracy, stars, time, and trend. */
  async getSubjectSummary(opts: { childName: string; subject?: string; groupName?: string }) {
    const child = this.resolveChild(opts.childName, opts.groupName);
    const finishEvents = await this.getChildEvents(child);
    return getSubjectSummary(child.displayName, finishEvents, opts.subject);
  }

  /** Active days, streaks, gaps, and daily breakdown. */
  async getActivityTimeline(opts: { childName: string; since?: string; groupName?: string }) {
    const since = opts.since ?? EPOCH;
    const child = this.resolveChild(opts.childName, opts.groupName);
    const finishEvents = await this.getChildEvents(child, since);
    return getActivityTimeline(child.displayName, finishEvents, since);
  }

  /** Side-by-side comparison of all children in a group. */
  async compareChildren(opts?: { groupName?: string }) {
    const group = this.requireGroup(opts?.groupName);
    const rows = await Promise.all(
      pupilsOf(group).map(async (m) => {
        const child = toResolvedChild(m, group, m.publicId);
        const finishEvents = await this.getChildEvents(child);
        return { name: child.displayName, finishEvents };
      }),
    );
    return compareChildren(rows);
  }

  // ---------------------------------------------------------------------------
  // Local assignments
  // ---------------------------------------------------------------------------

  /** List local assignments (from the JSON store). */
  listAssignments(opts?: { childName?: string; status?: AssignmentStatus }): Assignment[] {
    return listAssignments(opts);
  }

  /** Create a local assignment. */
  assignLesson(params: {
    childName: string;
    fileId: string;
    lessonTitle?: string;
    note?: string;
  }): Assignment {
    return createAssignment(params);
  }

  /** Update a local assignment (status, note). */
  updateAssignment(
    id: string,
    updates: { status?: AssignmentStatus; note?: string; lessonTitle?: string },
  ): Assignment {
    return updateAssignmentStore(id, updates);
  }

  /** Delete a local assignment. */
  deleteAssignment(id: string): void {
    deleteAssignmentStore(id);
  }
}
