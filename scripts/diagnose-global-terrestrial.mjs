import { spawnSync } from 'node:child_process';
import { writeFile } from 'node:fs/promises';

const result = spawnSync(process.execPath, ['scripts/generate-global-terrestrial-catalog.mjs'], {
  encoding: 'utf8',
  maxBuffer: 8 * 1024 * 1024
});

const report = {
  status: result.status,
  signal: result.signal,
  error: result.error ? String(result.error.stack || result.error) : null,
  stdout: result.stdout || '',
  stderr: result.stderr || ''
};

await writeFile('global-catalog-diagnostic.json', JSON.stringify(report, null, 2), 'utf8');
console.log(`Global terrestrial diagnostic captured exit ${result.status}`);
