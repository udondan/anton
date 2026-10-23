import { chmodSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';

import { loadConfigFile } from '../src/config-file.js';

const tmpDir = mkdtempSync(join(tmpdir(), 'anton-config-test-'));
afterAll(() => rmSync(tmpDir, { recursive: true, force: true }));

function writeTmp(name: string, content: string, mode = 0o600): string {
  const p = join(tmpDir, name);
  writeFileSync(p, content, { mode });
  chmodSync(p, mode);
  return p;
}

describe('loadConfigFile', () => {
  // Snapshot and restore process.env around each test.
  let envSnapshot: NodeJS.ProcessEnv;
  beforeAll(() => {
    envSnapshot = { ...process.env };
  });
  afterEach(() => {
    // Remove any keys added during the test.
    for (const key of Object.keys(process.env)) {
      if (!Object.hasOwn(envSnapshot, key)) delete process.env[key];
    }
    // Restore any keys that were changed.
    Object.assign(process.env, envSnapshot);
  });

  it('is a no-op when the file does not exist', () => {
    const before = { ...process.env };
    loadConfigFile(join(tmpDir, 'does-not-exist'));
    expect(process.env).toEqual(before);
  });

  it('sets KEY=VALUE pairs from the file', () => {
    const p = writeTmp('basic.config', 'ANTON_TEST_KEY=hello\nANTON_TEST_OTHER=world\n');
    loadConfigFile(p);
    expect(process.env['ANTON_TEST_KEY']).toBe('hello');
    expect(process.env['ANTON_TEST_OTHER']).toBe('world');
  });

  it('ignores comment lines and blank lines', () => {
    const p = writeTmp('comments.config', '# this is a comment\n\nANTON_TEST_KEY=ok\n\n# end\n');
    loadConfigFile(p);
    expect(process.env['ANTON_TEST_KEY']).toBe('ok');
  });

  it('does not overwrite existing env vars', () => {
    process.env['ANTON_TEST_KEY'] = 'original';
    const p = writeTmp('precedence.config', 'ANTON_TEST_KEY=from-file\n');
    loadConfigFile(p);
    expect(process.env['ANTON_TEST_KEY']).toBe('original');
  });

  it('handles values that contain = signs', () => {
    const p = writeTmp('eq.config', 'ANTON_TEST_KEY=a=b=c\n');
    loadConfigFile(p);
    expect(process.env['ANTON_TEST_KEY']).toBe('a=b=c');
  });

  it('ignores keys that fail the safe env-var pattern', () => {
    const p = writeTmp('proto.config', '__proto__=bad\nconstructor=bad\nANTON_TEST_KEY=ok\n');
    loadConfigFile(p);
    expect(process.env['ANTON_TEST_KEY']).toBe('ok');
    expect(Object.hasOwn(process.env, '__proto__')).toBe(false);
    expect(Object.hasOwn(process.env, 'constructor')).toBe(false);
  });

  const itPosix = process.platform === 'win32' ? it.skip : it;

  itPosix('refuses to load and warns to stderr when file is group/world-accessible', () => {
    const p = writeTmp('loose.config', 'ANTON_TEST_KEY=x\n', 0o644);
    const written: string[] = [];
    const spy = vi.spyOn(process.stderr, 'write').mockImplementation((chunk) => {
      written.push(String(chunk));
      return true;
    });
    try {
      loadConfigFile(p);
    } finally {
      spy.mockRestore();
    }
    expect(written.some((l) => l.includes('group/world-accessible'))).toBe(true);
    expect(process.env['ANTON_TEST_KEY']).toBeUndefined();
  });

  it('warns to stderr and does not throw when path is a directory (EISDIR)', () => {
    // Using a directory path is platform-safe and root-safe (readFileSync always throws EISDIR).
    const written: string[] = [];
    const spy = vi.spyOn(process.stderr, 'write').mockImplementation((chunk) => {
      written.push(String(chunk));
      return true;
    });
    try {
      loadConfigFile(tmpDir);
    } finally {
      spy.mockRestore();
    }
    expect(
      written.some(
        (l) => l.includes('not a regular file') || l.includes('unable to read config file'),
      ),
    ).toBe(true);
    expect(process.env['ANTON_TEST_KEY']).toBeUndefined();
  });
});
