import { spawnSync } from 'node:child_process';

const result = spawnSync(process.execPath, ['scripts/generate-global-terrestrial-catalog.mjs'], {
  encoding: 'utf8',
  env: process.env
});
const text = `${result.stderr || ''}\n${result.stdout || ''}`;
console.log(text);
// Temporary classifier: fail Cloudflare only when the low-frequency EiBi
// fallback is below its fail-closed minimum. Final branch deletes this file.
process.exitCode = /Refusing suspicious global EiBi fallback catalog:/i.test(text) ? 1 : 0;
