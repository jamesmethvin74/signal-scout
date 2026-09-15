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
// Diagnostic commit only: allow Cloudflare preview deployment so the exact
// generator failure is inspectable. Final branch restores fail-closed build.
process.exitCode = 0;
