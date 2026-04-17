import { defineConfig } from 'vitest/config';
import { BaseSequencer, type WorkspaceSpec } from 'vitest/node';

// Run files with the fewest logins first so CLI (29 fresh logins) runs last.
// The CLI test makes 29 separate process spawns each of which calls loginWithCode,
// which exhausts the API's eventual-consistency window for getUserEvents.  Running
// CLI last means the other tests (one shared connection each) finish before the
// burst happens.
const FILE_ORDER = ['sdk.test', 'integration.test', 'mcp.test', 'cli.test'];

class TestSequencer extends BaseSequencer {
  override async sort(files: WorkspaceSpec[]): Promise<WorkspaceSpec[]> {
    return [...files].sort((a, b) => {
      const ai = FILE_ORDER.findIndex((n) => a.moduleId.includes(n));
      const bi = FILE_ORDER.findIndex((n) => b.moduleId.includes(n));
      return (ai === -1 ? 999 : ai) - (bi === -1 ? 999 : bi);
    });
  }
}

export default defineConfig({
  test: {
    // Each API call can take a while
    testTimeout: 30_000,
    hookTimeout: 60_000,
    // Run files one at a time; TestSequencer controls the order (CLI last).
    pool: 'forks',
    poolOptions: {
      forks: { maxForks: 1 },
    },
    sequence: {
      sequencer: TestSequencer,
    },
  },
});
