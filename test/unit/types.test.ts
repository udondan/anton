/**
 * Unit tests for the runtime values exported from types.ts.
 */

import { describe, expect, it } from 'vitest';

import { SUBJECT_CODES } from '../../src/types.js';

describe('SUBJECT_CODES', () => {
  it('maps subject codes to German subject names', () => {
    expect(SUBJECT_CODES['mat']).toBe('Mathematik');
    expect(SUBJECT_CODES['natdeu']).toBe('Deutsch');
  });
});
