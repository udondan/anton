#!/usr/bin/env node
/**
 * Entry point of the `anton` binary. The CLI itself lives in program.ts so
 * tests can run it in-process.
 */

import { main } from './program.js';

process.exitCode = await main(process.argv.slice(2));
