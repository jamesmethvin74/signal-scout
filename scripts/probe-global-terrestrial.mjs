import { spawnSync } from 'node:child_process';
import { writeFileSync } from 'node:fs';

const result = spawnSync(process.execPath, ['scripts/generate-global-terrestrial-catalog.mjs'], {
  encoding: 'utf8',
  env: process.env
});
const report = [
  `exit=${result.status}`,
  '--- stdout ---',
  result.stdout || '',
  '--- stderr ---',
  result.stderr || '',
].join('\n');
writeFileSync('terrestrial-build-probe.txt', report, 'utf8');
console.log(report);

// Temporary diagnostic classifier. Cloudflare's GitHub check does not expose
// build stdout/stderr, so classify the already-captured generator error via the
// check result. Final branch deletes this probe and restores fail-closed build.
const text = `${result.stderr || ''}\n${result.stdout || ''}`;
process.exitCode = /Ofcom/i.test(text) ? 1 : 0;
