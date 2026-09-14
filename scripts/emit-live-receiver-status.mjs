import { writeFile } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';

function run(command) {
  const result = spawnSync('npx', ['wrangler', 'd1', 'execute', 'signal-scout-receiver-health-db', '--remote', '--command', command, '--json'], {
    encoding: 'utf8',
    timeout: 30000,
    env: process.env
  });
  return {
    status: result.status,
    stdout: String(result.stdout || ''),
    stderr: String(result.stderr || '')
  };
}

const payload = {
  capturedAt: new Date().toISOString(),
  tables: run("SELECT name FROM sqlite_master WHERE type='table' ORDER BY name"),
  receivers: run("SELECT COUNT(*) AS inventory, SUM(CASE WHEN trusted=1 THEN 1 ELSE 0 END) AS trusted, SUM(CASE WHEN observations=0 THEN 1 ELSE 0 END) AS untested, SUM(CASE WHEN trusted=0 AND recent_successes>0 THEN 1 ELSE 0 END) AS promotion_queue, MAX(last_tested_at) AS last_tested_at FROM receivers"),
  runs: run("SELECT * FROM receiver_health_runs ORDER BY run_at DESC LIMIT 5")
};
await writeFile(new URL('../d1-health-live.json', import.meta.url), JSON.stringify(payload, null, 2) + '\n', 'utf8');
console.log('D1_HEALTH_CAPTURED=1');
