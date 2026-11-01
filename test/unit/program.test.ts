/**
 * Unit tests for the CLI program, run in-process with a mocked Anton class,
 * session cache, assignment store and MCP server. No network or disk access.
 */

import { afterEach, beforeEach, describe, expect, it, vi, type MockInstance } from 'vitest';

import { Anton } from '../../src/Anton.js';
import * as assignments from '../../src/assignments.js';
import { loadConfigFile } from '../../src/config-file.js';
import { startMcpServer } from '../../src/mcp.js';
import { main } from '../../src/program.js';
import * as cache from '../../src/session-cache.js';
import type { CacheEntry } from '../../src/session-cache.js';
import type { GroupInfo, Session } from '../../src/types.js';

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

vi.mock('../../src/Anton.js', () => {
  const Anton = vi.fn(function (this: Record<string, unknown>) {
    Object.assign(this, {
      connect: vi.fn().mockResolvedValue(undefined),
      connectFromCache: vi.fn().mockResolvedValue(undefined),
      getCacheData: vi.fn(),
      getStatus: vi.fn().mockReturnValue({ status: true }),
      listGroups: vi.fn().mockReturnValue(['groups']),
      getGroup: vi.fn().mockResolvedValue({ group: true }),
      listChildren: vi
        .fn()
        .mockReturnValue([{ publicId: 'P-ANNA', displayName: 'Anna' }, { publicId: 'P-NONAME' }]),
      getGroupAssignments: vi.fn().mockResolvedValue(['pins']),
      pinBlock: vi.fn().mockResolvedValue({ pinned: true }),
      unpinBlock: vi.fn().mockResolvedValue({ unpinned: true }),
      listPlans: vi.fn().mockResolvedValue(['plans']),
      listTopics: vi.fn().mockResolvedValue(['topics']),
      getTopicBlocks: vi.fn().mockResolvedValue(['blocks']),
      getPlan: vi.fn().mockResolvedValue({ plan: true }),
      getLesson: vi.fn().mockResolvedValue({ lesson: true }),
      getProgress: vi.fn().mockResolvedValue({ progress: true }),
      getEvents: vi.fn().mockResolvedValue(['events']),
      getLevelProgress: vi.fn().mockResolvedValue({ level: true }),
      getWeeklySummary: vi.fn().mockResolvedValue({ weekly: true }),
      getSubjectSummary: vi.fn().mockResolvedValue({ subjects: true }),
      getActivityTimeline: vi.fn().mockResolvedValue({ timeline: true }),
      checkAssignmentCompletion: vi.fn().mockResolvedValue({ completion: true }),
      compareChildren: vi.fn().mockResolvedValue({ compare: true }),
    });
  });
  return { Anton };
});
vi.mock('../../src/mcp.js', () => ({ startMcpServer: vi.fn() }));
vi.mock('../../src/config-file.js', () => ({ loadConfigFile: vi.fn() }));
vi.mock('../../src/session-cache.js', () => ({
  readCache: vi.fn(),
  isGroupInfoFresh: vi.fn(),
  writeCache: vi.fn(),
  updateGroupInfoCache: vi.fn(),
  clearCache: vi.fn(),
}));
vi.mock('../../src/assignments.js', () => ({
  listAssignments: vi.fn().mockReturnValue(['assignments']),
  createAssignment: vi.fn().mockReturnValue({ id: 'new' }),
  updateAssignment: vi.fn().mockReturnValue({ id: 'upd' }),
  deleteAssignment: vi.fn(),
}));

type MockAnton = Record<string, MockInstance>;

/** The Anton instance created by the last main() call. */
function lastAnton(): MockAnton {
  const results = vi.mocked(Anton).mock.instances;
  return results[results.length - 1] as unknown as MockAnton;
}

/** Make the next created Anton instance use custom behaviour. */
function onNextAnton(setup: (a: MockAnton) => void): void {
  const ctor = vi.mocked(Anton).getMockImplementation() as unknown as (
    this: MockAnton,
    ...args: unknown[]
  ) => void;
  vi.mocked(Anton).mockImplementationOnce(function (this: MockAnton, ...args: unknown[]) {
    ctor.apply(this, args);
    setup(this);
  } as never);
}

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const SESSION = { logId: 'L-PARENT', authToken: 'tok' } as unknown as Session;
const GROUPS = [{ groupCode: 'G-1' }] as unknown as GroupInfo[];
const CACHED: CacheEntry = {
  credential: 'CODE',
  session: SESSION,
  groups: GROUPS,
  groupInfoCachedAt: 1,
};

// ---------------------------------------------------------------------------
// Output capture and env handling
// ---------------------------------------------------------------------------

let stdout: string[];
let stderr: string[];
const envSnapshot = { ...process.env };

beforeEach(() => {
  stdout = [];
  stderr = [];
  vi.spyOn(console, 'log').mockImplementation((msg: unknown) => {
    stdout.push(String(msg));
  });
  vi.spyOn(process.stdout, 'write').mockImplementation((chunk) => {
    stdout.push(String(chunk));
    return true;
  });
  vi.spyOn(process.stderr, 'write').mockImplementation((chunk) => {
    stderr.push(String(chunk));
    return true;
  });
  for (const key of ['ANTON_LOGIN_CODE', 'ANTON_LOG_ID', 'ANTON_GROUP', 'ANTON_NO_SESSION_CACHE']) {
    delete process.env[key];
  }
  process.env['ANTON_LOGIN_CODE'] = 'CODE';
  vi.mocked(cache.readCache).mockReturnValue(null);
  vi.mocked(cache.isGroupInfoFresh).mockReturnValue(false);
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.clearAllMocks();
  for (const key of Object.keys(process.env)) {
    if (!Object.hasOwn(envSnapshot, key)) delete process.env[key];
  }
  Object.assign(process.env, envSnapshot);
});

function printed(): unknown {
  return JSON.parse(stdout.join(''));
}

// ---------------------------------------------------------------------------
// Commander behaviour
// ---------------------------------------------------------------------------

describe('commander exit codes', () => {
  it('returns 0 for --help', async () => {
    expect(await main(['--help'])).toBe(0);
    expect(stdout.join('')).toContain('Usage: anton');
  });

  it('returns 0 for --version', async () => {
    expect(await main(['--version'])).toBe(0);
    expect(stdout.join('')).toMatch(/\d+\.\d+\.\d+/);
  });

  it('returns 1 for an unknown command', async () => {
    expect(await main(['bogus'])).toBe(1);
    expect(stderr.join('')).toContain("unknown command 'bogus'");
  });

  it('loads the config file before every action', async () => {
    await main(['status']);
    expect(loadConfigFile).toHaveBeenCalledOnce();
  });
});

// ---------------------------------------------------------------------------
// Credentials and errors
// ---------------------------------------------------------------------------

describe('credentials and errors', () => {
  it('fails without credentials', async () => {
    delete process.env['ANTON_LOGIN_CODE'];
    expect(await main(['status'])).toBe(1);
    expect(stderr.join('')).toContain('No credentials configured');
    expect(stderr.join('')).not.toContain('--no-cache');
  });

  it('accepts ANTON_LOG_ID instead of a login code', async () => {
    delete process.env['ANTON_LOGIN_CODE'];
    process.env['ANTON_LOG_ID'] = 'L-ID';
    expect(await main(['status'])).toBe(0);
    expect(Anton).toHaveBeenCalledWith({
      loginCode: undefined,
      logId: 'L-ID',
      groupName: undefined,
    });
    expect(cache.readCache).toHaveBeenCalledWith('L-ID');
  });

  it('takes the group from ANTON_GROUP', async () => {
    process.env['ANTON_GROUP'] = 'EnvGroup';
    await main(['status']);
    expect(Anton).toHaveBeenCalledWith(expect.objectContaining({ groupName: 'EnvGroup' }));
  });

  it('prefers --group over ANTON_GROUP', async () => {
    process.env['ANTON_GROUP'] = 'EnvGroup';
    await main(['--group', 'FlagGroup', 'status']);
    expect(Anton).toHaveBeenCalledWith(expect.objectContaining({ groupName: 'FlagGroup' }));
  });

  it('adds the --no-cache hint to auth errors', async () => {
    onNextAnton((a) => a.connect!.mockRejectedValue(new Error('401 Unauthorized')));
    expect(await main(['status'])).toBe(1);
    expect(stderr.join('')).toContain('[anton] 401 Unauthorized');
    expect(stderr.join('')).toContain('try re-running with --no-cache');
  });

  it('prints other errors without the hint', async () => {
    onNextAnton((a) => a.connect!.mockRejectedValue(new Error('network down')));
    expect(await main(['status'])).toBe(1);
    expect(stderr.join('')).toContain('[anton] network down');
    expect(stderr.join('')).not.toContain('--no-cache');
  });
});

// ---------------------------------------------------------------------------
// Session cache
// ---------------------------------------------------------------------------

describe('session cache', () => {
  it('logs in and writes the cache on a miss', async () => {
    vi.mocked(cache.readCache).mockReturnValue(null);
    onNextAnton((a) => a.getCacheData!.mockReturnValue({ session: SESSION, groups: GROUPS }));
    expect(await main(['status'])).toBe(0);
    expect(lastAnton().connect).toHaveBeenCalledOnce();
    expect(cache.writeCache).toHaveBeenCalledWith('CODE', SESSION, GROUPS);
  });

  it('does not write the cache when the SDK has no cache data', async () => {
    vi.mocked(cache.readCache).mockReturnValue(null);
    await main(['status']);
    expect(cache.writeCache).not.toHaveBeenCalled();
  });

  it('uses a fresh cache entry without logging in', async () => {
    vi.mocked(cache.readCache).mockReturnValue(CACHED);
    vi.mocked(cache.isGroupInfoFresh).mockReturnValue(true);
    expect(await main(['status'])).toBe(0);
    const anton = lastAnton();
    expect(anton.connectFromCache).toHaveBeenCalledWith(SESSION, ['G-1'], GROUPS);
    expect(anton.connect).not.toHaveBeenCalled();
    expect(cache.updateGroupInfoCache).not.toHaveBeenCalled();
  });

  it('re-fetches groups for a stale entry and updates the cache', async () => {
    vi.mocked(cache.readCache).mockReturnValue(CACHED);
    vi.mocked(cache.isGroupInfoFresh).mockReturnValue(false);
    const newGroups = [{ groupCode: 'G-2' }] as unknown as GroupInfo[];
    onNextAnton((a) => a.getCacheData!.mockReturnValue({ session: SESSION, groups: newGroups }));
    expect(await main(['status'])).toBe(0);
    expect(lastAnton().connectFromCache).toHaveBeenCalledWith(SESSION, ['G-1'], undefined);
    expect(cache.updateGroupInfoCache).toHaveBeenCalledWith(CACHED, newGroups);
  });

  it('skips the cache update for a stale entry without cache data', async () => {
    vi.mocked(cache.readCache).mockReturnValue(CACHED);
    vi.mocked(cache.isGroupInfoFresh).mockReturnValue(false);
    await main(['status']);
    expect(cache.updateGroupInfoCache).not.toHaveBeenCalled();
  });

  it('clears the cache and logs in when the cached session fails', async () => {
    vi.mocked(cache.readCache).mockReturnValue(CACHED);
    vi.mocked(cache.isGroupInfoFresh).mockReturnValue(true);
    onNextAnton((a) => a.connectFromCache!.mockRejectedValue(new Error('expired')));
    expect(await main(['status'])).toBe(0);
    expect(cache.clearCache).toHaveBeenCalledOnce();
    expect(lastAnton().connect).toHaveBeenCalledOnce();
  });

  it('skips the cache with --no-cache', async () => {
    onNextAnton((a) => a.getCacheData!.mockReturnValue({ session: SESSION, groups: GROUPS }));
    await main(['--no-cache', 'status']);
    expect(cache.readCache).not.toHaveBeenCalled();
    expect(cache.writeCache).not.toHaveBeenCalled();
  });

  it('skips the cache with ANTON_NO_SESSION_CACHE=1', async () => {
    process.env['ANTON_NO_SESSION_CACHE'] = '1';
    await main(['status']);
    expect(cache.readCache).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// mcp
// ---------------------------------------------------------------------------

describe('mcp', () => {
  it('connects and starts the MCP server', async () => {
    expect(await main(['mcp'])).toBe(0);
    expect(startMcpServer).toHaveBeenCalledWith(lastAnton());
  });

  it('fails with a clear message when authentication fails', async () => {
    onNextAnton((a) => a.connect!.mockRejectedValue(new Error('bad token')));
    expect(await main(['mcp'])).toBe(1);
    expect(stderr.join('')).toContain('Authentication failed: bad token');
    expect(stderr.join('')).not.toContain('--no-cache');
    expect(startMcpServer).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// pins
// ---------------------------------------------------------------------------

describe('pins', () => {
  it('lists all pins without filters', async () => {
    expect(await main(['pins'])).toBe(0);
    expect(lastAnton().getGroupAssignments).toHaveBeenCalledWith({
      week: undefined,
      childPublicId: undefined,
    });
    expect(printed()).toEqual(['pins']);
  });

  it('resolves --child by display name, case-insensitively', async () => {
    await main(['pins', '--child', 'anna', '--week', '2099-01-05']);
    expect(lastAnton().getGroupAssignments).toHaveBeenCalledWith({
      week: '2099-01-05',
      childPublicId: 'P-ANNA',
    });
  });

  it('resolves --child by publicId', async () => {
    await main(['pins', '--child', 'p-noname']);
    expect(lastAnton().getGroupAssignments).toHaveBeenCalledWith({
      week: undefined,
      childPublicId: 'P-NONAME',
    });
  });

  it('fails for an unknown child', async () => {
    expect(await main(['pins', '--child', 'Nobody'])).toBe(1);
    expect(stderr.join('')).toContain('Child "Nobody" not found.');
  });
});

// ---------------------------------------------------------------------------
// Commands that call one SDK method
// ---------------------------------------------------------------------------

describe('SDK commands', () => {
  const cases: [string, string[], string, unknown[]][] = [
    ['status', ['status'], 'getStatus', []],
    ['groups', ['groups'], 'listGroups', []],
    ['group', ['group'], 'getGroup', []],
    ['children', ['children'], 'listChildren', []],
    [
      'pin with all options',
      [
        'pin',
        'c-mat-4',
        '--topic-index',
        '2',
        '--topic-title',
        'Brüche',
        '--block-index',
        '1',
        '--block-title',
        'zuordnen',
        '--week',
        '2099-01-05',
        '--child',
        'Anna',
      ],
      'pinBlock',
      [
        {
          project: 'c-mat-4',
          topicIndex: 2,
          topicTitle: 'Brüche',
          blockIndex: 1,
          blockTitle: 'zuordnen',
          weekStartAt: '2099-01-05',
          childName: 'Anna',
        },
      ],
    ],
    [
      'unpin',
      ['unpin', 'c-mat-4/x', '2099-01-05', '--child-id', 'P-ANNA'],
      'unpinBlock',
      [{ blockPuid: 'c-mat-4/x', weekStartAt: '2099-01-05', childPublicId: 'P-ANNA' }],
    ],
    ['plans defaults', ['plans'], 'listPlans', [{ language: 'de' }]],
    [
      'plans with filters',
      ['plans', '-s', 'mat', '-g', '4', '-l', 'en'],
      'listPlans',
      [{ subject: 'mat', grade: 4, language: 'en' }],
    ],
    ['topics', ['topics', 'c-mat-4'], 'listTopics', [{ project: 'c-mat-4' }]],
    [
      'blocks',
      ['blocks', 'c-mat-4', '--topic-index', '3', '--topic-title', 'Zahlen'],
      'getTopicBlocks',
      [{ project: 'c-mat-4', topicIndex: 3, topicTitle: 'Zahlen' }],
    ],
    ['plan', ['plan', 'c-mat-4'], 'getPlan', [{ project: 'c-mat-4' }]],
    ['lesson', ['lesson', 'c-mat-4/x/y'], 'getLesson', [{ fileId: 'c-mat-4/x/y' }]],
    [
      'progress',
      ['progress', 'Anna', '--since', '2099-01-01'],
      'getProgress',
      [{ childName: 'Anna', since: '2099-01-01' }],
    ],
    [
      'events',
      ['events', 'Anna', '--since', '2099-01-01', '--type', 'finishLevel', '-n', '5'],
      'getEvents',
      [{ childName: 'Anna', since: '2099-01-01', eventType: 'finishLevel', limit: 5 }],
    ],
    [
      'level-progress',
      ['level-progress', 'c-mat-4/lvl', 'Anna'],
      'getLevelProgress',
      [{ levelPuid: 'c-mat-4/lvl', childName: 'Anna' }],
    ],
    [
      'weekly',
      ['weekly', 'Anna', '--week', '2099-01-05'],
      'getWeeklySummary',
      [{ childName: 'Anna', weekStartAt: '2099-01-05' }],
    ],
    [
      'subjects',
      ['subjects', 'Anna', '-s', 'mat'],
      'getSubjectSummary',
      [{ childName: 'Anna', subject: 'mat' }],
    ],
    [
      'timeline',
      ['timeline', 'Anna', '--since', '2099-01-01'],
      'getActivityTimeline',
      [{ childName: 'Anna', since: '2099-01-01' }],
    ],
    [
      'completion',
      ['completion', 'Anna', '--week', '2099-01-05'],
      'checkAssignmentCompletion',
      [{ childName: 'Anna', week: '2099-01-05' }],
    ],
    ['compare', ['compare'], 'compareChildren', []],
  ];

  it.each(cases)('%s', async (_name, argv, method, args) => {
    expect(await main(argv)).toBe(0);
    const anton = lastAnton();
    expect(anton.connect).toHaveBeenCalledOnce();
    expect(anton[method]).toHaveBeenCalledWith(...args);
    const result: unknown = await anton[method]!.mock.results[0]!.value;
    expect(printed()).toEqual(result);
  });
});

// ---------------------------------------------------------------------------
// Local assignments
// ---------------------------------------------------------------------------

describe('local assignments', () => {
  it('lists assignments with filters', async () => {
    expect(await main(['assignments', '--child', 'Anna', '--status', 'pending'])).toBe(0);
    expect(assignments.listAssignments).toHaveBeenCalledWith({
      childName: 'Anna',
      status: 'pending',
    });
    expect(printed()).toEqual(['assignments']);
    expect(Anton).not.toHaveBeenCalled();
  });

  it('rejects an invalid --status choice', async () => {
    expect(await main(['assignments', '--status', 'nope'])).toBe(1);
    expect(stderr.join('')).toContain('Allowed choices are pending, completed, cancelled');
  });

  it('creates an assignment', async () => {
    await main(['assign', 'Anna', 'level/c-mat-4/x', '--title', 'Brüche', '--note', 'n']);
    expect(assignments.createAssignment).toHaveBeenCalledWith({
      childName: 'Anna',
      fileId: 'level/c-mat-4/x',
      lessonTitle: 'Brüche',
      note: 'n',
    });
    expect(printed()).toEqual({ id: 'new' });
  });

  it('updates an assignment', async () => {
    await main(['update-assignment', 'id-1', '--status', 'completed', '--note', 'done']);
    expect(assignments.updateAssignment).toHaveBeenCalledWith('id-1', {
      status: 'completed',
      note: 'done',
    });
    expect(printed()).toEqual({ id: 'upd' });
  });

  it('deletes an assignment', async () => {
    await main(['delete-assignment', 'id-1']);
    expect(assignments.deleteAssignment).toHaveBeenCalledWith('id-1');
    expect(printed()).toEqual({ deleted: true, id: 'id-1' });
  });
});
