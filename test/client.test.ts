/**
 * Unit tests for client.ts — axios is mocked, no network access.
 */

import axios, { AxiosError, AxiosHeaders, type AxiosResponse } from 'axios';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  extractGroupCodes,
  extractPublicId,
  getEvents,
  getGroupEvents,
  getGroupMemberDescriptions,
  getGroupMemberEvents,
  getLessonContent,
  getLevelReviewReport,
  getPlan,
  getPlansCatalogue,
  getUserEvents,
  loginWithCode,
  loginWithLogId,
  parseGroupInfo,
  parsePinnedBlocks,
  pinGroupBlock,
  summariseProgress,
  unpinGroupBlock,
} from '../src/client.js';
import type { AntonEvent } from '../src/types.js';

const DEVICE_LOG_ID = 'D-YT8Q-uusgorxroQWveIBP2afCCXK3pYR';
const SUBSCRIBE_URL = 'https://apis-db-logger-s-lb-2.anton.app/apisLogger/subscribe/';
const CONTENT_URL = 'https://content.anton.app/files/';
const CONTENT_HEADERS = { Accept: 'application/json', Origin: 'https://anton.app' };

let post: ReturnType<typeof vi.spyOn>;
let get: ReturnType<typeof vi.spyOn>;

function reply<T>(data: T): AxiosResponse<T> {
  return { data } as AxiosResponse<T>;
}

function axiosError(status?: number, data?: unknown): AxiosError {
  const response =
    status === undefined
      ? undefined
      : ({
          status,
          data,
          statusText: '',
          headers: {},
          config: { headers: new AxiosHeaders() },
        } as AxiosResponse);
  return new AxiosError('request failed', 'ERR_BAD_RESPONSE', undefined, undefined, response);
}

/** The [url, body, config] of the n-th axios.post call. */
function postCall(n = 0): [string, Record<string, unknown>, Record<string, unknown>] {
  return post.mock.calls[n] as [string, Record<string, unknown>, Record<string, unknown>];
}

beforeEach(() => {
  post = vi.spyOn(axios, 'post');
  get = vi.spyOn(axios, 'get');
});

afterEach(() => {
  vi.restoreAllMocks();
});

// ---------------------------------------------------------------------------
// Auth
// ---------------------------------------------------------------------------

describe('loginWithCode', () => {
  it('posts the code to the login endpoint and returns the session', async () => {
    const session = { loginCode: 'ABCD-1234', logId: 'L-1', authToken: 'tok', displayName: 'P' };
    post.mockResolvedValue(reply(session));

    await expect(loginWithCode('ABCD-1234')).resolves.toEqual(session);

    const [url, body, cfg] = postCall();
    expect(url).toBe('https://d-apis-db.anton.app/?p=login/step1/step1');
    expect(body).toEqual({
      deviceLogId: DEVICE_LOG_ID,
      isDebug: false,
      useAuthToken: true,
      authToken: 'noStoredAuthTokenFound',
      path: '/../server-apis-db2/apis/login/step1/step1',
      params: { value: 'ABCD-1234', checkCaptcha: false },
    });
    expect(body).not.toHaveProperty('logId');
    expect(cfg).toMatchObject({
      timeout: 30_000,
      headers: { 'Content-Type': 'application/json', Origin: 'https://anton.app' },
    });
  });

  it('throws the API message on status "error"', async () => {
    post.mockResolvedValue(reply({ status: 'error', message: 'wrong code' }));
    await expect(loginWithCode('X')).rejects.toThrow('Anton API error: wrong code');
  });

  it('falls back to the status when an error has no message', async () => {
    post.mockResolvedValue(reply({ status: 'error' }));
    await expect(loginWithCode('X')).rejects.toThrow('Anton API error: error');
  });

  it('throws "Unknown API error" for error: true without message or status', async () => {
    post.mockResolvedValue(reply({ error: true }));
    await expect(loginWithCode('X')).rejects.toThrow('Anton API error: Unknown API error');
  });

  it('treats error: "true" as a failure', async () => {
    post.mockResolvedValue(reply({ error: 'true', message: 'nope' }));
    await expect(loginWithCode('X')).rejects.toThrow('Anton API error: nope');
  });

  it('accepts non-object responses', async () => {
    post.mockResolvedValue(reply('ok'));
    await expect(loginWithCode('X')).resolves.toBe('ok');
    post.mockResolvedValue(reply(null));
    await expect(loginWithCode('X')).resolves.toBeNull();
  });
});

describe('loginWithLogId', () => {
  it('logs in with the newest setLoginCode value', async () => {
    get.mockResolvedValue(
      reply({
        events: [
          { event: 'setLoginCode', value: 'OLD', created: '2024-01-01T00:00:00Z' },
          { event: 'setLoginCode', value: 'NEW', created: '2025-01-01T00:00:00Z' },
          { event: 'setLoginCode', value: 'MID', created: '2024-06-01T00:00:00Z' },
          { event: 'setLoginCode', value: 42, created: '2026-01-01T00:00:00Z' },
          { event: 'finishLevel', created: '2027-01-01T00:00:00Z' },
        ],
      }),
    );
    post.mockResolvedValue(reply({ logId: 'L-1', authToken: 'tok' }));

    await expect(loginWithLogId('L-1')).resolves.toEqual({ logId: 'L-1', authToken: 'tok' });
    expect(get.mock.calls[0]?.[1]).toMatchObject({
      params: { 'params[logId]': 'L-1', 'params[filter][name]': 'subscribeUser' },
    });
    expect(postCall()[1]).toMatchObject({ params: { value: 'NEW' } });
  });

  it('throws when the log has no setLoginCode event', async () => {
    get.mockResolvedValue(reply({ events: [] }));
    await expect(loginWithLogId('L-9')).rejects.toThrow(
      'No setLoginCode event found for logId L-9',
    );
    expect(post).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// Events
// ---------------------------------------------------------------------------

describe('getEvents', () => {
  it('queries the subscribe endpoint with defaults', async () => {
    const events = [{ event: 'finishLevel', created: '2025-01-01' }];
    get.mockResolvedValue(reply({ events, totalEvents: 1 }));

    await expect(getEvents('L-1')).resolves.toEqual(events);
    expect(get).toHaveBeenCalledWith(SUBSCRIBE_URL, {
      params: {
        path: 'subscribe',
        'params[logId]': 'L-1',
        'params[filter][name]': 'subscribeUser',
        'params[inserted]': '1970-01-01',
        'params[readOnly]': 'true',
        deviceLogId: DEVICE_LOG_ID,
      },
      headers: expect.objectContaining({ Origin: 'https://anton.app' }) as unknown,
      timeout: 30_000,
    });
  });

  it('returns an empty array when the response has no events', async () => {
    get.mockResolvedValue(reply({}));
    await expect(getEvents('L-1')).resolves.toEqual([]);
  });

  it('throws on an API error response', async () => {
    get.mockResolvedValue(reply({ status: 'error', message: 'bad log' }));
    await expect(getEvents('L-1')).rejects.toThrow('Anton API error: bad log');
  });

  it('getUserEvents and getGroupEvents pass filter and since', async () => {
    get.mockResolvedValue(reply({ events: [] }));
    await getUserEvents('L-1', '2025-01-01');
    await getGroupEvents('GROUP-1', '2025-02-02');
    await getGroupEvents('GROUP-2');

    const params = get.mock.calls.map((c) => (c[1] as { params: Record<string, string> }).params);
    expect(params[0]).toMatchObject({
      'params[logId]': 'L-1',
      'params[filter][name]': 'subscribeUser',
      'params[inserted]': '2025-01-01',
    });
    expect(params[1]).toMatchObject({
      'params[logId]': 'GROUP-1',
      'params[filter][name]': 'subscribeGroup',
      'params[inserted]': '2025-02-02',
    });
    expect(params[2]).toMatchObject({ 'params[inserted]': '1970-01-01' });
  });
});

// ---------------------------------------------------------------------------
// Pure event parsers
// ---------------------------------------------------------------------------

describe('extractPublicId', () => {
  it('returns the first string setPublicId value', () => {
    const events = [
      { event: 'setLoginCode', value: 'X', created: '' },
      { event: 'setPublicId', value: 7, created: '' },
      { event: 'setPublicId', value: 'P-1', created: '' },
      { event: 'setPublicId', value: 'P-2', created: '' },
    ] as AntonEvent[];
    expect(extractPublicId(events)).toBe('P-1');
  });

  it('returns undefined without a setPublicId event', () => {
    expect(extractPublicId([])).toBeUndefined();
  });
});

describe('extractGroupCodes', () => {
  it('returns distinct, sorted group codes', () => {
    const events = [
      { event: 'isGroupMember', groupCode: 'GROUP-B', created: '' },
      { event: 'isGroupMember', groupCode: 'GROUP-A', created: '' },
      { event: 'isGroupMember', groupCode: 'GROUP-B', created: '' },
      { event: 'isGroupMember', groupCode: 5, created: '' },
      { event: 'setPublicId', groupCode: 'GROUP-C', created: '' },
    ] as AntonEvent[];
    expect(extractGroupCodes(events)).toEqual(['GROUP-A', 'GROUP-B']);
  });
});

describe('parseGroupInfo', () => {
  it('defaults name and type when the log has no group events', () => {
    expect(parseGroupInfo('GROUP-1', [])).toEqual({
      groupCode: 'GROUP-1',
      groupType: 'family',
      groupName: 'GROUP-1',
      members: [],
    });
  });

  it('reads type, name, members (deduplicated) and plus status', () => {
    const events = [
      { event: 'setGroupType', value: 'class', created: '' },
      { event: 'setGroupType', value: 1, created: '' },
      { event: 'setGroupName', value: 'Family', created: '' },
      { event: 'setGroupName', value: null, created: '' },
      { event: 'setGroupMember', publicId: 'P-1', role: 'pupil', created: '' },
      { event: 'setGroupMember', publicId: 'P-2', role: 'admin', created: '' },
      {
        event: 'setGroupMember',
        publicId: 'P-1',
        role: 'teacher',
        originalCreatedAt: '2024-01-01',
        created: '',
      },
      { event: 'isPlus', validUntil: '2030-01-01', created: '' },
      { event: 'isPlus', validUntil: 3, created: '' },
      { event: 'unrelated', created: '' },
    ] as AntonEvent[];

    expect(parseGroupInfo('GROUP-1', events)).toEqual({
      groupCode: 'GROUP-1',
      groupType: 'class',
      groupName: 'Family',
      members: [
        { publicId: 'P-1', role: 'teacher', originalCreatedAt: '2024-01-01' },
        { publicId: 'P-2', role: 'admin', originalCreatedAt: undefined },
      ],
      isPlus: true,
      plusValidUntil: '2030-01-01',
    });
  });
});

const base = {
  event: 'pinGroupBlock',
  puid: 'c-mat-4/ro9ajj',
  block: '/../c-mat-4/topic-07-brueche/block-02-brueche-zuordnen/block',
  weekStartAt: '2099-01-05',
  created: '2099-01-05T00:00:00.000Z',
};

describe('parsePinnedBlocks', () => {
  it('reads the child from the legacy subgroup field', () => {
    const [pin] = parsePinnedBlocks([{ ...base, subgroup: 'P-legacy' } as AntonEvent]);
    expect(pin?.subgroup).toBe('P-legacy');
  });

  it('reads the child from the members array', () => {
    const [pin] = parsePinnedBlocks([{ ...base, members: ['P-member'] } as AntonEvent]);
    expect(pin?.subgroup).toBe('P-member');
  });

  it('treats an empty members array as a group-wide pin', () => {
    const [pin] = parsePinnedBlocks([{ ...base, members: [] } as AntonEvent]);
    expect(pin?.subgroup).toBeUndefined();
  });

  it('treats several members, non-string members or no members as group-wide', () => {
    const pins = parsePinnedBlocks([
      { ...base, members: ['P-1', 'P-2'] },
      { ...base, members: [5] },
      { ...base },
    ] as AntonEvent[]);
    expect(pins.map((p) => p.subgroup)).toEqual([undefined, undefined, undefined]);
  });

  it('maps all pin fields', () => {
    expect(parsePinnedBlocks([{ ...base, subgroup: 'P-1' } as AntonEvent])).toEqual([
      {
        puid: base.puid,
        block: base.block,
        weekStartAt: base.weekStartAt,
        subgroup: 'P-1',
        created: base.created,
      },
    ]);
  });

  it('ignores non-pin events', () => {
    expect(parsePinnedBlocks([{ ...base, event: 'pinGroupLearnList' } as AntonEvent])).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// Pin / unpin
// ---------------------------------------------------------------------------

describe('pinGroupBlock', () => {
  it('posts a pinContent/create request for a single child', async () => {
    vi.spyOn(Math, 'random').mockReturnValue(0.5); // → "d"
    post.mockResolvedValue(reply({ status: 'ok' }));

    await pinGroupBlock(
      'GROUP-1',
      'c-mat-4/x',
      '/../c-mat-4/t/b/block',
      '2099-01-05',
      'L-1',
      'tok',
      'P-1',
    );

    const [url, body, cfg] = postCall();
    expect(url).toBe('https://d-apis-db.anton.app/?p=group/pinContent/create/query');
    expect(body).toEqual({
      params: {
        groupCode: 'GROUP-1',
        pinContent: { type: 'block', puid: 'c-mat-4/x', path: '/../c-mat-4/t/b/block' },
        weekStartAt: '2099-01-05',
        members: ['P-1'],
        unselectedLevels: [],
      },
      path: '/../server-apis-db2/apis/group/pinContent/create/query',
      logId: 'L-1',
      deviceLogId: DEVICE_LOG_ID,
      isDebug: false,
      useAuthToken: true,
      authToken: 'tok',
    });
    expect(cfg).toMatchObject({ timeout: 30_000 });
  });

  it('pins for the whole group without a child', async () => {
    post.mockResolvedValue(reply({}));
    await pinGroupBlock('GROUP-1', 'p', 'b', '2099-01-05', 'L-1', 'tok');
    expect(postCall()[1]).toMatchObject({ params: { members: [] } });
    expect(postCall()[0]).toMatch(/^https:\/\/[a-f]-apis-db\.anton\.app\//);
  });

  it('wraps HTTP errors with status and response body', async () => {
    post.mockRejectedValue(axiosError(403, { reason: 'forbidden' }));
    const p = pinGroupBlock('GROUP-1', 'p', 'b', 'w', 'L-1', 'tok');
    await expect(p).rejects.toThrow('pinGroupBlock failed: HTTP 403 — {"reason":"forbidden"}');
    await expect(p).rejects.toHaveProperty('cause');
  });

  it('reports "unknown" status when there is no HTTP response', async () => {
    post.mockRejectedValue(axiosError());
    await expect(pinGroupBlock('G', 'p', 'b', 'w', 'L', 't')).rejects.toThrow(
      'pinGroupBlock failed: HTTP unknown — undefined',
    );
  });

  it('rethrows API error responses unchanged', async () => {
    post.mockResolvedValue(reply({ status: 'error', message: 'denied' }));
    await expect(pinGroupBlock('G', 'p', 'b', 'w', 'L', 't')).rejects.toThrow(
      'Anton API error: denied',
    );
  });

  it('runs concurrent pins one after another, even after a failure', async () => {
    const order: string[] = [];
    let release!: () => void;
    post
      .mockImplementationOnce(
        () =>
          new Promise((resolve, reject) => {
            order.push('start 1');
            release = () => {
              order.push('end 1');
              reject(new Error('first failed'));
            };
          }),
      )
      .mockImplementationOnce(() => {
        order.push('start 2');
        return Promise.resolve(reply({}));
      });

    const first = pinGroupBlock('G', 'p1', 'b', 'w', 'L', 't');
    const second = pinGroupBlock('G', 'p2', 'b', 'w', 'L', 't');
    await vi.waitFor(() => expect(order).toEqual(['start 1']));
    release();

    await expect(first).rejects.toThrow('first failed');
    await expect(second).resolves.toBeUndefined();
    expect(order).toEqual(['start 1', 'end 1', 'start 2']);
  });
});

describe('unpinGroupBlock', () => {
  it('posts a pinContent/delete request', async () => {
    vi.spyOn(Math, 'random').mockReturnValue(0); // → "a"
    post.mockResolvedValue(reply({ status: 'ok' }));

    await unpinGroupBlock('GROUP-1', '2099-01-05T00:00:00.000Z', 'L-1', 'tok');

    const [url, body] = postCall();
    expect(url).toBe('https://a-apis-db.anton.app/?p=group/pinContent/delete/query');
    expect(body).toEqual({
      params: { groupCode: 'GROUP-1', pinCreatedAt: '2099-01-05T00:00:00.000Z' },
      path: '/../server-apis-db2/apis/group/pinContent/delete/query',
      logId: 'L-1',
      deviceLogId: DEVICE_LOG_ID,
      isDebug: false,
      useAuthToken: true,
      authToken: 'tok',
    });
  });

  it('wraps HTTP errors with status and response body', async () => {
    post.mockRejectedValue(axiosError(500, 'boom'));
    await expect(unpinGroupBlock('G', 'c', 'L', 't')).rejects.toThrow(
      'unpinGroupBlock failed: HTTP 500 — "boom"',
    );
  });

  it('reports "unknown" status when there is no HTTP response', async () => {
    post.mockRejectedValue(axiosError());
    await expect(unpinGroupBlock('G', 'c', 'L', 't')).rejects.toThrow(
      'unpinGroupBlock failed: HTTP unknown',
    );
  });

  it('rethrows API error responses unchanged', async () => {
    post.mockResolvedValue(reply({ error: true, message: 'gone' }));
    await expect(unpinGroupBlock('G', 'c', 'L', 't')).rejects.toThrow('Anton API error: gone');
  });
});

// ---------------------------------------------------------------------------
// Content
// ---------------------------------------------------------------------------

describe('content API', () => {
  it('getPlansCatalogue returns the plans list', async () => {
    const plans = [{ project: 'c-mat-4' }];
    get.mockResolvedValue(reply({ plans }));
    await expect(getPlansCatalogue()).resolves.toEqual(plans);
    expect(get).toHaveBeenCalledWith(CONTENT_URL, {
      params: { fileId: 'list/plans', etag: 'latest' },
      headers: CONTENT_HEADERS,
      timeout: 30_000,
    });
  });

  it('getPlan requests plan/{project} with default and custom etag', async () => {
    get.mockResolvedValue(reply({ project: 'c-mat-4' }));
    await expect(getPlan('c-mat-4')).resolves.toEqual({ project: 'c-mat-4' });
    await getPlan('c-mat-4', 'abc');
    expect(get.mock.calls[0]?.[1]).toMatchObject({ params: { fileId: 'plan/c-mat-4', etag: '0' } });
    expect(get.mock.calls[1]?.[1]).toMatchObject({ params: { etag: 'abc' } });
  });

  it.each([
    ['c-mat-4/t/b/level-01', 'level/c-mat-4/t/b/level-01'],
    ['level/c-mat-4/t/b/level-01', 'level/c-mat-4/t/b/level-01'],
    ['/../c-mat-4/t/b/level-01', 'level/c-mat-4/t/b/level-01'],
  ])('getLessonContent normalises %s', async (input, fileId) => {
    get.mockResolvedValue(reply({ title: 'L' }));
    await expect(getLessonContent(input)).resolves.toEqual({ title: 'L' });
    expect(get).toHaveBeenCalledWith(CONTENT_URL, {
      params: { fileId, etag: '0' },
      headers: CONTENT_HEADERS,
      timeout: 30_000,
    });
  });

  it('getLessonContent passes a custom etag', async () => {
    get.mockResolvedValue(reply({}));
    await getLessonContent('x', 'e1');
    expect(get.mock.calls[0]?.[1]).toMatchObject({ params: { etag: 'e1' } });
  });
});

// ---------------------------------------------------------------------------
// pllsCall endpoints
// ---------------------------------------------------------------------------

describe('getGroupMemberDescriptions', () => {
  it('posts to getDescriptions and flattens pupils, teachers and admins', async () => {
    vi.spyOn(Math, 'random').mockReturnValue(0.99); // → "f"
    post.mockResolvedValue(
      reply({
        status: 'ok',
        memberDescriptions: {
          pupil: [{ publicId: 'P-1', role: 'pupil', displayName: 'Kid' }],
          teacher: [{ publicId: 'P-2', role: 'teacher', displayName: 'T' }],
          admin: [{ publicId: 'P-3', role: 'admin', displayName: 'A' }],
        },
      }),
    );

    const members = await getGroupMemberDescriptions('GROUP-1', 'L-1', 'tok');
    expect(members.map((m) => m.publicId)).toEqual(['P-1', 'P-2', 'P-3']);

    const [url, body, cfg] = postCall();
    expect(url).toBe('https://f-apis-db.anton.app/?p=group/members/getDescriptions/get');
    expect(body).toEqual({
      params: { groupCode: 'GROUP-1' },
      path: '/../server-apis-db2/apis/group/members/getDescriptions/get',
      logId: 'L-1',
      deviceLogId: DEVICE_LOG_ID,
      isDebug: false,
      useAuthToken: true,
      authToken: 'tok',
    });
    expect(cfg).toMatchObject({ timeout: 30_000 });
  });

  it('throws on an API error response', async () => {
    post.mockResolvedValue(reply({ status: 'error', message: 'no access' }));
    await expect(getGroupMemberDescriptions('G', 'L', 't')).rejects.toThrow(
      'Anton API error: no access',
    );
  });
});

describe('getGroupMemberEvents', () => {
  it('flattens event data into AntonEvent objects', async () => {
    post.mockResolvedValue(
      reply({
        status: 'ok',
        events: [{ created: '2025-01-01', event: 'finishLevel', data: { puid: 'c-mat-4/x' } }],
      }),
    );
    await expect(getGroupMemberEvents('P-1', 'GROUP-1', 'L-1', 'tok')).resolves.toEqual([
      { created: '2025-01-01', event: 'finishLevel', puid: 'c-mat-4/x' },
    ]);
    expect(postCall()[0]).toMatch(/\?p=getUserTimelineEvents\/query$/);
    expect(postCall()[1]).toMatchObject({ params: { publicId: 'P-1', groupCode: 'GROUP-1' } });
  });

  it('returns an empty array without events', async () => {
    post.mockResolvedValue(reply({ status: 'ok' }));
    await expect(getGroupMemberEvents('P', 'G', 'L', 't')).resolves.toEqual([]);
  });
});

describe('getLevelReviewReport', () => {
  it('posts to level/reviewReport/get and returns the report', async () => {
    const report = { status: 'ok', events: [] };
    post.mockResolvedValue(reply(report));
    await expect(getLevelReviewReport('c-mat-4/l', 'P-1', 'L-1', 'tok')).resolves.toEqual(report);
    expect(postCall()[0]).toMatch(/\?p=level\/reviewReport\/get$/);
    expect(postCall()[1]).toMatchObject({
      params: { levelPuid: 'c-mat-4/l', publicId: 'P-1' },
      logId: 'L-1',
      authToken: 'tok',
    });
  });
});

// ---------------------------------------------------------------------------
// summariseProgress
// ---------------------------------------------------------------------------

describe('summariseProgress', () => {
  const finish = (puid: string, created: string, score: number, blockPuid: string) =>
    ({ event: 'finishLevel', puid, created, score, blockPuid }) as unknown as AntonEvent;

  it('counts events, keeps the latest run per level and sums stars per project', () => {
    const events = [
      finish('c-mat-4/a', '2025-01-01T00:00:00Z', 1, 'c-mat-4/blk1'),
      finish('c-mat-4/a', '2025-01-03T00:00:00Z', 3, 'c-mat-4/blk1'),
      finish('c-mat-4/a', '2025-01-02T00:00:00Z', 2, 'c-mat-4/blk1'),
      finish('c-mat-4/b', '2025-01-02T00:00:00Z', 2, 'c-mat-4/blk2'),
      finish('c-deu-2/c', '2025-01-04T00:00:00Z', 1, 'c-deu-2/blk3'),
      { event: 'adjustCoins', created: '2025-01-05T00:00:00Z' } as AntonEvent,
    ];

    const summary = summariseProgress('L-1', events);
    expect(summary.logId).toBe('L-1');
    expect(summary.totalEvents).toBe(6);
    expect(summary.eventCounts).toEqual({ finishLevel: 5, adjustCoins: 1 });
    expect(summary.completedLevels.map((e) => [e.puid, e.score])).toEqual([
      ['c-deu-2/c', 1],
      ['c-mat-4/a', 3],
      ['c-mat-4/b', 2],
    ]);
    expect(summary.starsByProject).toEqual({ 'c-mat-4': 5, 'c-deu-2': 1 });
    expect(summary.distinctBlocksCompleted).toBe(3);
  });

  it('handles an empty event list', () => {
    expect(summariseProgress('L-1', [])).toEqual({
      logId: 'L-1',
      totalEvents: 0,
      eventCounts: {},
      completedLevels: [],
      starsByProject: {},
      distinctBlocksCompleted: 0,
    });
  });
});
