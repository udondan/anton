/**
 * CLI session cache — persists the parent auth session and family group info
 * between CLI invocations so that subprocess connects require zero API calls
 * when both layers are fresh.
 *
 * Two independent caching layers:
 *
 *   session   — cached indefinitely; cleared only when an API call proves the
 *               token is no longer valid (no arbitrary TTL).
 *
 *   groupInfo — cached for GROUP_INFO_TTL_MS (10 minutes); re-fetched
 *               transparently when stale.  Covers group members, display names,
 *               and logIds.  Pin/assignment data is never cached here — every
 *               command that needs it fetches fresh data itself.
 *
 * This module is intentionally CLI-only.  The Anton SDK class has no caching
 * logic; the CLI layer reads/writes the cache and feeds the result into
 * Anton.connectFromCache().
 */

import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';

import type { GroupInfo, Session } from './types.js';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** How long group member info (names, logIds) is considered fresh. */
export const GROUP_INFO_TTL_MS = 10 * 60 * 1000; // 10 minutes

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface CacheEntry {
  /** Credential used as cache key (loginCode or logId). */
  credential: string;
  /** Full parent session from loginWithCode — kept until an auth error occurs. */
  session: Session;
  /** Enriched group member info (names, logIds, publicIds). */
  groupInfo: GroupInfo;
  /** Unix timestamp (ms) when groupInfo was last fetched. */
  groupInfoCachedAt: number;
}

// ---------------------------------------------------------------------------
// Path helper
// ---------------------------------------------------------------------------

export function defaultCachePath(): string {
  return join(homedir(), '.config', 'anton', 'session.json');
}

// ---------------------------------------------------------------------------
// Read / write / clear
// ---------------------------------------------------------------------------

/**
 * Read the cached entry for the given credential.
 *
 * Returns null if the file does not exist or the credential does not match.
 * The entry is returned even when groupInfo is stale — callers use
 * isGroupInfoFresh() to decide whether to re-fetch.
 */
export function readCache(credential: string, path = defaultCachePath()): CacheEntry | null {
  if (!existsSync(path)) return null;
  try {
    const raw = JSON.parse(readFileSync(path, 'utf8')) as CacheEntry;
    if (raw.credential !== credential) return null;
    // Basic shape guard — reject entries written by older versions of this module.
    if (!raw.session || !raw.groupInfo || !raw.groupInfoCachedAt) return null;
    return raw;
  } catch {
    return null;
  }
}

/** Returns true when the cached group info is still within the 10-minute TTL. */
export function isGroupInfoFresh(entry: CacheEntry): boolean {
  return Date.now() - entry.groupInfoCachedAt < GROUP_INFO_TTL_MS;
}

/**
 * Persist a full cache entry.
 * Silently ignores write errors — caching is best-effort.
 */
export function writeCache(
  credential: string,
  session: Session,
  groupInfo: GroupInfo,
  path = defaultCachePath(),
): void {
  try {
    mkdirSync(dirname(path), { recursive: true });
    const entry: CacheEntry = {
      credential,
      session,
      groupInfo,
      groupInfoCachedAt: Date.now(),
    };
    writeFileSync(path, JSON.stringify(entry, null, 2));
  } catch {
    // non-fatal
  }
}

/**
 * Update only the groupInfo + timestamp in an existing cache entry,
 * leaving the session untouched.
 */
export function updateGroupInfoCache(
  entry: CacheEntry,
  groupInfo: GroupInfo,
  path = defaultCachePath(),
): void {
  writeCache(entry.credential, entry.session, groupInfo, path);
}

/** Delete the cache file. Silently ignores errors. */
export function clearCache(path = defaultCachePath()): void {
  try {
    if (existsSync(path)) rmSync(path);
  } catch {
    // non-fatal
  }
}
