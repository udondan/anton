/**
 * Unit tests for pure helpers in client.ts — no network access.
 */

import { describe, expect, it } from 'vitest';

import { parsePinnedBlocks } from '../src/client.js';
import type { AntonEvent } from '../src/types.js';

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

  it('ignores non-pin events', () => {
    expect(parsePinnedBlocks([{ ...base, event: 'pinGroupLearnList' } as AntonEvent])).toEqual([]);
  });
});
