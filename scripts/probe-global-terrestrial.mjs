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

const text = `${result.stderr || ''}\n${result.stdout || ''}`;
// Temporary classifier: failure means Ofcom parsed but the selected marker is stale/mismatched.
process.exitCode = /Ofcom marker missing|marker missing.*Ofcom/i.test(text) ? 1 : 0;
