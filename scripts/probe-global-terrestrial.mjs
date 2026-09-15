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
const match = text.match(/UK\/Ofcom catalog:\s*(\d+) records/i);
const count = match ? Number(match[1]) : -1;
// Temporary classifier: failure means the current parsed Ofcom count is >= 8.
process.exitCode = count >= 8 ? 1 : 0;
