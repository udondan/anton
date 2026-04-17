# AGENTS.md

This file provides guidance to AI agents when working with code in this repository.

## Build & test commands

```bash
npm run build          # compile TypeScript → dist/
npm run dev            # watch mode (tsc --watch)
npm test               # run all tests (vitest)
npm test test/sdk.test.ts    # run a single test file
```

Integration tests hit the real anton.app API and require `ANTON_LOGIN_CODE` to be set:

```bash
ANTON_LOGIN_CODE=YOUR-CODE npm test
```

Tests expect `dist/` to exist — always `npm run build` first.

## Architecture

The package ships three interfaces over a shared SDK core:

```
src/
  Anton.ts        — SDK class: all public methods, business logic, no HTTP
  client.ts       — Low-level HTTP: login, event log, group logger, content API
  analysis.ts     — Pure computation over event arrays (no HTTP, no Anton class)
  assignments.ts  — Local JSON store at ~/.config/anton/assignments.json
  session-cache.ts— CLI-only: session + group info cache at ~/.config/anton/session.json
  mcp.ts          — MCP server wrapping Anton class as 23 tools over stdio
  cli.ts          — commander-based CLI; delegates auth to connectAnton() which
                    reads/writes the session cache before calling Anton.connect()
  types.ts        — All exported TypeScript types
  index.ts        — SDK entry point (re-exports Anton + types)
```

**Data flow**: CLI/MCP → `Anton` class → `client.ts` (HTTP) / `analysis.ts` (computation)

**Session cache** lives only in `cli.ts` + `session-cache.ts`. The `Anton` class has two entry points for authentication:
- `connect()` — full login (SDK, MCP)
- `connectFromCache(session, groupCode, groupInfo?)` — zero or 2 API calls (CLI only)

The two-layer cache: session is kept until an auth error; groupInfo has a 10-minute TTL and is re-fetched transparently without re-logging in.

**MCP vs CLI tool count**: the MCP server exposes 23 tools. The CLI has the same feature set via subcommands. `CLAUDE.md` documents the tool inventory.

## Key conventions

- All `client.ts` functions are standalone exports (not class methods) that take explicit auth parameters.
- `Anton.ts` orchestrates client calls and is the only place that holds `parentSession` and `groupInfo` state.
- `analysis.ts` functions are pure — they receive event arrays and return computed results. Do not add HTTP calls there.
- Assignment IDs are UUIDs generated in `assignments.ts`; the store is a flat JSON array.
- Block resolution (project → topic → block) is done inline in `Anton.pinBlock()` — there is no separate resolver.
- The `blockPath` format is `/../{project}/{topicSlug}/{blockSlug}/block`; it is derived from puids, not stored in the API response directly.
