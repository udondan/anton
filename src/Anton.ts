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
 * const status = await anton.getStatus();
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
  getWeeklySummary,
  getSubjectSummary,
  getActivityTimeline,
  compareChildren,
} from './analysis.js';
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

interface ResolvedChild {
  logId?: string;
  publicId: string;
  displayName: string;
  groupCode: string;
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
      // The API can exhibit eventual consistency: right after login the user-events
      // log may be temporarily empty.  Retry up to 3 times with back-off.
      let groupCodes: string[] = [];
      const delays = [0, 2_000, 5_000];
      for (const delay of delays) {
        if (delay > 0) await new Promise((r) => setTimeout(r, delay));
        const userEvents = await getUserEvents(this.parentSession.logId);
        groupCodes = extractGroupCodes(userEvents);
        if (groupCodes.length > 0) break;
      }
      if (groupCodes.length > 0) {
        this.allGroups = await this.fetchAllGroups(groupCodes, this.parentSession);
      }
    } catch (err) {
      throw new Error(`Failed to load family group: ${(err as Error).message}`);
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

    if (groups) {
      // Zero API calls — restore group membership from cache.
      this.allGroups = groups;
      return;
    }

    // Group info TTL expired — re-fetch using the known groupCodes.
    this.allGroups = await this.fetchAllGroups(groupCodes, session);
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

  private async fetchAllGroups(groupCodes: string[], session: Session): Promise<GroupInfo[]> {
    return Promise.all(
      groupCodes.map(async (code) => {
        const events = await getGroupEvents(code);
        const info = parseGroupInfo(code, events);
        try {
          const descriptions = await getGroupMemberDescriptions(
            code,
            session.logId,
            session.authToken,
          );
          const byPublicId = new Map(descriptions.map((d) => [d.publicId, d]));
          for (const member of info.members) {
            const desc = byPublicId.get(member.publicId);
            if (desc) {
              member.displayName = desc.displayName;
              member.logId = desc.logId;
            }
          }
        } catch (err) {
          console.warn(`[anton] Could not fetch member descriptions for group ${code}: ${(err as Error).message}`);
        }
        return info;
      }),
    );
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
    if (this.allGroups.length === 0) {
      throw new Error('Family group not loaded. Call connect() first.');
    }
    const name = groupName ?? this.config.groupName;
    if (name) {
      const found = this.allGroups.find(
        (g) => g.groupName.toLowerCase() === name.toLowerCase(),
      );
      if (!found) {
        throw new Error(
          `Group "${name}" not found. Available groups: ${this.allGroups.map((g) => g.groupName).join(', ')}`,
        );
      }
      return found;
    }
    return this.allGroups[0]!;
  }

  private getDefaultGroup(): GroupInfo | null {
    if (this.allGroups.length === 0) return null;
    const name = this.config.groupName;
    if (name) {
      return (
        this.allGroups.find((g) => g.groupName.toLowerCase() === name.toLowerCase()) ??
        this.allGroups[0]!
      );
    }
    return this.allGroups[0]!;
  }

  /** Find a child by display name within the configured group. */
  private resolveChild(name: string, groupName?: string): ResolvedChild {
    const group = this.requireGroup(groupName);
    const m = group.members.find(
      (mem) => mem.displayName?.toLowerCase() === name.toLowerCase(),
    );
    if (!m) {
      throw new Error(`Child "${name}" not found in group "${group.groupName}". Use listChildren() to see member names.`);
    }
    return { logId: m.logId, publicId: m.publicId, displayName: m.displayName ?? name, groupCode: group.groupCode };
  }

  /** Fetch events for a child, using logId (family groups) or publicId+groupCode (class groups). */
  private async getChildEvents(child: ResolvedChild, since = '1970-01-01'): Promise<FinishLevelEvent[]> {
    const parent = this.requireParent();
    let events: AntonEvent[];
    if (child.logId) {
      events = await getUserEvents(child.logId, since);
    } else {
      events = await getGroupMemberEvents(child.publicId, child.groupCode, parent.logId, parent.authToken);
      if (since !== '1970-01-01') {
        events = events.filter((e) => (e.created ?? '') >= since);
      }
    }
    return events.filter((e): e is FinishLevelEvent => e.event === 'finishLevel');
  }

  private currentWeekMonday(): string {
    const now = new Date();
    const day = now.getDay();
    const diff = day === 0 ? -6 : 1 - day;
    now.setDate(now.getDate() + diff);
    return now.toISOString().slice(0, 10);
  }

  // ---------------------------------------------------------------------------
  // Status
  // ---------------------------------------------------------------------------

  /** Return current auth and group status (synchronous — no network call). */
  getStatus(opts?: { groupName?: string }) {
    const defaultGroup = opts?.groupName ? this.requireGroup(opts.groupName) : this.getDefaultGroup();
    return {
      parent: this.parentSession
        ? {
            displayName: this.parentSession.displayName,
            logId: this.parentSession.logId,
            loginCode: this.parentSession.loginCode,
          }
        : null,
      group: defaultGroup
        ? {
            groupCode: defaultGroup.groupCode,
            groupName: defaultGroup.groupName,
            groupType: defaultGroup.groupType,
            memberCount: defaultGroup.members.length,
            isPlus: defaultGroup.isPlus,
            plusValidUntil: defaultGroup.plusValidUntil,
          }
        : null,
      totalGroups: this.allGroups.length,
      children:
        defaultGroup?.members
          .filter((m) => m.role === 'pupil')
          .map((m) => ({
            displayName: m.displayName,
            publicId: m.publicId,
            logId: m.logId,
          })) ?? [],
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
    return { ...freshGroup, pinnedBlocks };
  }

  /** List all pinned blocks (assignments) in the group, with optional filters. */
  async getGroupAssignments(opts?: {
    childPublicId?: string;
    week?: string;
    groupName?: string;
  }) {
    const group = this.requireGroup(opts?.groupName);
    const groupEvents = await getGroupEvents(group.groupCode);
    let blocks = parsePinnedBlocks(groupEvents);
    if (opts?.childPublicId) {
      blocks = blocks.filter(
        (b) => b.subgroup === opts.childPublicId || b.subgroup == null,
      );
    }
    if (opts?.week) {
      blocks = blocks.filter((b) => b.weekStartAt === opts.week);
    }
    return blocks;
  }

  /**
   * Assign a lesson block to the group or a specific child.
   *
   * Identify the block either by (project + topic + block) lookup or
   * directly by (blockPuid + blockPath).
   */
  async pinBlock(opts: {
    project?: string;
    topicIndex?: number;
    topicTitle?: string;
    blockIndex?: number;
    blockTitle?: string;
    blockPuid?: string;
    blockPath?: string;
    weekStartAt?: string;
    childName?: string;
    childPublicId?: string;
    groupName?: string;
  }) {
    const parent = this.requireParent();
    const group = this.requireGroup(opts.groupName);

    let childPublicId = opts.childPublicId;
    if (opts.childName) {
      const match = group.members.find(
        (m) => m.displayName?.toLowerCase() === opts.childName!.toLowerCase(),
      );
      if (!match) {
        throw new Error(`Child "${opts.childName}" not found. Use getGroup() to see member names.`);
      }
      childPublicId = match.publicId;
    }

    let blockPuid = opts.blockPuid;
    let blockPath = opts.blockPath;

    if (opts.project) {
      const plan = await getPlan(opts.project);
      const topics = plan.topics ?? [];

      let topic: (typeof topics)[0] | undefined;
      if (opts.topicIndex != null) {
        topic = topics[opts.topicIndex];
        if (!topic) {
          throw new Error(
            `Topic index ${opts.topicIndex} out of range (0–${topics.length - 1})`,
          );
        }
      } else if (opts.topicTitle) {
        const needle = opts.topicTitle.toLowerCase();
        topic = topics.find((t) => t.title.toLowerCase().includes(needle));
        if (!topic) throw new Error(`No topic matching "${opts.topicTitle}"`);
      } else {
        throw new Error('Provide topicIndex or topicTitle when using project-based lookup');
      }

      const blocks = topic.blocks ?? [];
      let block: (typeof blocks)[0] | undefined;
      if (opts.blockIndex != null) {
        block = blocks[opts.blockIndex];
        if (!block) {
          throw new Error(`Block index ${opts.blockIndex} out of range (0–${blocks.length - 1})`);
        }
      } else if (opts.blockTitle) {
        const needle = opts.blockTitle.toLowerCase();
        block = blocks.find((b) => b.title.toLowerCase().includes(needle));
        if (!block) throw new Error(`No block matching "${opts.blockTitle}"`);
      } else {
        throw new Error('Provide blockIndex or blockTitle when using project-based lookup');
      }

      blockPuid = block.puid;
      blockPath = `/../${opts.project}/${topic.puid?.split('/')[1] ?? 'topic'}/${block.puid?.split('/')[1] ?? 'block'}/block`;
    }

    if (!blockPuid || !blockPath) {
      throw new Error(
        'Provide either (project + topicIndex/topicTitle + blockIndex/blockTitle) or (blockPuid + blockPath)',
      );
    }

    const weekStartAt = opts.weekStartAt ?? this.currentWeekMonday();

    await pinGroupBlock(
      group.groupCode,
      blockPuid,
      blockPath,
      weekStartAt,
      parent.logId,
      parent.authToken,
      childPublicId,
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
    const groupEvents = await getGroupEvents(group.groupCode);
    const pins = parsePinnedBlocks(groupEvents);
    const match = pins.find(
      (p) =>
        p.puid === opts.blockPuid &&
        p.weekStartAt === opts.weekStartAt &&
        (opts.childPublicId == null || p.subgroup === opts.childPublicId),
    );
    if (!match) {
      throw new Error(`No pin found for puid=${opts.blockPuid} week=${opts.weekStartAt}`);
    }
    await unpinGroupBlock(group.groupCode, match.created, parent.logId, parent.authToken);
    return { unpinned: true, groupCode: group.groupCode, blockPuid: opts.blockPuid, weekStartAt: opts.weekStartAt };
  }

  // ---------------------------------------------------------------------------
  // Children
  // ---------------------------------------------------------------------------

  /** List all pupil members of the family group. */
  listChildren(opts?: { groupName?: string }) {
    const group = this.requireGroup(opts?.groupName);
    return group.members
      .filter((m) => m.role === 'pupil')
      .map((m) => ({ displayName: m.displayName, publicId: m.publicId, logId: m.logId }));
  }

  // ---------------------------------------------------------------------------
  // Progress / Events
  // ---------------------------------------------------------------------------

  /** Summarise completed levels and stars for a child. */
  async getProgress(opts: { childName: string; since?: string; groupName?: string }) {
    const since = opts.since ?? '1970-01-01';
    const child = this.resolveChild(opts.childName, opts.groupName);
    const parent = this.requireParent();
    let events: AntonEvent[];
    if (child.logId) {
      events = await getUserEvents(child.logId, since);
    } else {
      events = await getGroupMemberEvents(child.publicId, child.groupCode, parent.logId, parent.authToken);
      if (since !== '1970-01-01') events = events.filter((e) => (e.created ?? '') >= since);
    }
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
    const since = opts.since ?? '1970-01-01';
    const limit = opts.limit ?? 100;
    const child = this.resolveChild(opts.childName, opts.groupName);
    const parent = this.requireParent();
    let events: AntonEvent[];
    if (child.logId) {
      events = await getUserEvents(child.logId, since);
    } else {
      events = await getGroupMemberEvents(child.publicId, child.groupCode, parent.logId, parent.authToken);
      if (since !== '1970-01-01') events = events.filter((e) => (e.created ?? '') >= since);
    }
    if (opts.eventType) events = events.filter((e) => e.event === opts.eventType);
    return events.slice(0, limit);
  }

  /** Get per-level performance data from the reviewReport endpoint. */
  async getLevelProgress(opts: {
    levelPuid: string;
    childName?: string;
    childPublicId?: string;
    groupName?: string;
  }) {
    const parent = this.requireParent();
    let childPublicId = opts.childPublicId;
    if (opts.childName) {
      childPublicId = this.resolveChild(opts.childName, opts.groupName).publicId;
    }
    if (!childPublicId) throw new Error('Provide childName or childPublicId');
    return getLevelReviewReport(opts.levelPuid, childPublicId, parent.logId, parent.authToken);
  }

  // ---------------------------------------------------------------------------
  // Lesson catalogue
  // ---------------------------------------------------------------------------

  /** List all available Anton courses (~285 plans). */
  async listPlans(opts?: { subject?: string; grade?: number; language?: string }) {
    const plans = await getPlansCatalogue();
    const language = opts?.language ?? 'de';
    const subject = opts?.subject?.toLowerCase();
    const grade = opts?.grade;

    return plans
      .filter((p) => !p.isDebug)
      .filter((p) => (p.guiLanguages ?? []).includes(language))
      .filter((p) => {
        if (!subject) return true;
        const s =
          typeof p.subject === 'string'
            ? p.subject
            : (p.subject as Record<string, string>)[language] ?? '';
        return s.toLowerCase().includes(subject);
      })
      .filter((p) => {
        if (grade == null) return true;
        return (p.grades ?? []).includes(grade);
      })
      .map((p) => ({
        project: p.project,
        title:
          typeof p.title === 'string' ? p.title : (p.title as Record<string, string>)[language],
        subject:
          typeof p.subject === 'string'
            ? p.subject
            : (p.subject as Record<string, string>)[language],
        grades: p.grades,
        totalBlocks: p.totalBlocks,
        totalLevels: p.totalLevels,
      }));
  }

  /** List topic titles + indices for a course (lightweight, no blocks). */
  async listTopics(opts: { project: string }) {
    const plan = await getPlan(opts.project);
    return {
      project: plan.project,
      title: plan.title,
      topics: (plan.topics ?? []).map((t, i) => ({
        index: i,
        title: t.title,
        puid: t.puid,
        totalBlocks: (t.blocks ?? []).length,
      })),
    };
  }

  /** Fetch all blocks (and levels) for a single topic within a course. */
  async getTopicBlocks(opts: {
    project: string;
    topicIndex?: number;
    topicTitle?: string;
  }) {
    const plan = await getPlan(opts.project);
    const topics = plan.topics ?? [];

    let topic: (typeof topics)[0] | undefined;
    if (opts.topicIndex != null) {
      topic = topics[opts.topicIndex];
      if (!topic) {
        throw new Error(`Topic index ${opts.topicIndex} out of range (0–${topics.length - 1})`);
      }
    } else if (opts.topicTitle) {
      const needle = opts.topicTitle.toLowerCase();
      topic = topics.find((t) => t.title.toLowerCase().includes(needle));
      if (!topic) throw new Error(`No topic matching "${opts.topicTitle}"`);
    } else {
      throw new Error('Provide topicIndex or topicTitle');
    }

    return {
      project: opts.project,
      topicTitle: topic.title,
      topicPuid: topic.puid,
      blocks: this.buildTopicBlocks(opts.project, topic),
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
      topics: (plan.topics ?? []).map((t) => ({
        title: t.title,
        puid: t.puid,
        blocks: this.buildTopicBlocks(opts.project, t),
      })),
    };
  }

  /** Fetch lesson content (questions/trainers) by fileId. */
  async getLesson(opts: { fileId: string }) {
    return getLessonContent(opts.fileId);
  }

  private buildTopicBlocks(
    project: string,
    t: {
      title: string;
      puid: string;
      blocks?: Array<{
        title: string;
        puid: string;
        levels?: Array<{ title: string; puid: string; type?: string; path?: string }>;
      }>;
    },
  ) {
    return (t.blocks ?? []).map((b) => ({
      title: b.title,
      puid: b.puid,
      blockPath: `/../${project}/${t.puid?.split('/')[1] ?? 'topic'}/${b.puid?.split('/')[1] ?? 'block'}/block`,
      totalLevels: (b.levels ?? []).length,
      levels: (b.levels ?? []).map((lv) => ({
        title: lv.title,
        puid: lv.puid,
        type: lv.type,
        ...(lv.path ? { fileId: `level${lv.path.replace('/..', '')}` } : {}),
      })),
    }));
  }

  // ---------------------------------------------------------------------------
  // Analysis
  // ---------------------------------------------------------------------------

  /** Check which assigned blocks a child has completed. */
  async checkAssignmentCompletion(opts: {
    childName: string;
    week?: string;
    groupName?: string;
  }) {
    const child = this.resolveChild(opts.childName, opts.groupName);
    const group = this.requireGroup(opts.groupName);
    const groupEvents = await getGroupEvents(group.groupCode);
    const pinnedBlocks = parsePinnedBlocks(groupEvents);

    const relevant = pinnedBlocks.filter(
      (b) => b.subgroup == null || b.subgroup === child.publicId,
    );
    const filtered = opts.week ? relevant.filter((b) => b.weekStartAt === opts.week) : relevant;

    const projects = Array.from(new Set(filtered.map((b) => b.puid.split('/')[0]!)));
    const plans = await Promise.all(projects.map((p) => getPlan(p)));
    const planCache = new Map(projects.map((p, i) => [p, plans[i]!]));

    const finishEvents = await this.getChildEvents(child);

    return checkAssignmentCompletion(
      child.displayName,
      pinnedBlocks,
      planCache,
      finishEvents,
      opts.week,
      child.publicId,
    );
  }

  /** Weekly rollup of a child's activity. */
  async getWeeklySummary(opts: {
    childName: string;
    weekStartAt?: string;
    groupName?: string;
  }) {
    const child = this.resolveChild(opts.childName, opts.groupName);
    const weekStartAt = opts.weekStartAt ?? this.currentWeekMonday();

    const group = this.requireGroup(opts.groupName);
    const groupEvents = await getGroupEvents(group.groupCode);
    const pinnedBlocks = parsePinnedBlocks(groupEvents).filter(
      (b) => b.weekStartAt === weekStartAt && (b.subgroup == null || b.subgroup === child.publicId),
    );
    const assignedBlockPuids = new Set(pinnedBlocks.map((b) => b.puid));
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
    const since = opts.since ?? '1970-01-01';
    const child = this.resolveChild(opts.childName, opts.groupName);
    const finishEvents = await this.getChildEvents(child, since);
    return getActivityTimeline(child.displayName, finishEvents, since);
  }

  /** Side-by-side comparison of all children in a group. */
  async compareChildren(opts?: { groupName?: string }) {
    const group = this.requireGroup(opts?.groupName);
    const parent = this.requireParent();
    const pupils = group.members.filter((m) => m.role === 'pupil');
    const rows = await Promise.all(
      pupils.map(async (m) => {
        const child: ResolvedChild = {
          logId: m.logId,
          publicId: m.publicId,
          displayName: m.displayName ?? m.publicId,
          groupCode: group.groupCode,
        };
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
