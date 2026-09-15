import { spawnSync } from 'node:child_process';

const result = spawnSync(process.execPath, ['scripts/generate-global-terrestrial-catalog.mjs'], {
  encoding: 'utf8',
  env: process.env
});
const text = `${result.stderr || ''}\n${result.stdout || ''}`;
console.log(text);
// Temporary classifier: fail only for source-network failures/timeouts.
// Final branch deletes this file.
process.exitCode = /fetch failed|abort|timeout|timed out|network|ECONN|ENOTFOUND|EAI_AGAIN/i.test(text) ? 1 : 0;
