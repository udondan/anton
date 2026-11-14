/**
 * Pure selection helpers over the groups, members and pins already loaded by
 * the Anton class. No HTTP calls here.
 */

import type { GroupInfo, GroupMember, PinnedBlock } from './types.js';

/** A pupil resolved by name or publicId within a group. */
export interface ResolvedChild {
  logId?: string;
  publicId: string;
  displayName: string;
  groupCode: string;
}

function findByName(groups: GroupInfo[], name: string): GroupInfo | undefined {
  const key = name.toLowerCase();
  return groups.find((g) => g.groupName.toLowerCase() === key);
}

/**
 * Select the group to operate on: the one named `name` (case-insensitive), or
 * the first group without a name. Throws if nothing is loaded or the name is unknown.
 */
export function selectGroup(groups: GroupInfo[], name?: string): GroupInfo {
  if (groups.length === 0) {
    throw new Error('Family group not loaded. Call connect() first.');
  }
  if (!name) return groups[0];
  const found = findByName(groups, name);
  if (!found) {
    throw new Error(
      `Group "${name}" not found. Available groups: ${groups.map((g) => g.groupName).join(', ')}`,
    );
  }
  return found;
}

/** Like selectGroup(), but falls back to the first group instead of throwing. */
export function defaultGroup(groups: GroupInfo[], name?: string): GroupInfo | null {
  if (groups.length === 0) return null;
  return (name ? findByName(groups, name) : undefined) ?? groups[0];
}

/** All pupils of a group. */
export function pupilsOf(group: GroupInfo): GroupMember[] {
  return group.members.filter((m) => m.role === 'pupil');
}

/** The child data of a pupil, falling back to `name` as the display name. */
export function toResolvedChild(
  member: GroupMember,
  group: GroupInfo,
  name: string,
): ResolvedChild {
  return {
    logId: member.logId,
    publicId: member.publicId,
    displayName: member.displayName ?? name,
    groupCode: group.groupCode,
  };
}

/** Find a pupil by display name or publicId (case-insensitive). */
export function findChild(group: GroupInfo, name: string): ResolvedChild {
  const key = name.toLowerCase();
  const member = pupilsOf(group).find(
    (m) => m.displayName?.toLowerCase() === key || m.publicId.toLowerCase() === key,
  );
  if (!member) {
    throw new Error(
      `Child "${name}" not found in group "${group.groupName}". Use listChildren() to see member names or public IDs.`,
    );
  }
  return toResolvedChild(member, group, name);
}

/**
 * Filter pins by child and week. With a child, only group-wide pins and the
 * child's own pins remain.
 */
export function filterPinnedBlocks(
  pins: PinnedBlock[],
  filter: { childPublicId?: string; week?: string },
): PinnedBlock[] {
  const { childPublicId, week } = filter;
  return pins.filter(
    (p) =>
      (!childPublicId || p.subgroup == null || p.subgroup === childPublicId) &&
      (!week || p.weekStartAt === week),
  );
}

/** Find the single pin to remove. Throws if there is none or the match is ambiguous. */
export function findPin(
  pins: PinnedBlock[],
  target: { blockPuid: string; weekStartAt: string; childPublicId?: string },
): PinnedBlock {
  const { blockPuid, weekStartAt, childPublicId } = target;
  const matches = pins.filter(
    (p) =>
      p.puid === blockPuid &&
      p.weekStartAt === weekStartAt &&
      (childPublicId == null || p.subgroup === childPublicId),
  );
  if (matches.length === 0) {
    throw new Error(`No pin found for puid=${blockPuid} week=${weekStartAt}`);
  }
  if (childPublicId == null && matches.length > 1) {
    throw new Error(
      `Multiple pins found for puid=${blockPuid} week=${weekStartAt}; provide childPublicId to disambiguate`,
    );
  }
  return matches[0];
}
