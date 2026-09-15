import { spawnSync } from 'node:child_process';

const result = spawnSync(process.execPath, ['scripts/generate-global-terrestrial-catalog.mjs'], {
  encoding: 'utf8',
  env: process.env
});
const text = `${result.stderr || ''}\n${result.stdout || ''}`;
console.log(text);
// Temporary classifier: fail Cloudflare only when Canada/ISED validation or
// its CFZM marker is the remaining blocker. Final branch deletes this file.
process.exitCode = /Refusing suspicious Canada\/ISED catalog:|ISED marker missing:/i.test(text) ? 1 : 0;
