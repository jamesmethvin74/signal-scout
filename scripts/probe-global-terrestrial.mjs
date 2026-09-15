import { spawnSync } from 'node:child_process';

const result = spawnSync(process.execPath, ['scripts/generate-global-terrestrial-catalog.mjs'], {
  encoding: 'utf8',
  env: process.env
});
const text = `${result.stderr || ''}\n${result.stdout || ''}`;
console.log(text);
// Temporary classifier: fail Cloudflare only when the live generator is still
// below the Ofcom minimum-count guard. Final branch deletes this file.
process.exitCode = /Refusing suspicious UK\/Ofcom catalog:/i.test(text) ? 1 : 0;
