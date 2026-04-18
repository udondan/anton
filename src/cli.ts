#!/usr/bin/env node
/**
 * Anton CLI
 *
 * Usage:
 *   anton [--group name] mcp                              Start the MCP server (stdio)
 *   anton [--group name] status                           Auth and group status
 *   anton [--group name] groups                           List all groups the parent belongs to
 *   anton [--group name] group                            Family group + pinned blocks
 *   anton [--group name] children                         List children in the group
 *   anton [--group name] pins [--week date] [--child n]   Group assignments (pinned blocks)
 *   anton [--group name] pin <project> [options]          Assign a block to the group
 *   anton [--group name] unpin <blockPuid> <weekStartAt>  Remove a pinned block
 *   anton [--group name] plans [--subject s] [-g n]       Browse lesson catalogue
 *   anton [--group name] topics <project>                 List topics for a course
 *   anton [--group name] blocks <project> [options]       List blocks in a topic
 *   anton [--group name] plan <project>                   Full topic→block→level hierarchy
 *   anton [--group name] lesson <fileId>                  Lesson content
 *   anton [--group name] progress <child>                 Progress summary for a child
 *   anton [--group name] events <child> [--type t] [-n n] Raw event log for a child
 *   anton [--group name] level-progress <levelPuid> <child> Per-level performance
 *   anton [--group name] weekly <child> [--week date]     Weekly activity summary
 *   anton [--group name] subjects <child> [--subject s]   Per-subject accuracy and trend
 *   anton [--group name] timeline <child> [--since date]  Active days, streaks, gaps
 *   anton [--group name] completion <child> [--week date] Assignment completion status
 *   anton [--group name] compare                          Side-by-side child comparison
 *   anton assignments [--child name] [--status]           Local assignment list
 *   anton assign <child> <fileId>                         Create a local assignment
 *   anton update-assignment <id> [--status s]             Update a local assignment
 *   anton delete-assignment <id>                          Delete a local assignment
 *
 * Configuration (environment variables):
 *   ANTON_LOGIN_CODE   Parent 8-character login code (required)
 *   ANTON_LOG_ID       Alternative: parent log ID
 *   ANTON_GROUP        Default group name when parent belongs to multiple groups
 *                      (overridden by the global --group flag)
 */

import { Command } from 'commander';
import { Anton } from './Anton.js';
import { startMcpServer } from './mcp.js';
import { clearCache, isGroupInfoFresh, readCache, updateGroupInfoCache, writeCache } from './session-cache.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function err(msg: string): void {
  process.stderr.write(`[anton] ${msg}\n`);
}

function loadAnton(): Anton {
  const loginCode = process.env['ANTON_LOGIN_CODE'];
  const logId = process.env['ANTON_LOG_ID'];
  // Global --group flag takes precedence over ANTON_GROUP env var.
  const groupName = program.opts<{ group?: string }>().group ?? process.env['ANTON_GROUP'];

  if (!loginCode && !logId) {
    err('No credentials configured. Set ANTON_LOGIN_CODE=<code> or ANTON_LOG_ID=<id>.');
    process.exit(1);
  }

  return new Anton({ loginCode, logId, groupName });
}

/**
 * Connect the Anton instance, using the session cache when available.
 *
 * Cache is skipped when:
 *   - the global --no-cache flag is passed, or
 *   - ANTON_NO_SESSION_CACHE=1 is set in the environment.
 *
 * On a cache hit the login + getUserEvents round-trips are skipped; fresh
 * group events and member descriptions are still fetched from the API.
 * If the cached token turns out to be stale, the cache is cleared and a
 * full login is performed transparently.
 */
async function connectAnton(anton: Anton): Promise<void> {
  const { cache: useCache } = program.opts<{ cache: boolean }>();
  const noCache = !useCache || process.env['ANTON_NO_SESSION_CACHE'] === '1';

  const credential = process.env['ANTON_LOGIN_CODE'] ?? process.env['ANTON_LOG_ID'];

  if (!noCache && credential) {
    const cached = readCache(credential);
    if (cached) {
      const fresh = isGroupInfoFresh(cached);
      try {
        // Always pass all groupCodes (available even on stale entries).
        // Pass groups only when within the 10-minute TTL — otherwise
        // connectFromCache re-fetches all groups using the known groupCodes.
        await anton.connectFromCache(
          cached.session,
          cached.groups.map((g) => g.groupCode),
          fresh ? cached.groups : undefined,
        );
        // If group info was re-fetched, update just that part of the cache
        // (session remains untouched).
        if (!fresh) {
          const data = anton.getCacheData();
          if (data) updateGroupInfoCache(cached, data.groups);
        }
        return;
      } catch {
        // Session is no longer valid — clear it and fall through to full login.
        clearCache();
      }
    }
  }

  await anton.connect();

  // Persist the full session + group info for future invocations.
  if (!noCache && credential) {
    const data = anton.getCacheData();
    if (data) writeCache(credential, data.session, data.groups);
  }
}

function print(data: unknown): void {
  console.log(JSON.stringify(data, null, 2));
}

// ---------------------------------------------------------------------------
// Program
// ---------------------------------------------------------------------------

const program = new Command();

program
  .name('anton')
  .description("CLI for the @udondan/anton SDK — monitor children's learning on anton.app")
  .version('0.1.0')
  .option('--no-cache', 'Skip the session cache and always perform a fresh login')
  .option('--group <name>', 'Group name to operate on (overrides ANTON_GROUP env var)');

// ── mcp ──────────────────────────────────────────────────────────────────────

program
  .command('mcp')
  .description('Start the Anton MCP server over stdio')
  .action(async () => {
    const anton = loadAnton();
    try {
      await connectAnton(anton);
    } catch (e) {
      err(`Authentication failed: ${(e as Error).message}`);
      process.exit(1);
    }
    await startMcpServer(anton);
  });

// ── status ───────────────────────────────────────────────────────────────────

program
  .command('status')
  .description('Show authentication and family group status')
  .action(async () => {
    const anton = loadAnton();
    await connectAnton(anton);
    print(anton.getStatus());
  });

// ── groups ───────────────────────────────────────────────────────────────────

program
  .command('groups')
  .description('List all groups the parent account belongs to, with their members')
  .action(async () => {
    const anton = loadAnton();
    await connectAnton(anton);
    print(anton.listGroups());
  });

// ── group ────────────────────────────────────────────────────────────────────

program
  .command('group')
  .description('Show family group details and currently pinned blocks')
  .action(async () => {
    const anton = loadAnton();
    await connectAnton(anton);
    print(await anton.getGroup());
  });

// ── children ─────────────────────────────────────────────────────────────────

program
  .command('children')
  .description('List children in the family group')
  .action(async () => {
    const anton = loadAnton();
    await connectAnton(anton);
    print(anton.listChildren());
  });

// ── pins ─────────────────────────────────────────────────────────────────────

program
  .command('pins')
  .description('List lesson blocks currently pinned (assigned) to the group')
  .option('--week <date>', 'Filter to a specific week start date (YYYY-MM-DD Monday)')
  .option('--child <name>', 'Filter to a specific child by name')
  .action(async (opts: { week?: string; child?: string }) => {
    const anton = loadAnton();
    await connectAnton(anton);
    let childPublicId: string | undefined;
    if (opts.child) {
      const children = anton.listChildren();
      const match = children.find(
        (c) => c.displayName?.toLowerCase() === opts.child!.toLowerCase(),
      );
      if (!match) {
        err(`Child "${opts.child}" not found.`);
        process.exit(1);
      }
      childPublicId = match.publicId;
    }
    print(await anton.getGroupAssignments({ week: opts.week, childPublicId }));
  });

// ── pin ──────────────────────────────────────────────────────────────────────

program
  .command('pin <project>')
  .description('Assign a lesson block to the group or a specific child')
  .option('--topic-index <n>', 'Topic index (0-based) from anton topics', (v) => parseInt(v, 10))
  .option('--topic-title <title>', 'Partial topic title match (case-insensitive)')
  .option('--block-index <n>', 'Block index (0-based) within the topic', (v) => parseInt(v, 10))
  .option('--block-title <title>', 'Partial block title match (case-insensitive)')
  .option('--week <date>', 'Week start date (YYYY-MM-DD Monday, default: current week)')
  .option('--child <name>', 'Child name to assign to (default: whole group)')
  .action(async (
    project: string,
    opts: { topicIndex?: number; topicTitle?: string; blockIndex?: number; blockTitle?: string; week?: string; child?: string },
  ) => {
    const anton = loadAnton();
    await connectAnton(anton);
    print(await anton.pinBlock({
      project,
      topicIndex: opts.topicIndex,
      topicTitle: opts.topicTitle,
      blockIndex: opts.blockIndex,
      blockTitle: opts.blockTitle,
      weekStartAt: opts.week,
      childName: opts.child,
    }));
  });

// ── unpin ────────────────────────────────────────────────────────────────────

program
  .command('unpin <blockPuid> <weekStartAt>')
  .description('Remove a pinned block from the group')
  .option('--child-id <publicId>', 'Child publicId to disambiguate when multiple pins exist')
  .action(async (blockPuid: string, weekStartAt: string, opts: { childId?: string }) => {
    const anton = loadAnton();
    await connectAnton(anton);
    print(await anton.unpinBlock({ blockPuid, weekStartAt, childPublicId: opts.childId }));
  });

// ── plans ────────────────────────────────────────────────────────────────────

program
  .command('plans')
  .description('Browse the Anton lesson catalogue (~285 courses)')
  .option('-s, --subject <code>', 'Filter by subject (e.g. mat, natdeu, eng)')
  .option('-g, --grade <n>', 'Filter by grade (1–13)', (v) => parseInt(v, 10))
  .option('-l, --language <lang>', 'Filter by language (default: de)', 'de')
  .action(async (opts: { subject?: string; grade?: number; language?: string }) => {
    const anton = loadAnton();
    await connectAnton(anton);
    print(await anton.listPlans(opts));
  });

// ── topics ───────────────────────────────────────────────────────────────────

program
  .command('topics <project>')
  .description('List topics (chapters) for a course')
  .action(async (project: string) => {
    const anton = loadAnton();
    await connectAnton(anton);
    print(await anton.listTopics({ project }));
  });

// ── blocks ───────────────────────────────────────────────────────────────────

program
  .command('blocks <project>')
  .description('List blocks (and levels) for a single topic within a course')
  .option('--topic-index <n>', 'Topic index (0-based) from anton topics', (v) => parseInt(v, 10))
  .option('--topic-title <title>', 'Partial topic title match (case-insensitive)')
  .action(async (project: string, opts: { topicIndex?: number; topicTitle?: string }) => {
    const anton = loadAnton();
    await connectAnton(anton);
    print(await anton.getTopicBlocks({ project, ...opts }));
  });

// ── plan ─────────────────────────────────────────────────────────────────────

program
  .command('plan <project>')
  .description('Full topic → block → level hierarchy for a course (can be large)')
  .action(async (project: string) => {
    const anton = loadAnton();
    await connectAnton(anton);
    print(await anton.getPlan({ project }));
  });

// ── lesson ───────────────────────────────────────────────────────────────────

program
  .command('lesson <fileId>')
  .description('Fetch lesson content (questions, trainers) by file ID')
  .action(async (fileId: string) => {
    const anton = loadAnton();
    await connectAnton(anton);
    print(await anton.getLesson({ fileId }));
  });

// ── progress ─────────────────────────────────────────────────────────────────

program
  .command('progress <child>')
  .description('Show learning progress summary for a child')
  .option('--since <date>', 'Start date (YYYY-MM-DD, default: all time)')
  .action(async (child: string, opts: { since?: string }) => {
    const anton = loadAnton();
    await connectAnton(anton);
    print(await anton.getProgress({ childName: child, since: opts.since }));
  });

// ── events ───────────────────────────────────────────────────────────────────

program
  .command('events <child>')
  .description('Show raw event log for a child')
  .option('--since <date>', 'Start date (YYYY-MM-DD, default: all time)')
  .option('--type <event>', 'Filter to a specific event type (e.g. finishLevel)')
  .option('-n, --limit <n>', 'Max number of events to return (default: 100)', (v) => parseInt(v, 10))
  .action(async (child: string, opts: { since?: string; type?: string; limit?: number }) => {
    const anton = loadAnton();
    await connectAnton(anton);
    print(await anton.getEvents({ childName: child, since: opts.since, eventType: opts.type, limit: opts.limit }));
  });

// ── level-progress ───────────────────────────────────────────────────────────

program
  .command('level-progress <levelPuid> <child>')
  .description("Detailed per-level performance for a child (uses the reviewReport API)")
  .action(async (levelPuid: string, child: string) => {
    const anton = loadAnton();
    await connectAnton(anton);
    print(await anton.getLevelProgress({ levelPuid, childName: child }));
  });

// ── weekly ───────────────────────────────────────────────────────────────────

program
  .command('weekly <child>')
  .description('Show weekly activity summary for a child')
  .option('--week <date>', 'Week start date — Monday YYYY-MM-DD (default: current week)')
  .action(async (child: string, opts: { week?: string }) => {
    const anton = loadAnton();
    await connectAnton(anton);
    print(await anton.getWeeklySummary({ childName: child, weekStartAt: opts.week }));
  });

// ── subjects ─────────────────────────────────────────────────────────────────

program
  .command('subjects <child>')
  .description('Per-subject accuracy, stars, time spent, and improvement trend')
  .option('-s, --subject <code>', 'Filter by subject prefix (e.g. mat, natdeu)')
  .action(async (child: string, opts: { subject?: string }) => {
    const anton = loadAnton();
    await connectAnton(anton);
    print(await anton.getSubjectSummary({ childName: child, subject: opts.subject }));
  });

// ── timeline ─────────────────────────────────────────────────────────────────

program
  .command('timeline <child>')
  .description('Active days, streaks, gaps, and daily breakdown for a child')
  .option('--since <date>', 'Start date (YYYY-MM-DD, default: all time)')
  .action(async (child: string, opts: { since?: string }) => {
    const anton = loadAnton();
    await connectAnton(anton);
    print(await anton.getActivityTimeline({ childName: child, since: opts.since }));
  });

// ── completion ───────────────────────────────────────────────────────────────

program
  .command('completion <child>')
  .description('Check which assigned lesson blocks a child has completed')
  .option('--week <date>', 'Filter to a specific week (YYYY-MM-DD Monday)')
  .action(async (child: string, opts: { week?: string }) => {
    const anton = loadAnton();
    await connectAnton(anton);
    print(await anton.checkAssignmentCompletion({ childName: child, week: opts.week }));
  });

// ── compare ──────────────────────────────────────────────────────────────────

program
  .command('compare')
  .description('Side-by-side comparison of all children: stars, accuracy, time, subjects')
  .action(async () => {
    const anton = loadAnton();
    await connectAnton(anton);
    print(await anton.compareChildren());
  });

// ── assignments (local) ───────────────────────────────────────────────────────

program
  .command('assignments')
  .description('List local lesson assignments')
  .option('--child <name>', 'Filter by child name')
  .option('--status <status>', 'Filter by status: pending, completed, cancelled')
  .action((opts: { child?: string; status?: string }) => {
    const anton = loadAnton();
    print(
      anton.listAssignments({
        childName: opts.child,
        status: opts.status as 'pending' | 'completed' | 'cancelled' | undefined,
      }),
    );
  });

// ── assign ───────────────────────────────────────────────────────────────────

program
  .command('assign <child> <fileId>')
  .description('Create a local lesson assignment for a child')
  .option('--title <title>', 'Human-readable lesson title')
  .option('--note <note>', 'Optional note')
  .action((child: string, fileId: string, opts: { title?: string; note?: string }) => {
    const anton = loadAnton();
    print(
      anton.assignLesson({
        childName: child,
        fileId,
        lessonTitle: opts.title,
        note: opts.note,
      }),
    );
  });

// ── update-assignment ─────────────────────────────────────────────────────────

program
  .command('update-assignment <id>')
  .description('Update a local assignment (status, note)')
  .option('--status <status>', 'New status: pending, completed, cancelled')
  .option('--note <note>', 'Updated note')
  .action((id: string, opts: { status?: string; note?: string }) => {
    const anton = loadAnton();
    print(
      anton.updateAssignment(id, {
        status: opts.status as 'pending' | 'completed' | 'cancelled' | undefined,
        note: opts.note,
      }),
    );
  });

// ── delete-assignment ─────────────────────────────────────────────────────────

program
  .command('delete-assignment <id>')
  .description('Delete a local assignment')
  .action((id: string) => {
    const anton = loadAnton();
    anton.deleteAssignment(id);
    print({ deleted: true, id });
  });

// ---------------------------------------------------------------------------
// Run
// ---------------------------------------------------------------------------

program.parseAsync(process.argv).catch((e: Error) => {
  err(e.message);
  process.exit(1);
});
