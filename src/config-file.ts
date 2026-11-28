/**
 * Global config file loader for the Anton CLI.
 *
 * Reads ~/.config/anton/config (or the path given) and applies any KEY=VALUE
 * entries to process.env, but only when the variable is not already set.
 * Environment variables always take precedence over the config file.
 *
 * File format:
 *   # comment
 *   ANTON_LOGIN_CODE=XXXX-YYYY
 *   ANTON_GROUP=Family
 *
 * The file should be protected with mode 0600 because it may contain secrets.
 */

import { existsSync, readFileSync, statSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';

export function defaultConfigFilePath(): string {
  return join(homedir(), '.config', 'anton', 'config');
}

function warn(message: string): void {
  process.stderr.write(`[anton] Warning: ${message}\n`);
}

/**
 * Refuse files that are not regular files or that others can access.
 * A failing stat() is non-fatal — the read attempt surfaces the real error.
 */
function isSafeConfigFile(path: string): boolean {
  try {
    const stat = statSync(path);
    if (!stat.isFile()) {
      warn(`refusing to load config file ${path} because it is not a regular file.`);
      return false;
    }
    if (process.platform !== 'win32' && stat.mode & 0o077) {
      warn(
        `refusing to load config file ${path} because it is group/world-accessible (mode ${(stat.mode & 0o777).toString(8)}). Run: chmod 0600 "${path}"`,
      );
      return false;
    }
  } catch {
    // non-fatal — proceed and let the read attempt surface a real error
  }
  return true;
}

function readConfig(path: string): string | null {
  try {
    return readFileSync(path, 'utf8');
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    warn(`unable to read config file at ${path}: ${reason}`);
    return null;
  }
}

/** Apply one KEY=VALUE line to process.env unless the variable is already set. */
function applyEntry(raw: string): void {
  const line = raw.trim();
  if (!line || line.startsWith('#')) return;

  const eq = line.indexOf('=');
  if (eq < 1) return;

  const key = line.slice(0, eq).trim();
  const value = line.slice(eq + 1).trim();

  const unsafe = key === '__proto__' || key === 'constructor' || key === 'prototype';
  if (!unsafe && /^[A-Z_][A-Z0-9_]*$/i.test(key) && !Object.hasOwn(process.env, key)) {
    process.env[key] = value;
  }
}

/**
 * Load the config file and apply entries to process.env.
 * Values already present in the environment are not overwritten.
 */
export function loadConfigFile(path = defaultConfigFilePath()): void {
  if (!existsSync(path) || !isSafeConfigFile(path)) return;
  const content = readConfig(path);
  if (content == null) return;
  for (const line of content.split('\n')) applyEntry(line);
}
