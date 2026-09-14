import { writeFile } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';

const result = spawnSync('npx', ['wrangler', 'd1', 'list', '--json'], {
  encoding: 'utf8',
  timeout: 30000,
  env: process.env
});
const payload = {
  capturedAt: new Date().toISOString(),
  status: result.status,
  stdout: String(result.stdout || ''),
  stderr: String(result.stderr || '')
};
await writeFile(new URL('../d1-list-live.json', import.meta.url), JSON.stringify(payload, null, 2) + '\n', 'utf8');
console.log('D1_LIST_CAPTURED=1');
