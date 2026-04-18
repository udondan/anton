/**
 * CLI integration tests — spawns `node dist/cli.js` as a subprocess.
 *
 * Prerequisites:
 *   ANTON_LOGIN_CODE=<parent 8-char code>
 *   npm run build   (dist/ must be up-to-date)
 *
 * Run:
 *   npm test test/cli.test.ts
 */

import { execFile } from 'node:child_process';
import { resolve } from 'node:path';
import { promisify } from 'node:util';
import { beforeAll, describe, expect, it } from 'vitest';

const execFileAsync = promisify(execFile);

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const CHILD_NAME = 'Test';
const CLI = resolve(import.meta.dirname, '../dist/cli.js');
const ENV = {
  ...process.env,
  ANTON_LOGIN_CODE: process.env['ANTON_LOGIN_CODE'] ?? '',
};

// ---------------------------------------------------------------------------
// Helper: run a CLI command, return parsed JSON stdout
// ---------------------------------------------------------------------------

async function run(
  args: string[],
  env: NodeJS.ProcessEnv = ENV,
): Promise<{ stdout: string; parsed: unknown }> {
  const { stdout } = await execFileAsync('node', [CLI, ...args], { env, timeout: 30_000 });
  return { stdout, parsed: JSON.parse(stdout) };
}

// ---------------------------------------------------------------------------
// Setup guard
// ---------------------------------------------------------------------------

beforeAll(() => {
  if (!process.env['ANTON_LOGIN_CODE']) {
    throw new Error(
      'ANTON_LOGIN_CODE is not set — cannot run CLI integration tests.\n' +
        'Export it before running: ANTON_LOGIN_CODE=YOUR-CODE npm test',
    );
  }
});

// ---------------------------------------------------------------------------
// --help / --version (no credentials needed)
// ---------------------------------------------------------------------------

describe('CLI meta', () => {
  it('--help exits 0 and prints usage', async () => {
    const { stdout } = await execFileAsync('node', [CLI, '--help'], { timeout: 5_000 });
    expect(stdout).toContain('Usage: anton');
    expect(stdout).toContain('mcp');
    expect(stdout).toContain('status');
  });

  it('--version exits 0 and prints a version string', async () => {
    const { stdout } = await execFileAsync('node', [CLI, '--version'], { timeout: 5_000 });
    expect(stdout.trim()).toMatch(/^\d+\.\d+\.\d+$/);
  });

  it('exits non-zero and prints error when no credentials set', async () => {
    await expect(
      execFileAsync('node', [CLI, 'status'], {
        env: { ...process.env, ANTON_LOGIN_CODE: '', ANTON_LOG_ID: '' },
        timeout: 5_000,
      }),
    ).rejects.toMatchObject({ code: 1 });
  });
});

// ---------------------------------------------------------------------------
// pin / unpin
// Placed early so it runs before the API rate limit builds up from the
// many subsequent CLI process spawns.
// Atomic test — pin then unpin so we never leave state behind.
// Uses FAR_FUTURE_WEEK=2099-09 (sdk=2099-03/2099-10/2099-12, mcp=2099-06, integration=2099-01).
// ---------------------------------------------------------------------------

const FAR_FUTURE_WEEK = '2099-09-01';

describe('CLI pin / unpin', () => {
  it('pins a block for the Test child then unpins it', async () => {
    // Resolve a real block puid from the catalogue so we can verify the result
    const { parsed: blocksResult } = await run(['blocks', 'c-mat-4', '--topic-index', '0']);
    const block = (blocksResult as { blocks: Array<{ puid: string }> }).blocks[0]!;

    // Pin and verify the response
    const { parsed: pinResult } = await run([
      'pin', 'c-mat-4',
      '--topic-index', '0',
      '--block-index', '0',
      '--week', FAR_FUTURE_WEEK,
      '--child', CHILD_NAME,
    ]);
    const pin = pinResult as { pinned: boolean; blockPuid: string; weekStartAt: string };
    expect(pin.pinned).toBe(true);
    expect(pin.blockPuid).toBe(block.puid);
    expect(pin.weekStartAt).toBe(FAR_FUTURE_WEEK);

    // Unpin and verify the response
    // (SDK and MCP tests cover the round-trip verification via get_group_assignments)
    const { parsed: unpinResult } = await run(['unpin', block.puid, FAR_FUTURE_WEEK]);
    expect((unpinResult as { unpinned: boolean }).unpinned).toBe(true);
  });
}, 60_000);

// ---------------------------------------------------------------------------
// pins
// Placed early (after pin/unpin) to avoid API rate-limit buildup.
// ---------------------------------------------------------------------------

describe('CLI pins', () => {
  it('returns pinned blocks for the group', async () => {
    const { parsed } = await run(['pins']);
    expect(Array.isArray(parsed)).toBe(true);
  });

  it('--child filters to the Test child', async () => {
    const { parsed } = await run(['pins', '--child', CHILD_NAME]);
    expect(Array.isArray(parsed)).toBe(true);
  });
}, 30_000);

// ---------------------------------------------------------------------------
// completion
// Placed early to avoid API rate-limit buildup from later CLI spawns.
// ---------------------------------------------------------------------------

describe('CLI completion', () => {
  it('returns an assignment completion report for the Test child', async () => {
    const { parsed } = await run(['completion', CHILD_NAME]);
    const result = parsed as { childName: string; assignments: unknown[] };
    expect(result.childName).toBe(CHILD_NAME);
    expect(Array.isArray(result.assignments)).toBe(true);
  });
}, 30_000);

// ---------------------------------------------------------------------------
// compare
// Placed early to avoid API rate-limit buildup from later CLI spawns.
// ---------------------------------------------------------------------------

describe('CLI compare', () => {
  it('returns a side-by-side comparison of all children', async () => {
    const { parsed } = await run(['compare']);
    const result = parsed as { children: Array<{ childName: string; totalStars: number }> };
    expect(Array.isArray(result.children)).toBe(true);
    expect(result.children.length).toBeGreaterThan(0);
    expect(result.children[0]!.childName).toBeTruthy();
    expect(typeof result.children[0]!.totalStars).toBe('number');
  });
}, 30_000);

// ---------------------------------------------------------------------------
// status
// ---------------------------------------------------------------------------

describe('CLI status', () => {
  it('returns valid JSON with parent, group, and children', async () => {
    const { parsed } = await run(['status']);
    const result = parsed as { parent: unknown; group: unknown; children: unknown[] };
    expect(result.parent).not.toBeNull();
    expect(result.group).not.toBeNull();
    expect(Array.isArray(result.children)).toBe(true);
    expect(result.children.length).toBeGreaterThan(0);
  });

  it('parent has logId and displayName', async () => {
    const { parsed } = await run(['status']);
    const { parent } = parsed as { parent: { logId: string; displayName: string } };
    expect(parent.logId).toBeTruthy();
    expect(parent.displayName).toBeTruthy();
  });

  it('includes totalGroups count', async () => {
    const { parsed } = await run(['status']);
    const result = parsed as { totalGroups: number };
    expect(typeof result.totalGroups).toBe('number');
    expect(result.totalGroups).toBeGreaterThan(0);
  });
}, 30_000);

// ---------------------------------------------------------------------------
// groups
// ---------------------------------------------------------------------------

describe('CLI groups', () => {
  it('lists all groups with members', async () => {
    const { parsed } = await run(['groups']);
    const groups = parsed as Array<{ groupCode: string; groupName: string; members: unknown[] }>;
    expect(Array.isArray(groups)).toBe(true);
    expect(groups.length).toBeGreaterThan(0);
    expect(groups[0]!.groupCode).toBeTruthy();
    expect(groups[0]!.groupName).toBeTruthy();
    expect(Array.isArray(groups[0]!.members)).toBe(true);
    expect(groups[0]!.members.length).toBeGreaterThan(0);
  });
}, 30_000);

// ---------------------------------------------------------------------------
// --group flag / ANTON_GROUP env var
// ---------------------------------------------------------------------------

describe('CLI --group flag', () => {
  let defaultGroupName: string;

  beforeAll(async () => {
    const { parsed } = await run(['group']);
    defaultGroupName = (parsed as { groupName: string }).groupName;
  });

  it('--group <name> group returns same groupCode as default', async () => {
    const [withFlag, without] = await Promise.all([
      run(['--group', defaultGroupName, 'group']),
      run(['group']),
    ]);
    const a = withFlag.parsed as { groupCode: string };
    const b = without.parsed as { groupCode: string };
    expect(a.groupCode).toBe(b.groupCode);
  });

  it('--group <unknown> group exits non-zero', async () => {
    await expect(run(['--group', 'NoSuchGroupXYZ', 'group'])).rejects.toMatchObject({ code: 1 });
  });

  it('--group <name> children returns same count as default', async () => {
    const [withFlag, without] = await Promise.all([
      run(['--group', defaultGroupName, 'children']),
      run(['children']),
    ]);
    expect((withFlag.parsed as unknown[]).length).toBe((without.parsed as unknown[]).length);
  });

  it('ANTON_GROUP env var selects a group by name', async () => {
    const { parsed } = await run(['group'], { ...ENV, ANTON_GROUP: defaultGroupName });
    expect((parsed as { groupCode: string }).groupCode).toBeTruthy();
  });

  it('ANTON_GROUP with invalid name exits non-zero', async () => {
    await expect(
      run(['group'], { ...ENV, ANTON_GROUP: 'NoSuchGroupXYZ' }),
    ).rejects.toMatchObject({ code: 1 });
  });
}, 60_000);

// ---------------------------------------------------------------------------
// group
// ---------------------------------------------------------------------------

describe('CLI group', () => {
  it('returns group info with members and pinnedBlocks', async () => {
    const { parsed } = await run(['group']);
    const result = parsed as { groupCode: string; members: unknown[]; pinnedBlocks: unknown[] };
    expect(result.groupCode).toBeTruthy();
    expect(Array.isArray(result.members)).toBe(true);
    expect(Array.isArray(result.pinnedBlocks)).toBe(true);
  });
}, 30_000);

// ---------------------------------------------------------------------------
// children
// ---------------------------------------------------------------------------

describe('CLI children', () => {
  it('returns an array of children with publicId', async () => {
    const { parsed } = await run(['children']);
    const children = parsed as Array<{ displayName?: string; publicId: string }>;
    expect(Array.isArray(children)).toBe(true);
    expect(children.length).toBeGreaterThan(0);
    for (const c of children) {
      expect(c.publicId).toBeTruthy();
    }
  });

  it('includes the Test child', async () => {
    const { parsed } = await run(['children']);
    const children = parsed as Array<{ displayName?: string }>;
    const test = children.find((c) => c.displayName?.toLowerCase() === CHILD_NAME.toLowerCase());
    expect(test).toBeDefined();
  });
}, 30_000);

// ---------------------------------------------------------------------------
// progress
// ---------------------------------------------------------------------------

describe('CLI progress', () => {
  it('returns a progress summary for the Test child', async () => {
    const { parsed } = await run(['progress', CHILD_NAME]);
    const result = parsed as {
      logId: string;
      totalEvents: number;
      completedLevels: unknown[];
    };
    expect(result.logId).toBeTruthy();
    expect(typeof result.totalEvents).toBe('number');
    expect(Array.isArray(result.completedLevels)).toBe(true);
  });

  it('exits non-zero for an unknown child name', async () => {
    await expect(run(['progress', 'NoSuchChildXYZ'])).rejects.toMatchObject({ code: 1 });
  });
}, 30_000);

// ---------------------------------------------------------------------------
// weekly
// ---------------------------------------------------------------------------

describe('CLI weekly', () => {
  it('returns a weekly summary for the Test child', async () => {
    const { parsed } = await run(['weekly', CHILD_NAME, '--week', '2025-01-06']);
    const result = parsed as {
      childName: string;
      weekStartAt: string;
      weekEndAt: string;
      levelsCompleted: number;
    };
    expect(result.childName).toBe(CHILD_NAME);
    expect(result.weekStartAt).toBe('2025-01-06');
    expect(result.weekEndAt).toBe('2025-01-12');
    expect(typeof result.levelsCompleted).toBe('number');
  });
}, 30_000);

// ---------------------------------------------------------------------------
// events
// ---------------------------------------------------------------------------

describe('CLI events', () => {
  it('returns events for the Test child', async () => {
    const { parsed } = await run(['events', CHILD_NAME, '-n', '10']);
    const events = parsed as unknown[];
    expect(Array.isArray(events)).toBe(true);
    expect(events.length).toBeLessThanOrEqual(10);
  });

  it('--type finishLevel returns only finishLevel events', async () => {
    const { parsed } = await run(['events', CHILD_NAME, '--type', 'finishLevel', '-n', '5']);
    const events = parsed as Array<{ event: string }>;
    for (const e of events) {
      expect(e.event).toBe('finishLevel');
    }
  });
}, 30_000);

// ---------------------------------------------------------------------------
// subjects
// ---------------------------------------------------------------------------

describe('CLI subjects', () => {
  it('returns per-subject stats for the Test child', async () => {
    const { parsed } = await run(['subjects', CHILD_NAME]);
    const result = parsed as { childName: string; subjects: unknown[] };
    expect(result.childName).toBe(CHILD_NAME);
    expect(Array.isArray(result.subjects)).toBe(true);
  });
}, 30_000);

// ---------------------------------------------------------------------------
// timeline
// ---------------------------------------------------------------------------

describe('CLI timeline', () => {
  it('returns an activity timeline for the Test child', async () => {
    const { parsed } = await run(['timeline', CHILD_NAME, '--since', '2025-01-01']);
    const result = parsed as { childName: string; activeDays: number; dailyActivity: unknown[] };
    expect(result.childName).toBe(CHILD_NAME);
    expect(typeof result.activeDays).toBe('number');
    expect(Array.isArray(result.dailyActivity)).toBe(true);
  });
}, 30_000);

// ---------------------------------------------------------------------------
// level-progress
// ---------------------------------------------------------------------------

describe('CLI level-progress', () => {
  it('returns level progress data for the Test child', async () => {
    // Get a real block puid from the catalogue
    const { parsed: topicResult } = await run(['blocks', 'c-mat-4', '--topic-index', '0']);
    const blocks = (topicResult as { blocks: Array<{ puid: string }> }).blocks;
    const levelPuid = blocks[0]!.puid;

    const { parsed } = await run(['level-progress', levelPuid, CHILD_NAME]);
    expect(parsed).toBeDefined();
  });
}, 60_000);

// ---------------------------------------------------------------------------
// Catalog tests — do not require family group; placed late so the
// group-dependent tests above run while the API is fresh.
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// plans
// ---------------------------------------------------------------------------

describe('CLI plans', () => {
  it('returns plans without filters (filtered to default language)', async () => {
    const { parsed } = await run(['plans']);
    expect(Array.isArray(parsed)).toBe(true);
    expect((parsed as unknown[]).length).toBeGreaterThan(50);
  });

  it('--subject mat returns only maths plans', async () => {
    const { parsed } = await run(['plans', '--subject', 'mat']);
    const plans = parsed as Array<{ subject: string }>;
    expect(plans.length).toBeGreaterThan(0);
    for (const p of plans) {
      expect(p.subject.toLowerCase()).toContain('mat');
    }
  });

  it('--grade 4 returns plans that include grade 4', async () => {
    const { parsed } = await run(['plans', '--grade', '4']);
    const plans = parsed as Array<{ grades: number[] }>;
    expect(plans.length).toBeGreaterThan(0);
    for (const p of plans) {
      expect(p.grades).toContain(4);
    }
  });
}, 30_000);

// ---------------------------------------------------------------------------
// topics
// ---------------------------------------------------------------------------

describe('CLI topics', () => {
  it('returns topics for c-mat-4', async () => {
    const { parsed } = await run(['topics', 'c-mat-4']);
    const result = parsed as { project: string; topics: Array<{ index: number; title: string }> };
    expect(result.project).toBe('c-mat-4');
    expect(result.topics.length).toBeGreaterThan(0);
    expect(typeof result.topics[0]!.index).toBe('number');
    expect(result.topics[0]!.title).toBeTruthy();
  });
}, 30_000);

// ---------------------------------------------------------------------------
// blocks
// ---------------------------------------------------------------------------

describe('CLI blocks', () => {
  it('returns blocks for topic index 0 of c-mat-4', async () => {
    const { parsed } = await run(['blocks', 'c-mat-4', '--topic-index', '0']);
    const result = parsed as { project: string; blocks: Array<{ puid: string; blockPath: string }> };
    expect(result.project).toBe('c-mat-4');
    expect(result.blocks.length).toBeGreaterThan(0);
    expect(result.blocks[0]!.puid).toBeTruthy();
    expect(result.blocks[0]!.blockPath).toMatch(/^\/..\//);
  });
}, 30_000);

// ---------------------------------------------------------------------------
// plan
// ---------------------------------------------------------------------------

describe('CLI plan', () => {
  it('returns the full hierarchy for c-mat-4', async () => {
    const { parsed } = await run(['plan', 'c-mat-4']);
    const result = parsed as { project: string; topics: Array<{ title: string }> };
    expect(result.project).toBe('c-mat-4');
    expect(result.topics.length).toBeGreaterThan(0);
  });
}, 30_000);

// ---------------------------------------------------------------------------
// lesson
// ---------------------------------------------------------------------------

describe('CLI lesson', () => {
  it('returns lesson content for a real level fileId', async () => {
    const { parsed: topicResult } = await run(['blocks', 'c-mat-4', '--topic-index', '0']);
    const blocks = (topicResult as { blocks: Array<{ levels: Array<{ fileId?: string }> }> }).blocks;
    const level = blocks[0]!.levels.find((lv) => lv.fileId);
    expect(level).toBeDefined();

    const { parsed } = await run(['lesson', level!.fileId!]);
    expect(parsed).toBeDefined();
  });
}, 60_000);

// ---------------------------------------------------------------------------
// CLI family group code path (getUserEvents / logId)
// Detected via `groups` command — skipped if no family group exists.
// ---------------------------------------------------------------------------

describe('CLI family group (groupType === "family")', () => {
  let familyGroupName: string | undefined;
  let familyChildName: string | undefined;

  beforeAll(async () => {
    const { parsed } = await run(['groups']);
    const groups = parsed as Array<{
      groupType: string;
      groupName: string;
      members: Array<{ role: string; logId?: string; displayName?: string; publicId: string }>;
    }>;
    const familyGroup = groups.find((g) => g.groupType === 'family');
    if (!familyGroup) return;
    familyGroupName = familyGroup.groupName;
    const familyChild = familyGroup.members.find((m) => m.role === 'pupil' && m.logId);
    familyChildName = familyChild?.displayName ?? familyChild?.publicId;
  }, 30_000);

  it('--group <family> children returns a child with logId', async () => {
    if (!familyGroupName) return;
    const { parsed } = await run(['--group', familyGroupName, 'children']);
    const children = parsed as Array<{ displayName?: string; publicId: string; logId?: string }>;
    const withLogId = children.find((c) => c.logId);
    expect(withLogId).toBeDefined();
    expect(withLogId!.logId).toBeTruthy();
  }, 30_000);

  it('--group <family> progress returns logId and totalEvents > 0', async () => {
    if (!familyGroupName || !familyChildName) return;
    const { parsed } = await run(['--group', familyGroupName, 'progress', familyChildName]);
    const result = parsed as { logId: string; totalEvents: number };
    expect(result.logId).toBeTruthy();
    expect(result.totalEvents).toBeGreaterThan(0);
  }, 30_000);

  it('--group <family> compare returns real data for family group children', async () => {
    if (!familyGroupName || !familyChildName) return;
    const { parsed } = await run(['--group', familyGroupName, 'compare']);
    const result = parsed as { children: Array<{ childName: string; levelsCompleted: number }> };
    expect(result.children.length).toBeGreaterThan(0);
    const found = result.children.find(
      (c) => c.childName.toLowerCase() === familyChildName!.toLowerCase(),
    );
    expect(found).toBeDefined();
    expect(typeof found!.levelsCompleted).toBe('number');
  }, 30_000);
}, 60_000);

// ---------------------------------------------------------------------------
// Local assignments CRUD (assign / list / update-assignment / delete-assignment)
// Atomic test — create then clean up to avoid leftover state.
// ---------------------------------------------------------------------------

describe('CLI local assignments CRUD', () => {
  it('creates, lists, updates, and deletes a local assignment', async () => {
    const FILE_ID = 'c-mat-4/topic-01/block-01/level-01';

    // assign
    const { parsed: created } = await run([
      'assign', CHILD_NAME, FILE_ID,
      '--title', 'CLI Test Level',
    ]);
    const assignment = created as { id: string; status: string };
    expect(assignment.id).toBeTruthy();
    expect(assignment.status).toBe('pending');

    // list
    const { parsed: listed } = await run(['assignments', '--child', CHILD_NAME]);
    const list = listed as Array<{ id: string }>;
    expect(list.some((a) => a.id === assignment.id)).toBe(true);

    // update-assignment
    const { parsed: updated } = await run([
      'update-assignment', assignment.id,
      '--status', 'completed',
    ]);
    const upd = updated as { id: string; status: string };
    expect(upd.id).toBe(assignment.id);
    expect(upd.status).toBe('completed');

    // delete-assignment
    const { parsed: deleted } = await run(['delete-assignment', assignment.id]);
    expect((deleted as { deleted: boolean }).deleted).toBe(true);
  });
}, 30_000);
