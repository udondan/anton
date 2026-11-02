/**
 * Local assignment store.
 *
 * Anton does not expose a public API for assigning lessons, so we keep a
 * simple JSON file on disk.  The file path can be configured via the
 * ANTON_ASSIGNMENTS_FILE environment variable; it defaults to
 * ~/.config/anton/assignments.json.
 */

import {
  chmodSync,
  existsSync,
  mkdirSync,
  readFileSync,
  renameSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';
import { randomUUID } from 'node:crypto';
import type { Assignment, AssignmentStatus, AssignmentStore } from './types.js';

// ---------------------------------------------------------------------------
// Path resolution
// ---------------------------------------------------------------------------

function storePath(): string {
  return (
    process.env.ANTON_ASSIGNMENTS_FILE ?? join(homedir(), '.config', 'anton', 'assignments.json')
  );
}

// ---------------------------------------------------------------------------
// Read / write
// ---------------------------------------------------------------------------

function load(): AssignmentStore {
  const path = storePath();
  if (!existsSync(path)) return { assignments: [] };
  try {
    return JSON.parse(readFileSync(path, 'utf-8')) as AssignmentStore;
  } catch (err) {
    throw new Error(
      `Assignments file at ${path} is corrupted and cannot be read. ` +
        `Back it up or delete it before retrying. Cause: ${(err as Error).message}`,
      { cause: err },
    );
  }
}

function save(store: AssignmentStore): void {
  const path = storePath();
  const dir = dirname(path);
  mkdirSync(dir, { recursive: true });
  const tmp = join(dir, `.assignments-${randomUUID()}.tmp`);
  try {
    writeFileSync(tmp, JSON.stringify(store, null, 2), { encoding: 'utf-8', mode: 0o600 });
    try {
      chmodSync(tmp, 0o600);
    } catch {
      // Best-effort: chmod may be unsupported on some platforms/filesystems.
    }
    renameSync(tmp, path);
  } catch (err) {
    try {
      if (existsSync(tmp)) rmSync(tmp);
    } catch {
      // ignore cleanup errors
    }
    throw err;
  }
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/** Return all assignments, optionally filtered by child name and/or status. */
export function listAssignments(opts?: {
  childName?: string;
  status?: AssignmentStatus;
}): Assignment[] {
  const { assignments } = load();
  return assignments.filter((a) => {
    if (opts?.childName && a.childName !== opts.childName) return false;
    if (opts?.status && a.status !== opts.status) return false;
    return true;
  });
}

/** Create a new assignment and return it. */
export function createAssignment(params: {
  childName: string;
  fileId: string;
  lessonTitle?: string;
  note?: string;
}): Assignment {
  const store = load();
  const assignment: Assignment = {
    id: randomUUID(),
    childName: params.childName,
    fileId: params.fileId.replace(/^level\//, ''), // normalise – strip prefix
    lessonTitle: params.lessonTitle,
    note: params.note,
    status: 'pending',
    assignedAt: new Date().toISOString(),
  };
  store.assignments.push(assignment);
  save(store);
  return assignment;
}

const VALID_STATUSES: AssignmentStatus[] = ['pending', 'completed', 'cancelled'];

/** Update the status of an existing assignment. */
export function updateAssignment(
  id: string,
  updates: { status?: AssignmentStatus; note?: string; lessonTitle?: string },
): Assignment {
  if (updates.status !== undefined && !VALID_STATUSES.includes(updates.status)) {
    throw new Error(
      `Invalid status "${updates.status}". Must be one of: ${VALID_STATUSES.join(', ')}`,
    );
  }
  const store = load();
  const idx = store.assignments.findIndex((a) => a.id === id);
  if (idx === -1) throw new Error(`Assignment not found: ${id}`);
  const a = store.assignments[idx];
  if (updates.status !== undefined) {
    a.status = updates.status;
    if (updates.status === 'completed') {
      if (!a.completedAt) a.completedAt = new Date().toISOString();
    } else {
      a.completedAt = undefined;
    }
  }
  if (updates.note !== undefined) a.note = updates.note;
  if (updates.lessonTitle !== undefined) a.lessonTitle = updates.lessonTitle;
  save(store);
  return a;
}

/** Delete an assignment by id. */
export function deleteAssignment(id: string): void {
  const store = load();
  const before = store.assignments.length;
  store.assignments = store.assignments.filter((a) => a.id !== id);
  if (store.assignments.length === before) {
    throw new Error(`Assignment not found: ${id}`);
  }
  save(store);
}
