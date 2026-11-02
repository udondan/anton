/**
 * Unit tests for the Anton class — client.ts and analysis.ts are mocked, so no
 * network access happens.
 */

import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import * as analysis from '../../src/analysis.js';
import { Anton } from '../../src/Anton.js';
import * as client from '../../src/client.js';
import type {
  AntonEvent,
  GroupInfo,
  PinnedBlock,
  Plan,
  PlanSummary,
  Session,
} from '../../src/types.js';

vi.mock('../../src/client.js', () => ({
  loginWithCode: vi.fn(),
  loginWithLogId: vi.fn(),
  getUserEvents: vi.fn(),
  getGroupMemberEvents: vi.fn(),
  getGroupEvents: vi.fn(),
  extractGroupCodes: vi.fn(),
  parseGroupInfo: vi.fn(),
  parsePinnedBlocks: vi.fn(),
  pinGroupBlock: vi.fn(),
  unpinGroupBlock: vi.fn(),
  getGroupMemberDescriptions: vi.fn(),
  getPlansCatalogue: vi.fn(),
  getPlan: vi.fn(),
  getLessonContent: vi.fn(),
  getLevelReviewReport: vi.fn(),
  summariseProgress: vi.fn(),
}));

vi.mock('../../src/analysis.js', () => ({
  checkAssignmentCompletion: vi.fn(() => 'completion'),
  getWeeklySummary: vi.fn(() => 'weekly'),
  getSubjectSummary: vi.fn(() => 'subjects'),
  getActivityTimeline: vi.fn(() => 'timeline'),
  compareChildren: vi.fn(() => 'compare'),
}));

const c = vi.mocked(client);
const a = vi.mocked(analysis);

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const SESSION: Session = {
  loginCode: 'ABCD-1234',
  logId: 'L-parent',
  authToken: 'token',
  displayName: 'Parent',
};

function makeGroups(): GroupInfo[] {
  return [
    {
      groupCode: 'G1',
      groupName: 'Family',
      groupType: 'family',
      isPlus: true,
      plusValidUntil: '2099-01-01',
      members: [
        { publicId: 'P-parent', role: 'admin', displayName: 'Parent' },
        { publicId: 'P-alice', role: 'pupil', displayName: 'Alice', logId: 'L-alice' },
        { publicId: 'P-anon', role: 'pupil' },
      ],
    },
    {
      groupCode: 'G2',
      groupName: 'Class',
      groupType: 'class',
      members: [{ publicId: 'P-bob', role: 'pupil', displayName: 'Bob' }],
    },
  ];
}

function event(created: string, name = 'finishLevel'): AntonEvent {
  return { event: name, created };
}

function pin(puid: string, weekStartAt: string, subgroup?: string, created = 'c1'): PinnedBlock {
  return { puid, block: `/../${puid}/block`, weekStartAt, subgroup, created };
}

const PLAN: Plan = {
  title: 'Mathe 4',
  project: 'c-mat-4',
  puid: 'c-mat-4/plan',
  totalBlocks: 2,
  totalLevels: 3,
  etag: '1',
  topics: [
    {
      title: 'Zahlen',
      puid: 'c-mat-4/topic-01-zahlen',
      blocks: [
        {
          title: 'Zählen',
          puid: 'c-mat-4/block-01-zaehlen',
          levels: [
            { title: 'L1', puid: 'c-mat-4/l1', type: 'normal', path: '/../c-mat-4/l1' },
            { title: 'L2', puid: 'c-mat-4/l2' },
          ] as Plan['topics'][0]['blocks'][0]['levels'],
        },
      ],
    },
    {
      title: 'Brüche',
      puid: 'c-mat-4/topic-07-brueche',
      blocks: [
        {
          title: 'Brüche zuordnen',
          puid: 'c-mat-4/block-02-brueche-zuordnen',
          levels: [{ title: 'L3', puid: 'c-mat-4/l3' }],
        },
      ],
    },
  ],
};

/** Connected Anton without any API calls. */
async function connected(config: ConstructorParameters<typeof Anton>[0] = {}): Promise<Anton> {
  const anton = new Anton(config);
  await anton.connectFromCache(SESSION, ['G1', 'G2'], makeGroups());
  return anton;
}

const tmp = mkdtempSync(join(tmpdir(), 'anton-unit-'));
afterAll(() => rmSync(tmp, { recursive: true, force: true }));

beforeEach(() => {
  vi.resetAllMocks();
  process.env['ANTON_ASSIGNMENTS_FILE'] = join(tmp, `assignments-${String(Math.random())}.json`);
});

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

// ---------------------------------------------------------------------------
// connect
// ---------------------------------------------------------------------------

describe('connect', () => {
  it('logs in with a login code and loads all groups with member descriptions', async () => {
    c.loginWithCode.mockResolvedValue(SESSION);
    c.getUserEvents.mockResolvedValue([]);
    c.extractGroupCodes.mockReturnValue(['G1', 'G2']);
    c.getGroupEvents.mockResolvedValue([]);
    c.parseGroupInfo.mockImplementation(
      (code) => makeGroups().find((g) => g.groupCode === code) as GroupInfo,
    );
    c.getGroupMemberDescriptions.mockImplementation((code) =>
      code === 'G1'
        ? Promise.resolve([{ publicId: 'P-anon', displayName: 'Anon', logId: 'L-anon' }])
        : Promise.reject(new Error('forbidden')),
    );

    const anton = new Anton({ loginCode: 'ABCD-1234' });
    await anton.connect();
    // A second call is a no-op.
    await anton.connect();

    expect(c.loginWithCode).toHaveBeenCalledTimes(1);
    expect(c.getUserEvents).toHaveBeenCalledWith('L-parent');
    const data = anton.getCacheData();
    expect(data?.session).toEqual(SESSION);
    const anon = data?.groups[0]?.members.find((m) => m.publicId === 'P-anon');
    expect(anon).toMatchObject({ displayName: 'Anon', logId: 'L-anon' });
    // Members without a description keep their data.
    expect(data?.groups[0]?.members[1]).toMatchObject({ displayName: 'Alice' });
    // Failed descriptions are non-fatal.
    expect(data?.groups[1]?.members[0]).toMatchObject({ displayName: 'Bob' });
  });

  it('logs in with a logId', async () => {
    c.loginWithLogId.mockResolvedValue(SESSION);
    c.getUserEvents.mockResolvedValue([]);
    c.extractGroupCodes.mockReturnValue(['G1']);
    c.getGroupEvents.mockResolvedValue([]);
    c.parseGroupInfo.mockReturnValue(makeGroups()[0] as GroupInfo);
    c.getGroupMemberDescriptions.mockResolvedValue([]);

    const anton = new Anton({ logId: 'L-parent' });
    await anton.connect();
    expect(c.loginWithLogId).toHaveBeenCalledWith('L-parent');
    expect(anton.listGroups()).toHaveLength(1);
  });

  it('requires a login code or logId', async () => {
    await expect(new Anton({}).connect()).rejects.toThrow(
      'Anton requires either loginCode or logId in config.',
    );
  });

  it('retries while the user event log is still empty', async () => {
    vi.spyOn(globalThis, 'setTimeout').mockImplementation(((fn: () => void) => {
      fn();
      return 0;
    }) as unknown as typeof setTimeout);
    c.loginWithCode.mockResolvedValue(SESSION);
    c.getUserEvents.mockResolvedValue([]);
    c.extractGroupCodes.mockReturnValueOnce([]).mockReturnValueOnce(['G1']);
    c.getGroupEvents.mockResolvedValue([]);
    c.parseGroupInfo.mockReturnValue(makeGroups()[0] as GroupInfo);
    c.getGroupMemberDescriptions.mockResolvedValue([]);

    const anton = new Anton({ loginCode: 'X' });
    await anton.connect();
    expect(c.getUserEvents).toHaveBeenCalledTimes(2);
    expect(anton.listGroups()).toHaveLength(1);
  });

  it('stays without groups when no group code is ever found', async () => {
    vi.spyOn(globalThis, 'setTimeout').mockImplementation(((fn: () => void) => {
      fn();
      return 0;
    }) as unknown as typeof setTimeout);
    c.loginWithCode.mockResolvedValue(SESSION);
    c.getUserEvents.mockResolvedValue([]);
    c.extractGroupCodes.mockReturnValue([]);

    const anton = new Anton({ loginCode: 'X' });
    await anton.connect();
    expect(c.getUserEvents).toHaveBeenCalledTimes(3);
    expect(c.getGroupEvents).not.toHaveBeenCalled();
    expect(anton.getCacheData()).toBeNull();
  });

  it('resets its state when loading the groups fails', async () => {
    c.loginWithCode.mockResolvedValue(SESSION);
    c.getUserEvents.mockRejectedValue(new Error('boom'));

    const anton = new Anton({ loginCode: 'X' });
    await expect(anton.connect()).rejects.toThrow('Failed to load family group: boom');
    expect(anton.getStatus().parent).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// connectFromCache / getCacheData
// ---------------------------------------------------------------------------

describe('connectFromCache', () => {
  it('restores session and groups without API calls and ignores later calls', async () => {
    const anton = await connected();
    await anton.connectFromCache(SESSION, ['G9'], []);
    expect(anton.listGroups().map((g) => g.groupCode)).toEqual(['G1', 'G2']);
    expect(c.getGroupEvents).not.toHaveBeenCalled();
  });

  it('re-fetches the groups when none are cached', async () => {
    c.getGroupEvents.mockResolvedValue([]);
    c.parseGroupInfo.mockReturnValue(makeGroups()[1] as GroupInfo);
    c.getGroupMemberDescriptions.mockResolvedValue([]);

    const anton = new Anton({});
    await anton.connectFromCache(SESSION, ['G2']);
    expect(c.getGroupEvents).toHaveBeenCalledWith('G2');
    expect(anton.getCacheData()?.groups[0]?.groupCode).toBe('G2');
  });

  it('resets its state and rethrows when re-fetching fails', async () => {
    c.getGroupEvents.mockRejectedValue(new Error('expired'));
    const anton = new Anton({});
    await expect(anton.connectFromCache(SESSION, ['G1'])).rejects.toThrow('expired');
    expect(anton.getCacheData()).toBeNull();
    expect(anton.getStatus().parent).toBeNull();
  });
});

describe('getCacheData', () => {
  it('is null before connecting', () => {
    expect(new Anton({}).getCacheData()).toBeNull();
  });

  it('is null without groups', async () => {
    const anton = new Anton({});
    await anton.connectFromCache(SESSION, [], []);
    expect(anton.getCacheData()).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// Status / groups / children
// ---------------------------------------------------------------------------

describe('getStatus', () => {
  it('reports nothing before connecting', () => {
    expect(new Anton({}).getStatus()).toEqual({ parent: null, groups: [], children: [] });
  });

  it('uses the first group by default', async () => {
    const status = (await connected()).getStatus();
    expect(status.parent).toEqual({
      displayName: 'Parent',
      logId: 'L-parent',
      loginCode: 'ABCD-1234',
    });
    expect(status.groups).toEqual([
      {
        groupCode: 'G1',
        groupName: 'Family',
        groupType: 'family',
        memberCount: 3,
        isPlus: true,
        plusValidUntil: '2099-01-01',
      },
      {
        groupCode: 'G2',
        groupName: 'Class',
        groupType: 'class',
        memberCount: 1,
        isPlus: undefined,
        plusValidUntil: undefined,
      },
    ]);
    expect(status.children.map((ch) => ch.publicId)).toEqual(['P-alice', 'P-anon']);
  });

  it('uses the configured group, case-insensitively', async () => {
    const status = (await connected({ groupName: 'class' })).getStatus();
    expect(status.children.map((ch) => ch.publicId)).toEqual(['P-bob']);
  });

  it('falls back to the first group when the configured group is unknown', async () => {
    const status = (await connected({ groupName: 'nope' })).getStatus();
    expect(status.children.map((ch) => ch.publicId)).toEqual(['P-alice', 'P-anon']);
  });

  it('prefers an explicit group over the configured one', async () => {
    const status = (await connected({ groupName: 'Family' })).getStatus({ groupName: 'CLASS' });
    expect(status.children.map((ch) => ch.publicId)).toEqual(['P-bob']);
  });
});

describe('group selection', () => {
  it('fails before connecting', () => {
    expect(() => new Anton({}).listChildren()).toThrow(
      'Family group not loaded. Call connect() first.',
    );
  });

  it('fails for an unknown group and lists the available ones', async () => {
    const anton = await connected();
    expect(() => anton.listChildren({ groupName: 'Nope' })).toThrow(
      'Group "Nope" not found. Available groups: Family, Class',
    );
  });

  it('fails for an unknown configured group', async () => {
    const anton = await connected({ groupName: 'Nope' });
    expect(() => anton.listChildren()).toThrow('Group "Nope" not found.');
  });

  it('uses the configured group when no explicit group is given', async () => {
    const anton = await connected({ groupName: 'Class' });
    expect(anton.listChildren()).toEqual([
      { displayName: 'Bob', publicId: 'P-bob', logId: undefined },
    ]);
  });
});

describe('listGroups', () => {
  it('lists all groups with their members', async () => {
    const groups = (await connected()).listGroups();
    expect(groups).toHaveLength(2);
    expect(groups[0]).toEqual({
      groupCode: 'G1',
      groupName: 'Family',
      groupType: 'family',
      isPlus: true,
      plusValidUntil: '2099-01-01',
      members: [
        { publicId: 'P-parent', role: 'admin', displayName: 'Parent', logId: undefined },
        { publicId: 'P-alice', role: 'pupil', displayName: 'Alice', logId: 'L-alice' },
        { publicId: 'P-anon', role: 'pupil', displayName: undefined, logId: undefined },
      ],
    });
  });
});

describe('listChildren', () => {
  it('lists only pupils of the first group', async () => {
    expect((await connected()).listChildren()).toEqual([
      { displayName: 'Alice', publicId: 'P-alice', logId: 'L-alice' },
      { displayName: undefined, publicId: 'P-anon', logId: undefined },
    ]);
  });
});

describe('getGroup', () => {
  it('returns fresh members enriched from the cache, plus pinned blocks', async () => {
    const anton = await connected();
    const pins = [pin('c-mat-4/b1', '2099-01-05')];
    c.getGroupEvents.mockResolvedValue([]);
    c.parsePinnedBlocks.mockReturnValue(pins);
    c.parseGroupInfo.mockReturnValue({
      groupCode: 'G1',
      groupName: 'Family',
      groupType: 'family',
      members: [
        { publicId: 'P-alice', role: 'pupil' },
        { publicId: 'P-new', role: 'pupil' },
      ],
    });

    const group = await anton.getGroup();
    expect(c.getGroupEvents).toHaveBeenCalledWith('G1');
    expect(group.members).toEqual([
      { publicId: 'P-alice', role: 'pupil', displayName: 'Alice', logId: 'L-alice' },
      { publicId: 'P-new', role: 'pupil' },
    ]);
    expect(group.pinnedBlocks).toBe(pins);
  });

  it('uses an explicit group', async () => {
    const anton = await connected();
    c.getGroupEvents.mockResolvedValue([]);
    c.parsePinnedBlocks.mockReturnValue([]);
    c.parseGroupInfo.mockReturnValue(makeGroups()[1] as GroupInfo);
    await anton.getGroup({ groupName: 'Class' });
    expect(c.getGroupEvents).toHaveBeenCalledWith('G2');
  });
});

describe('getGroupAssignments', () => {
  const pins = [
    pin('p/1', '2099-01-05'),
    pin('p/2', '2099-01-05', 'P-alice'),
    pin('p/3', '2099-01-12', 'P-bob'),
  ];

  beforeEach(() => {
    c.getGroupEvents.mockResolvedValue([]);
    c.parsePinnedBlocks.mockReturnValue(pins);
  });

  it('returns all pins without filters', async () => {
    expect(await (await connected()).getGroupAssignments()).toEqual(pins);
  });

  it('filters by child (keeping group-wide pins) and week', async () => {
    const anton = await connected();
    const byChild = await anton.getGroupAssignments({ childPublicId: 'P-alice' });
    expect(byChild.map((p) => p.puid)).toEqual(['p/1', 'p/2']);
    const byWeek = await anton.getGroupAssignments({ week: '2099-01-12', groupName: 'Class' });
    expect(byWeek.map((p) => p.puid)).toEqual(['p/3']);
    expect(c.getGroupEvents).toHaveBeenLastCalledWith('G2');
  });
});

// ---------------------------------------------------------------------------
// pinBlock
// ---------------------------------------------------------------------------

describe('pinBlock', () => {
  beforeEach(() => {
    c.getPlan.mockResolvedValue(PLAN);
    c.pinGroupBlock.mockResolvedValue(undefined);
  });

  it('requires a connection', async () => {
    await expect(new Anton({}).pinBlock({ blockPuid: 'x', blockPath: 'y' })).rejects.toThrow(
      'Not connected. Call connect() first.',
    );
  });

  it('resolves topic and block by index and pins for a named child', async () => {
    const anton = await connected();
    const result = await anton.pinBlock({
      project: 'c-mat-4',
      topicIndex: 1,
      blockIndex: 0,
      weekStartAt: '2099-01-05',
      childName: 'alice',
    });
    expect(result).toEqual({
      pinned: true,
      groupCode: 'G1',
      blockPuid: 'c-mat-4/block-02-brueche-zuordnen',
      blockPath: '/../c-mat-4/topic-07-brueche/block-02-brueche-zuordnen/block',
      weekStartAt: '2099-01-05',
      childPublicId: 'P-alice',
    });
    expect(c.pinGroupBlock).toHaveBeenCalledWith(
      'G1',
      'c-mat-4/block-02-brueche-zuordnen',
      '/../c-mat-4/topic-07-brueche/block-02-brueche-zuordnen/block',
      '2099-01-05',
      'L-parent',
      'token',
      'P-alice',
    );
  });

  it('resolves topic and block by partial title', async () => {
    const anton = await connected();
    const result = await anton.pinBlock({
      project: 'c-mat-4',
      topicTitle: 'zahl',
      blockTitle: 'ZÄHL',
      weekStartAt: '2099-01-05',
      childPublicId: 'P-anon',
    });
    expect(result.blockPuid).toBe('c-mat-4/block-01-zaehlen');
    expect(result.blockPath).toBe('/../c-mat-4/topic-01-zahlen/block-01-zaehlen/block');
    expect(result.childPublicId).toBe('P-anon');
  });

  it('pins a block given directly to the whole group in the current week', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2099-01-07T12:00:00Z')); // Wednesday
    const anton = await connected();
    const result = await anton.pinBlock({ blockPuid: 'p/b', blockPath: '/../p/t/b/block' });
    expect(result.weekStartAt).toBe('2099-01-05');
    expect(result.childPublicId).toBeNull();
  });

  it('uses the previous Monday on a Sunday', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2099-01-11T12:00:00Z')); // Sunday
    const anton = await connected();
    const result = await anton.pinBlock({ blockPuid: 'p/b', blockPath: '/../p/t/b/block' });
    expect(result.weekStartAt).toBe('2099-01-05');
  });

  it('requires a block', async () => {
    const anton = await connected();
    await expect(anton.pinBlock({ blockPuid: 'p/b' })).rejects.toThrow(
      'Provide either (project + topicIndex/topicTitle + blockIndex/blockTitle) or (blockPuid + blockPath)',
    );
    await expect(anton.pinBlock({ blockPath: '/../x' })).rejects.toThrow('Provide either');
  });

  it.each([1.5, -1, 2])('rejects topic index %s', async (topicIndex) => {
    const anton = await connected();
    await expect(anton.pinBlock({ project: 'c-mat-4', topicIndex, blockIndex: 0 })).rejects.toThrow(
      `Topic index ${String(topicIndex)} out of range (0–1)`,
    );
  });

  it.each([1.5, -1, 1])('rejects block index %s', async (blockIndex) => {
    const anton = await connected();
    await expect(anton.pinBlock({ project: 'c-mat-4', topicIndex: 0, blockIndex })).rejects.toThrow(
      `Block index ${String(blockIndex)} out of range (0–0)`,
    );
  });

  it('rejects unknown titles and missing topic or block', async () => {
    const anton = await connected();
    await expect(
      anton.pinBlock({ project: 'c-mat-4', topicTitle: 'nope', blockIndex: 0 }),
    ).rejects.toThrow('No topic matching "nope"');
    await expect(
      anton.pinBlock({ project: 'c-mat-4', topicIndex: 0, blockTitle: 'nope' }),
    ).rejects.toThrow('No block matching "nope"');
    await expect(anton.pinBlock({ project: 'c-mat-4', blockIndex: 0 })).rejects.toThrow(
      'Provide topicIndex or topicTitle when using project-based lookup',
    );
    await expect(anton.pinBlock({ project: 'c-mat-4', topicIndex: 0 })).rejects.toThrow(
      'Provide blockIndex or blockTitle when using project-based lookup',
    );
  });

  it('rejects an unknown child', async () => {
    const anton = await connected();
    await expect(
      anton.pinBlock({ blockPuid: 'p', blockPath: 'q', childName: 'Parent' }),
    ).rejects.toThrow(
      'Child "Parent" not found in group "Family". Use listChildren() to see member names or public IDs.',
    );
  });
});

// ---------------------------------------------------------------------------
// unpinBlock
// ---------------------------------------------------------------------------

describe('unpinBlock', () => {
  beforeEach(() => {
    c.getGroupEvents.mockResolvedValue([]);
    c.parsePinnedBlocks.mockReturnValue([
      pin('p/1', '2099-01-05', 'P-alice', 'created-alice'),
      pin('p/1', '2099-01-05', 'P-anon', 'created-anon'),
      pin('p/2', '2099-01-05', undefined, 'created-group'),
    ]);
    c.unpinGroupBlock.mockResolvedValue(undefined);
  });

  it('requires a connection', async () => {
    await expect(
      new Anton({}).unpinBlock({ blockPuid: 'p/1', weekStartAt: '2099-01-05' }),
    ).rejects.toThrow('Not connected');
  });

  it('removes the only matching pin', async () => {
    const anton = await connected();
    const result = await anton.unpinBlock({ blockPuid: 'p/2', weekStartAt: '2099-01-05' });
    expect(result).toEqual({
      unpinned: true,
      groupCode: 'G1',
      blockPuid: 'p/2',
      weekStartAt: '2099-01-05',
    });
    expect(c.unpinGroupBlock).toHaveBeenCalledWith('G1', 'created-group', 'L-parent', 'token');
  });

  it('picks the pin of the given child', async () => {
    const anton = await connected();
    await anton.unpinBlock({
      blockPuid: 'p/1',
      weekStartAt: '2099-01-05',
      childPublicId: 'P-anon',
    });
    expect(c.unpinGroupBlock).toHaveBeenCalledWith('G1', 'created-anon', 'L-parent', 'token');
  });

  it('fails when nothing matches', async () => {
    const anton = await connected();
    await expect(anton.unpinBlock({ blockPuid: 'p/1', weekStartAt: '2099-01-12' })).rejects.toThrow(
      'No pin found for puid=p/1 week=2099-01-12',
    );
    await expect(
      anton.unpinBlock({ blockPuid: 'p/1', weekStartAt: '2099-01-05', childPublicId: 'P-x' }),
    ).rejects.toThrow('No pin found');
  });

  it('fails when several pins match and no child is given', async () => {
    const anton = await connected();
    await expect(anton.unpinBlock({ blockPuid: 'p/1', weekStartAt: '2099-01-05' })).rejects.toThrow(
      'Multiple pins found for puid=p/1 week=2099-01-05; provide childPublicId to disambiguate',
    );
  });
});

// ---------------------------------------------------------------------------
// Progress / events
// ---------------------------------------------------------------------------

describe('getProgress', () => {
  it('reads the user log of a child with a logId', async () => {
    const anton = await connected();
    const events = [event('2099-01-01')];
    c.getUserEvents.mockResolvedValue(events);
    c.summariseProgress.mockReturnValue('summary' as never);

    expect(await anton.getProgress({ childName: 'Alice' })).toBe('summary');
    expect(c.getUserEvents).toHaveBeenCalledWith('L-alice', '1970-01-01');
    expect(c.summariseProgress).toHaveBeenCalledWith('L-alice', events);
  });

  it('reads the group member log of a child without logId', async () => {
    const anton = await connected();
    c.getGroupMemberEvents.mockResolvedValue([event('2099-01-01'), event('2099-02-01')]);

    await anton.getProgress({ childName: 'P-anon' });
    expect(c.getGroupMemberEvents).toHaveBeenCalledWith('P-anon', 'G1', 'L-parent', 'token');
    expect(c.summariseProgress).toHaveBeenLastCalledWith('P-anon', [
      event('2099-01-01'),
      event('2099-02-01'),
    ]);

    await anton.getProgress({ childName: 'P-anon', since: '2099-01-15' });
    expect(c.summariseProgress).toHaveBeenLastCalledWith('P-anon', [event('2099-02-01')]);
  });

  it('resolves the child in an explicit group', async () => {
    const anton = await connected();
    c.getGroupMemberEvents.mockResolvedValue([]);
    await anton.getProgress({ childName: 'Bob', groupName: 'Class', since: '2099-01-01' });
    expect(c.getGroupMemberEvents).toHaveBeenCalledWith('P-bob', 'G2', 'L-parent', 'token');
  });
});

describe('getEvents', () => {
  const events = [
    event('2099-01-02', 'finishLevel'),
    event('2099-01-03', 'startLevel'),
    event('2099-01-01', 'finishLevel'),
  ];

  it('returns the newest events of a child with a logId, limited to 100', async () => {
    const anton = await connected();
    c.getUserEvents.mockResolvedValue(Array.from({ length: 150 }, () => event('2099-01-01')));
    expect(await anton.getEvents({ childName: 'Alice' })).toHaveLength(100);
    expect(c.getUserEvents).toHaveBeenCalledWith('L-alice', '1970-01-01');
  });

  it('filters by type, sorts newest first and applies the limit', async () => {
    const anton = await connected();
    c.getGroupMemberEvents.mockResolvedValue(events);
    const result = await anton.getEvents({ childName: 'P-anon', eventType: 'finishLevel' });
    expect(result.map((e) => e.created)).toEqual(['2099-01-02', '2099-01-01']);

    const limited = await anton.getEvents({ childName: 'P-anon', limit: 1 });
    expect(limited.map((e) => e.created)).toEqual(['2099-01-03']);
  });

  it('filters group member events by date', async () => {
    const anton = await connected();
    c.getGroupMemberEvents.mockResolvedValue(events);
    const result = await anton.getEvents({ childName: 'P-anon', since: '2099-01-02' });
    expect(result.map((e) => e.created)).toEqual(['2099-01-03', '2099-01-02']);
  });
});

describe('getLevelProgress', () => {
  it('resolves a child name', async () => {
    const anton = await connected();
    c.getLevelReviewReport.mockResolvedValue({ status: 'ok', events: [] });
    expect(await anton.getLevelProgress({ levelPuid: 'lv', childName: 'Alice' })).toEqual({
      status: 'ok',
      events: [],
    });
    expect(c.getLevelReviewReport).toHaveBeenCalledWith('lv', 'P-alice', 'L-parent', 'token');
  });

  it('accepts a publicId directly', async () => {
    const anton = await connected();
    await anton.getLevelProgress({ levelPuid: 'lv', childPublicId: 'P-x' });
    expect(c.getLevelReviewReport).toHaveBeenCalledWith('lv', 'P-x', 'L-parent', 'token');
  });

  it('requires a child', async () => {
    const anton = await connected();
    await expect(anton.getLevelProgress({ levelPuid: 'lv' })).rejects.toThrow(
      'Provide childName or childPublicId',
    );
  });
});

// ---------------------------------------------------------------------------
// Lesson catalogue
// ---------------------------------------------------------------------------

describe('listPlans', () => {
  const plans: PlanSummary[] = [
    {
      project: 'c-mat-4',
      fileId: 'f1',
      etag: '1',
      title: 'Mathe 4',
      subject: 'Mathematik',
      grades: [4],
      totalBlocks: 10,
      totalLevels: 50,
      guiLanguages: ['de'],
    },
    {
      project: 'c-eng-5',
      fileId: 'f2',
      etag: '1',
      title: { de: 'Englisch 5', en: 'English 5' },
      subject: { de: 'Englisch', en: 'English' },
      grades: [5],
      guiLanguages: ['de', 'en'],
    },
    {
      project: 'c-fr-5',
      fileId: 'f3',
      etag: '1',
      title: { en: 'French 5' },
      subject: { en: 'French' },
      grades: [5],
      guiLanguages: ['de', 'en'],
    },
    {
      project: 'c-debug',
      fileId: 'f4',
      etag: '1',
      title: 'Debug',
      subject: 'Debug',
      grades: [1],
      guiLanguages: ['de'],
      isDebug: true,
    },
  ];

  beforeEach(() => {
    c.getPlansCatalogue.mockResolvedValue(plans);
  });

  it('lists German non-debug plans by default', async () => {
    const result = await (await connected()).listPlans();
    expect(result).toEqual([
      {
        project: 'c-mat-4',
        title: 'Mathe 4',
        subject: 'Mathematik',
        grades: [4],
        totalBlocks: 10,
        totalLevels: 50,
      },
      {
        project: 'c-eng-5',
        title: 'Englisch 5',
        subject: 'Englisch',
        grades: [5],
        totalBlocks: undefined,
        totalLevels: undefined,
      },
      {
        project: 'c-fr-5',
        title: 'c-fr-5',
        subject: '',
        grades: [5],
        totalBlocks: undefined,
        totalLevels: undefined,
      },
    ]);
  });

  it('filters by language, subject and grade', async () => {
    const anton = await connected();
    expect((await anton.listPlans({ language: 'en' })).map((p) => p.title)).toEqual([
      'English 5',
      'French 5',
    ]);
    expect((await anton.listPlans({ subject: 'MATH' })).map((p) => p.project)).toEqual(['c-mat-4']);
    expect((await anton.listPlans({ subject: 'engl' })).map((p) => p.project)).toEqual(['c-eng-5']);
    expect((await anton.listPlans({ grade: 5 })).map((p) => p.project)).toEqual([
      'c-eng-5',
      'c-fr-5',
    ]);
  });
});

describe('listTopics', () => {
  it('lists topic titles with indices', async () => {
    c.getPlan.mockResolvedValue(PLAN);
    expect(await (await connected()).listTopics({ project: 'c-mat-4' })).toEqual({
      project: 'c-mat-4',
      title: 'Mathe 4',
      topics: [
        { index: 0, title: 'Zahlen', puid: 'c-mat-4/topic-01-zahlen', totalBlocks: 1 },
        { index: 1, title: 'Brüche', puid: 'c-mat-4/topic-07-brueche', totalBlocks: 1 },
      ],
    });
  });
});

describe('getTopicBlocks', () => {
  beforeEach(() => {
    c.getPlan.mockResolvedValue(PLAN);
  });

  it('returns blocks and levels of a topic by index', async () => {
    const result = await (await connected()).getTopicBlocks({ project: 'c-mat-4', topicIndex: 0 });
    expect(result).toEqual({
      project: 'c-mat-4',
      topicTitle: 'Zahlen',
      topicPuid: 'c-mat-4/topic-01-zahlen',
      blocks: [
        {
          title: 'Zählen',
          puid: 'c-mat-4/block-01-zaehlen',
          blockPath: '/../c-mat-4/topic-01-zahlen/block-01-zaehlen/block',
          totalLevels: 2,
          levels: [
            { title: 'L1', puid: 'c-mat-4/l1', type: 'normal', fileId: 'level/c-mat-4/l1' },
            { title: 'L2', puid: 'c-mat-4/l2', type: undefined },
          ],
        },
      ],
    });
  });

  it('finds a topic by partial title', async () => {
    const result = await (
      await connected()
    ).getTopicBlocks({ project: 'c-mat-4', topicTitle: 'BRÜ' });
    expect(result.topicTitle).toBe('Brüche');
  });

  it.each([0.5, -1, 2])('rejects topic index %s', async (topicIndex) => {
    await expect(
      (await connected()).getTopicBlocks({ project: 'c-mat-4', topicIndex }),
    ).rejects.toThrow(`Topic index ${String(topicIndex)} out of range (0–1)`);
  });

  it('rejects an unknown title and a missing topic', async () => {
    const anton = await connected();
    await expect(anton.getTopicBlocks({ project: 'c-mat-4', topicTitle: 'nope' })).rejects.toThrow(
      'No topic matching "nope"',
    );
    await expect(anton.getTopicBlocks({ project: 'c-mat-4' })).rejects.toThrow(
      'Provide topicIndex or topicTitle',
    );
  });
});

describe('getPlan', () => {
  it('returns the full hierarchy', async () => {
    c.getPlan.mockResolvedValue(PLAN);
    const result = await (await connected()).getPlan({ project: 'c-mat-4' });
    expect(result).toMatchObject({
      title: 'Mathe 4',
      project: 'c-mat-4',
      totalBlocks: 2,
      totalLevels: 3,
    });
    expect(result.topics).toHaveLength(2);
    expect(result.topics[1]?.blocks[0]?.blockPath).toBe(
      '/../c-mat-4/topic-07-brueche/block-02-brueche-zuordnen/block',
    );
  });
});

describe('getLesson', () => {
  it('fetches lesson content by fileId', async () => {
    c.getLessonContent.mockResolvedValue({ title: 'L', puid: 'p', trainers: [] });
    expect(await (await connected()).getLesson({ fileId: 'level/x' })).toEqual({
      title: 'L',
      puid: 'p',
      trainers: [],
    });
    expect(c.getLessonContent).toHaveBeenCalledWith('level/x');
  });
});

// ---------------------------------------------------------------------------
// Analysis
// ---------------------------------------------------------------------------

describe('checkAssignmentCompletion', () => {
  const pins = [
    pin('c-mat-4/b1', '2099-01-05'),
    pin('c-eng-5/b2', '2099-01-05', 'P-alice'),
    pin('c-fr-5/b3', '2099-01-05', 'P-anon'),
    pin('c-mat-4/b4', '2099-01-12', 'P-alice'),
  ];
  const finish = { ...event('2099-01-06'), puid: 'c-mat-4/l1' };

  beforeEach(() => {
    c.getGroupEvents.mockResolvedValue([]);
    c.parsePinnedBlocks.mockReturnValue(pins);
    c.getPlan.mockImplementation((p) => Promise.resolve({ ...PLAN, project: p }));
    c.getUserEvents.mockResolvedValue([finish, event('2099-01-06', 'startLevel')]);
  });

  it('loads plans of the relevant pins and passes finished levels', async () => {
    const anton = await connected();
    expect(await anton.checkAssignmentCompletion({ childName: 'Alice' })).toBe('completion');
    expect(c.getPlan.mock.calls.map(([p]) => p)).toEqual(['c-mat-4', 'c-eng-5']);
    const [name, allPins, planCache, events, week, publicId] =
      a.checkAssignmentCompletion.mock.calls[0] ?? [];
    expect(name).toBe('Alice');
    expect(allPins).toBe(pins);
    expect([...(planCache?.keys() ?? [])]).toEqual(['c-mat-4', 'c-eng-5']);
    expect(events).toEqual([finish]);
    expect(week).toBeUndefined();
    expect(publicId).toBe('P-alice');
  });

  it('limits the plans to the given week', async () => {
    const anton = await connected();
    await anton.checkAssignmentCompletion({ childName: 'Alice', week: '2099-01-12' });
    expect(c.getPlan.mock.calls.map(([p]) => p)).toEqual(['c-mat-4']);
    expect(a.checkAssignmentCompletion.mock.calls[0]?.[4]).toBe('2099-01-12');
  });
});

describe('getWeeklySummary', () => {
  beforeEach(() => {
    c.getGroupEvents.mockResolvedValue([]);
    c.parsePinnedBlocks.mockReturnValue([
      pin('p/1', '2099-01-05'),
      pin('p/2', '2099-01-05', 'P-anon'),
      pin('p/3', '2099-01-05', 'P-alice'),
      pin('p/4', '2099-01-12'),
    ]);
    c.getGroupMemberEvents.mockResolvedValue([]);
  });

  it('passes the assigned blocks of the week to the analysis', async () => {
    const anton = await connected();
    expect(await anton.getWeeklySummary({ childName: 'P-anon', weekStartAt: '2099-01-05' })).toBe(
      'weekly',
    );
    expect(a.getWeeklySummary).toHaveBeenCalledWith(
      'P-anon',
      '2099-01-05',
      [],
      new Set(['p/1', 'p/2']),
    );
  });

  it('defaults to the current week', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2099-01-12T08:00:00Z')); // Monday
    const anton = await connected();
    await anton.getWeeklySummary({ childName: 'P-anon' });
    expect(a.getWeeklySummary).toHaveBeenCalledWith('P-anon', '2099-01-12', [], new Set(['p/4']));
  });
});

describe('getSubjectSummary', () => {
  it('passes finished levels and the subject filter', async () => {
    const anton = await connected();
    c.getUserEvents.mockResolvedValue([]);
    expect(await anton.getSubjectSummary({ childName: 'Alice', subject: 'mat' })).toBe('subjects');
    expect(a.getSubjectSummary).toHaveBeenCalledWith('Alice', [], 'mat');
  });
});

describe('getActivityTimeline', () => {
  it('passes the start date for a child with a logId', async () => {
    const anton = await connected();
    c.getUserEvents.mockResolvedValue([]);
    expect(await anton.getActivityTimeline({ childName: 'Alice', since: '2099-01-01' })).toBe(
      'timeline',
    );
    expect(c.getUserEvents).toHaveBeenCalledWith('L-alice', '2099-01-01');
    expect(a.getActivityTimeline).toHaveBeenCalledWith('Alice', [], '2099-01-01');
  });

  it('filters group member events by the start date', async () => {
    const anton = await connected();
    const late = { ...event('2099-02-01'), puid: 'x' };
    c.getGroupMemberEvents.mockResolvedValue([event('2099-01-01'), late]);
    await anton.getActivityTimeline({ childName: 'P-anon', since: '2099-01-15' });
    expect(a.getActivityTimeline).toHaveBeenCalledWith('P-anon', [late], '2099-01-15');
  });

  it('defaults to all time', async () => {
    const anton = await connected();
    c.getGroupMemberEvents.mockResolvedValue([event('2099-01-01')]);
    await anton.getActivityTimeline({ childName: 'P-anon' });
    expect(a.getActivityTimeline).toHaveBeenCalledWith(
      'P-anon',
      [event('2099-01-01')],
      '1970-01-01',
    );
  });
});

describe('compareChildren', () => {
  it('collects finished levels for every pupil', async () => {
    const anton = await connected();
    c.getUserEvents.mockResolvedValue([event('2099-01-01')]);
    c.getGroupMemberEvents.mockResolvedValue([]);
    expect(await anton.compareChildren()).toBe('compare');
    expect(a.compareChildren).toHaveBeenCalledWith([
      { name: 'Alice', finishEvents: [event('2099-01-01')] },
      { name: 'P-anon', finishEvents: [] },
    ]);
  });

  it('uses an explicit group', async () => {
    const anton = await connected();
    c.getGroupMemberEvents.mockResolvedValue([]);
    await anton.compareChildren({ groupName: 'Class' });
    expect(a.compareChildren).toHaveBeenCalledWith([{ name: 'Bob', finishEvents: [] }]);
  });
});

// ---------------------------------------------------------------------------
// Local assignments
// ---------------------------------------------------------------------------

describe('local assignments', () => {
  it('creates, lists, updates and deletes assignments', async () => {
    const anton = await connected();
    const created = anton.assignLesson({ childName: 'Alice', fileId: 'level/x', note: 'n' });
    expect(created).toMatchObject({ childName: 'Alice', status: 'pending' });
    expect(anton.listAssignments({ childName: 'Alice' })).toHaveLength(1);

    const updated = anton.updateAssignment(created.id, { status: 'completed' });
    expect(updated.status).toBe('completed');
    expect(anton.listAssignments({ status: 'pending' })).toHaveLength(0);

    anton.deleteAssignment(created.id);
    expect(anton.listAssignments()).toEqual([]);
  });
});
