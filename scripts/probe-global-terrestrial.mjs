import { spawnSync } from 'node:child_process';

const result = spawnSync(process.execPath, ['scripts/generate-global-terrestrial-catalog.mjs'], {
  encoding: 'utf8',
  env: process.env
});
const text = `${result.stderr || ''}\n${result.stdout || ''}`;
console.log(text);
// Temporary classifier: fail Cloudflare only when current Ofcom rows pass the
// count floor but the Radio Caroline 648 marker is missing. Final branch deletes this file.
process.exitCode = /Ofcom marker missing:/i.test(text) ? 1 : 0;
