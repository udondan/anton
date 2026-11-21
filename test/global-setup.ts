/**
 * Vitest global setup — remove pins left behind by earlier test runs.
 *
 * The pin tests use fixed far-future weeks (2099-*) on a live account. When a
 * run fails between pin and unpin, the pin stays and every later run fails with
 * "Multiple pins found". Deleting all 2099 pins up front makes each run start
 * from a clean state.
 */

import { getGroupEvents, parsePinnedBlocks, unpinGroupBlock } from '../src/client.js';
import { Anton } from '../src/index.js';

const TEST_PIN_WEEK_PREFIX = '2099-';

export default async function setup(): Promise<void> {
  const loginCode = process.env['ANTON_LOGIN_CODE'];
  if (!loginCode) return;

  const anton = new Anton({ loginCode, groupName: process.env['ANTON_GROUP'] });
  await anton.connect();

  // Private helpers are accessed via bracket notation; this is test-only code.
  const parent = anton['requireParent']();
  const group = anton['requireGroup']();

  const pins = parsePinnedBlocks(await getGroupEvents(group.groupCode)).filter((p) =>
    p.weekStartAt.startsWith(TEST_PIN_WEEK_PREFIX),
  );
  for (const pin of pins) {
    await unpinGroupBlock(group.groupCode, pin.created, parent.logId, parent.authToken);
  }
  if (pins.length > 0) {
    console.log(`global-setup: removed ${pins.length} leftover test pin(s)`);
  }
}
