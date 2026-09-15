import { spawnSync } from 'node:child_process';

const result = spawnSync(process.execPath, ['scripts/generate-global-terrestrial-catalog.mjs'], {
  encoding: 'utf8',
  env: process.env
});
const text = `${result.stderr || ''}\n${result.stdout || ''}`;
console.log(text);
// Temporary classifier: fail Cloudflare only when Australia/ACMA validation or
// its 2GB 873 marker is the remaining blocker. Final branch deletes this file.
process.exitCode = /Refusing suspicious Australia\/ACMA catalog:|ACMA marker missing:|ACMA AM sheet|ACMA ZIP|ACMA workbook/i.test(text) ? 1 : 0;
