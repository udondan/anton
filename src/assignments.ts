/**
 * Local assignment store.
 *
 * Anton does not expose a public API for assigning lessons, so we keep a
 * simple JSON file on disk.  The file path can be configured via the
 * ANTON_ASSIGNMENTS_FILE environment variable; it defaults to
 * ~/.config/anton/assignments.json.
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'fs';
import { homedir } from 'os';
import { dirname, join } from 'path';
import { randomUUID } from 'crypto';
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
  } catch {
    return { assignments: [] };
  }
}

function save(store: AssignmentStore): void {
  const path = storePath();
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, JSON.stringify(store, null, 2), { encoding: 'utf-8', mode: 0o600 });
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

/** Update the status of an existing assignment. */
export function updateAssignment(
  id: string,
  updates: { status?: AssignmentStatus; note?: string; lessonTitle?: string },
): Assignment {
  const store = load();
  const idx = store.assignments.findIndex((a) => a.id === id);
  if (idx === -1) throw new Error(`Assignment not found: ${id}`);
  const a = store.assignments[idx];
  if (updates.status) a.status = updates.status;
  if (updates.note !== undefined) a.note = updates.note;
  if (updates.lessonTitle !== undefined) a.lessonTitle = updates.lessonTitle;
  if (updates.status === 'completed' && !a.completedAt) {
    a.completedAt = new Date().toISOString();
  }
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
