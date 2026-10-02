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

/**
 * Load the config file and apply entries to process.env.
 * Values already present in the environment are not overwritten.
 */
export function loadConfigFile(path = defaultConfigFilePath()): void {
  if (!existsSync(path)) return;

  try {
    const stat = statSync(path);
    if (!stat.isFile()) {
      process.stderr.write(
        `[anton] Warning: refusing to load config file ${path} because it is not a regular file.\n`,
      );
      return;
    }
    if (process.platform !== 'win32' && stat.mode & 0o077) {
      process.stderr.write(
        `[anton] Warning: refusing to load config file ${path} because it is group/world-accessible (mode ${(stat.mode & 0o777).toString(8)}). Run: chmod 0600 "${path}"\n`,
      );
      return;
    }
  } catch {
    // non-fatal — proceed and let the read attempt surface a real error
  }

  let content: string;
  try {
    content = readFileSync(path, 'utf8');
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    process.stderr.write(`[anton] Warning: unable to read config file at ${path}: ${reason}\n`);
    return;
  }

  for (const raw of content.split('\n')) {
    const line = raw.trim();
    if (!line || line.startsWith('#')) continue;

    const eq = line.indexOf('=');
    if (eq < 1) continue;

    const key = line.slice(0, eq).trim();
    const value = line.slice(eq + 1).trim();

    const unsafe = key === '__proto__' || key === 'constructor' || key === 'prototype';
    if (!unsafe && /^[A-Z_][A-Z0-9_]*$/i.test(key) && !Object.hasOwn(process.env, key)) {
      process.env[key] = value;
    }
  }
}
