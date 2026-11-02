/**
 * Unit tests for the local assignment store, using temp files only.
 */

import * as fs from 'node:fs';
import { mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import type * as os from 'node:os';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  createAssignment,
  deleteAssignment,
  listAssignments,
  updateAssignment,
} from '../../src/assignments.js';

// Wrap the fs functions the store uses, so single tests can make them fail.
vi.mock('node:fs', async (importOriginal) => {
  const actual = await importOriginal<typeof fs>();
  return {
    ...actual,
    chmodSync: vi.fn(actual.chmodSync),
    renameSync: vi.fn(actual.renameSync),
    rmSync: vi.fn(actual.rmSync),
    writeFileSync: vi.fn(actual.writeFileSync),
  };
});

// Keep the default path (without ANTON_ASSIGNMENTS_FILE) away from the real home.
const fakeHome = vi.hoisted(() => ({ dir: '' }));
vi.mock('node:os', async (importOriginal) => {
  const actual = await importOriginal<typeof os>();
  return { ...actual, homedir: () => fakeHome.dir };
});

const tmpDir = mkdtempSync(join(tmpdir(), 'anton-assignments-test-'));
fakeHome.dir = join(tmpDir, 'home');
afterAll(() => rmSync(tmpDir, { recursive: true, force: true }));

let storeFile: string;
let counter = 0;
const envBefore = process.env['ANTON_ASSIGNMENTS_FILE'];

beforeEach(() => {
  storeFile = join(tmpDir, `store-${++counter}`, 'assignments.json');
  process.env['ANTON_ASSIGNMENTS_FILE'] = storeFile;
});

afterEach(() => {
  vi.clearAllMocks();
  if (envBefore === undefined) delete process.env['ANTON_ASSIGNMENTS_FILE'];
  else process.env['ANTON_ASSIGNMENTS_FILE'] = envBefore;
});

describe('listAssignments', () => {
  it('returns an empty list when the file does not exist', () => {
    expect(listAssignments()).toEqual([]);
  });

  it('filters by child and status', () => {
    const a = createAssignment({ childName: 'Anna', fileId: 'x' });
    const b = createAssignment({ childName: 'Ben', fileId: 'y' });
    updateAssignment(b.id, { status: 'completed' });

    expect(listAssignments().map((x) => x.id)).toEqual([a.id, b.id]);
    expect(listAssignments({ childName: 'Anna' }).map((x) => x.id)).toEqual([a.id]);
    expect(listAssignments({ status: 'completed' }).map((x) => x.id)).toEqual([b.id]);
    expect(listAssignments({ childName: 'Anna', status: 'completed' })).toEqual([]);
  });

  it('throws a helpful error for a corrupted file', () => {
    fs.mkdirSync(join(storeFile, '..'), { recursive: true });
    writeFileSync(storeFile, '{broken');
    expect(() => listAssignments()).toThrow(/is corrupted and cannot be read/);
  });

  it('uses ~/.config/anton/assignments.json by default', () => {
    delete process.env['ANTON_ASSIGNMENTS_FILE'];
    createAssignment({ childName: 'Anna', fileId: 'x' });
    const path = join(fakeHome.dir, '.config', 'anton', 'assignments.json');
    expect(JSON.parse(readFileSync(path, 'utf-8')).assignments).toHaveLength(1);
  });
});

describe('createAssignment', () => {
  it('creates a pending assignment and strips the level/ prefix', () => {
    const a = createAssignment({
      childName: 'Anna',
      fileId: 'level/c-mat-4/x',
      lessonTitle: 'Brüche',
      note: 'n',
    });
    expect(a).toMatchObject({
      childName: 'Anna',
      fileId: 'c-mat-4/x',
      lessonTitle: 'Brüche',
      note: 'n',
      status: 'pending',
    });
    expect(a.id).toMatch(/^[0-9a-f-]{36}$/);
    expect(listAssignments()).toEqual([a]);
  });

  it('still saves when chmod fails', () => {
    vi.mocked(fs.chmodSync).mockImplementationOnce(() => {
      throw new Error('EPERM');
    });
    createAssignment({ childName: 'Anna', fileId: 'x' });
    expect(listAssignments()).toHaveLength(1);
  });

  it('removes the temp file and rethrows when the rename fails', () => {
    vi.mocked(fs.renameSync).mockImplementationOnce(() => {
      throw new Error('EXDEV');
    });
    expect(() => createAssignment({ childName: 'Anna', fileId: 'x' })).toThrow('EXDEV');
    expect(readdirSync(join(storeFile, '..'))).toEqual([]);
  });

  it('rethrows the original error when the cleanup fails too', () => {
    vi.mocked(fs.renameSync).mockImplementationOnce(() => {
      throw new Error('EXDEV');
    });
    vi.mocked(fs.rmSync).mockImplementationOnce(() => {
      throw new Error('EBUSY');
    });
    expect(() => createAssignment({ childName: 'Anna', fileId: 'x' })).toThrow('EXDEV');
  });

  it('skips the cleanup when the temp file was never written', () => {
    vi.mocked(fs.writeFileSync).mockImplementationOnce(() => {
      throw new Error('ENOSPC');
    });
    expect(() => createAssignment({ childName: 'Anna', fileId: 'x' })).toThrow('ENOSPC');
    expect(fs.rmSync).not.toHaveBeenCalled();
  });
});

describe('updateAssignment', () => {
  it('rejects an invalid status', () => {
    expect(() => updateAssignment('id', { status: 'done' as never })).toThrow(
      'Invalid status "done". Must be one of: pending, completed, cancelled',
    );
  });

  it('throws for an unknown id', () => {
    expect(() => updateAssignment('missing', { note: 'x' })).toThrow(
      'Assignment not found: missing',
    );
  });

  it('sets completedAt once when completed and clears it otherwise', () => {
    const a = createAssignment({ childName: 'Anna', fileId: 'x' });
    const done = updateAssignment(a.id, { status: 'completed' });
    expect(done.completedAt).toBeDefined();

    const again = updateAssignment(a.id, { status: 'completed' });
    expect(again.completedAt).toBe(done.completedAt);

    const cancelled = updateAssignment(a.id, { status: 'cancelled' });
    expect(cancelled.status).toBe('cancelled');
    expect(cancelled.completedAt).toBeUndefined();
  });

  it('updates note and title without touching the status', () => {
    const a = createAssignment({ childName: 'Anna', fileId: 'x' });
    const u = updateAssignment(a.id, { note: 'new note', lessonTitle: 'New title' });
    expect(u).toMatchObject({ status: 'pending', note: 'new note', lessonTitle: 'New title' });
    expect(listAssignments()[0]).toEqual(u);
  });

  it('leaves everything unchanged with empty updates', () => {
    const a = createAssignment({ childName: 'Anna', fileId: 'x', note: 'keep' });
    expect(updateAssignment(a.id, {})).toEqual(a);
  });
});

describe('deleteAssignment', () => {
  it('deletes an assignment', () => {
    const a = createAssignment({ childName: 'Anna', fileId: 'x' });
    const b = createAssignment({ childName: 'Ben', fileId: 'y' });
    deleteAssignment(a.id);
    expect(listAssignments()).toEqual([b]);
  });

  it('throws for an unknown id', () => {
    expect(() => deleteAssignment('missing')).toThrow('Assignment not found: missing');
  });
});
