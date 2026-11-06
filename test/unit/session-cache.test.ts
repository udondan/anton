/**
 * Unit tests for the CLI session cache, using temp files only.
 */

import { existsSync, mkdtempSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { homedir, tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, afterEach, describe, expect, it, vi } from 'vitest';

import {
  clearCache,
  defaultCachePath,
  GROUP_INFO_TTL_MS,
  isGroupInfoFresh,
  readCache,
  updateGroupInfoCache,
  writeCache,
  type CacheEntry,
} from '../../src/session-cache.js';
import type { GroupInfo, Session } from '../../src/types.js';

const tmpDir = mkdtempSync(join(tmpdir(), 'anton-session-cache-test-'));
afterAll(() => rmSync(tmpDir, { recursive: true, force: true }));

let counter = 0;
function tmpPath(): string {
  return join(tmpDir, `cache-${++counter}`, 'session.json');
}

function writeRaw(content: unknown): string {
  const p = join(tmpDir, `raw-${++counter}.json`);
  writeFileSync(p, typeof content === 'string' ? content : JSON.stringify(content));
  return p;
}

const SESSION = { logId: 'L-1', authToken: 'tok' } as unknown as Session;
const GROUPS = [{ groupCode: 'G-1' }] as unknown as GroupInfo[];

afterEach(() => {
  vi.restoreAllMocks();
});

describe('defaultCachePath', () => {
  it('points into ~/.config/anton', () => {
    expect(defaultCachePath()).toBe(join(homedir(), '.config', 'anton', 'session.json'));
  });
});

describe('writeCache / readCache', () => {
  it('round-trips an entry with mode 0600', () => {
    const p = tmpPath();
    writeCache('CODE', SESSION, GROUPS, p);
    const entry = readCache('CODE', p);
    expect(entry).toMatchObject({ credential: 'CODE', session: SESSION, groups: GROUPS });
    expect(typeof entry?.groupInfoCachedAt).toBe('number');
    if (process.platform !== 'win32') {
      expect(statSync(p).mode & 0o777).toBe(0o600);
    }
  });

  it('returns null when the file does not exist', () => {
    expect(readCache('CODE', join(tmpDir, 'missing.json'))).toBeNull();
  });

  it('returns null for a different credential', () => {
    const p = tmpPath();
    writeCache('CODE', SESSION, GROUPS, p);
    expect(readCache('OTHER', p)).toBeNull();
  });

  it('returns null for invalid JSON', () => {
    expect(readCache('CODE', writeRaw('{nope'))).toBeNull();
  });

  it('migrates the old single-groupInfo format', () => {
    const p = writeRaw({
      credential: 'CODE',
      session: SESSION,
      groupInfo: GROUPS[0],
      groupInfoCachedAt: 1,
    });
    expect(readCache('CODE', p)?.groups).toEqual(GROUPS);
  });

  it('does not migrate when groups is already present', () => {
    const p = writeRaw({
      credential: 'CODE',
      session: SESSION,
      groupInfo: { groupCode: 'OLD' },
      groups: GROUPS,
      groupInfoCachedAt: 1,
    });
    expect(readCache('CODE', p)?.groups).toEqual(GROUPS);
  });

  it.each([
    ['session is missing', { groups: GROUPS, groupInfoCachedAt: 1 }],
    ['groups is not an array', { session: SESSION, groups: 'x', groupInfoCachedAt: 1 }],
    ['groups is empty', { session: SESSION, groups: [], groupInfoCachedAt: 1 }],
    ['groupInfoCachedAt is missing', { session: SESSION, groups: GROUPS }],
  ])('returns null when %s', (_name, fields) => {
    expect(readCache('CODE', writeRaw({ credential: 'CODE', ...fields }))).toBeNull();
  });

  it('warns instead of throwing when the write fails', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    // A path below a regular file cannot be created.
    const file = writeRaw('x');
    writeCache('CODE', SESSION, GROUPS, join(file, 'session.json'));
    expect(warn).toHaveBeenCalledWith(
      expect.stringContaining('[anton] Failed to write session cache:'),
    );
  });
});

describe('updateGroupInfoCache', () => {
  it('replaces groups and keeps the session', () => {
    const p = tmpPath();
    writeCache('CODE', SESSION, GROUPS, p);
    const entry = readCache('CODE', p)!;
    const newGroups = [{ groupCode: 'G-2' }] as unknown as GroupInfo[];
    updateGroupInfoCache(entry, newGroups, p);
    expect(readCache('CODE', p)).toMatchObject({ session: SESSION, groups: newGroups });
  });
});

describe('isGroupInfoFresh', () => {
  const entry = (age: number): CacheEntry => ({
    credential: 'CODE',
    session: SESSION,
    groups: GROUPS,
    groupInfoCachedAt: Date.now() - age,
  });

  it('is fresh within the TTL', () => {
    expect(isGroupInfoFresh(entry(0))).toBe(true);
  });

  it('is stale after the TTL', () => {
    expect(isGroupInfoFresh(entry(GROUP_INFO_TTL_MS + 1000))).toBe(false);
  });
});

describe('clearCache', () => {
  it('deletes the file', () => {
    const p = tmpPath();
    writeCache('CODE', SESSION, GROUPS, p);
    clearCache(p);
    expect(readCache('CODE', p)).toBeNull();
  });

  it('ignores a missing file', () => {
    expect(() => clearCache(join(tmpDir, 'missing.json'))).not.toThrow();
  });

  it('ignores errors while deleting', () => {
    // rmSync without recursive fails on a directory.
    const dir = mkdtempSync(join(tmpDir, 'dir-'));
    expect(() => clearCache(dir)).not.toThrow();
    expect(existsSync(dir)).toBe(true);
  });
});
