import { writeFile } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';

const DIRECTORY_URL = 'https://www.receiverbook.de/map?type=kiwisdr';
const DB = 'signal-scout-receiver-health-db';
const MAX = 1400;

const sqlText = (value) => `'${String(value ?? '').replace(/\u0000/g, '').replace(/'/g, "''")}'`;
const clean = (value, max = 180) => String(value || '').replace(/<[^>]+>/g, ' ').replace(/&nbsp;|&#160;/gi, ' ').replace(/&amp;/gi, '&').replace(/&quot;/gi, '"').replace(/&#39;|&apos;/gi, "'").replace(/[\u0000-\u001f\u007f]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, max);
const blocked = (host) => !host || host === 'localhost' || host.endsWith('.local') || /^127\.|^10\.|^192\.168\.|^169\.254\./.test(host) || /^172\.(1[6-9]|2\d|3[01])\./.test(host);

const html = await (await fetch(DIRECTORY_URL, { headers: { 'User-Agent': 'FREQBEACON bootstrap seed' } })).text();
const match = html.match(/var\s+receivers\s*=\s*(\[[\s\S]*?\]);/);
if (!match) throw new Error('ReceiverBook receiver array not found');
const sites = JSON.parse(match[1]);
const rows = [];
const seen = new Set();

for (const site of sites) {
  const coordinates = site?.location?.coordinates;
  const lon = Number(Array.isArray(coordinates) ? coordinates[0] : site?.lon);
  const lat = Number(Array.isArray(coordinates) ? coordinates[1] : site?.lat);
  if (!Number.isFinite(lat) || !Number.isFinite(lon)) continue;
  const siteLabel = clean(site?.label || site?.name || '');
  const children = Array.isArray(site?.receivers) && site.receivers.length ? site.receivers : [site];
  for (const child of children) {
    if (rows.length >= MAX) break;
    const typeText = [child?.type, child?.version, child?.software].filter(Boolean).join(' ');
    if (typeText && /(?:openwebrx|websdr)/i.test(typeText) && !/kiwi/i.test(typeText)) continue;
    let url;
    try { url = new URL(String(child?.url || site?.url || '').trim()); } catch { continue; }
    if (!['http:', 'https:'].includes(url.protocol) || blocked(url.hostname.toLowerCase())) continue;
    const port = url.port || (url.protocol === 'https:' ? '443' : '80');
    const id = `${url.hostname.toLowerCase()}:${port}`;
    if (seen.has(id)) continue;
    seen.add(id);
    const childLabel = clean(child?.label || child?.name || '');
    const name = childLabel || siteLabel || url.host;
    rows.push({
      id,
      name,
      location: siteLabel || childLabel || name,
      country: clean(child?.country || site?.country || '', 80),
      lat,
      lon,
      upstreamHost: url.host,
      hostname: url.hostname.toLowerCase(),
      protocol: url.protocol,
      version: clean(child?.version || '', 80),
      antenna: clean(child?.antenna || site?.antenna || '', 180)
    });
  }
  if (rows.length >= MAX) break;
}

const discoveredAt = Date.now();
const ddl = `
CREATE TABLE IF NOT EXISTS receivers (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  location TEXT NOT NULL,
  country TEXT NOT NULL DEFAULT '',
  lat REAL NOT NULL,
  lon REAL NOT NULL,
  upstream_host TEXT NOT NULL,
  hostname TEXT NOT NULL,
  protocol TEXT NOT NULL,
  version TEXT NOT NULL DEFAULT '',
  receiver_type TEXT NOT NULL DEFAULT 'KiwiSDR',
  antenna TEXT NOT NULL DEFAULT '',
  last_discovered_at INTEGER NOT NULL,
  last_tested_at INTEGER,
  last_success_at INTEGER,
  observations INTEGER NOT NULL DEFAULT 0,
  recent_successes INTEGER NOT NULL DEFAULT 0,
  recent_failures INTEGER NOT NULL DEFAULT 0,
  consecutive_failures INTEGER NOT NULL DEFAULT 0,
  snd_success INTEGER NOT NULL DEFAULT 0,
  wf_success INTEGER NOT NULL DEFAULT 0,
  connect_ms INTEGER,
  success_rate REAL NOT NULL DEFAULT 0,
  health_score INTEGER NOT NULL DEFAULT 0,
  trusted INTEGER NOT NULL DEFAULT 0,
  history TEXT NOT NULL DEFAULT '[]'
);
CREATE INDEX IF NOT EXISTS idx_receivers_trusted_success ON receivers(trusted, last_success_at);
CREATE INDEX IF NOT EXISTS idx_receivers_tested ON receivers(last_tested_at);
CREATE INDEX IF NOT EXISTS idx_receivers_discovered ON receivers(last_discovered_at);
`;

let sql = ddl;
for (let offset = 0; offset < rows.length; offset += 100) {
  const values = rows.slice(offset, offset + 100).map((r) => `(${sqlText(r.id)},${sqlText(r.name)},${sqlText(r.location)},${sqlText(r.country)},${r.lat},${r.lon},${sqlText(r.upstreamHost)},${sqlText(r.hostname)},${sqlText(r.protocol)},${sqlText(r.version)},'KiwiSDR',${sqlText(r.antenna)},${discoveredAt})`).join(',');
  sql += `\nINSERT INTO receivers (id,name,location,country,lat,lon,upstream_host,hostname,protocol,version,receiver_type,antenna,last_discovered_at) VALUES ${values} ON CONFLICT(id) DO UPDATE SET name=excluded.name,location=excluded.location,country=excluded.country,lat=excluded.lat,lon=excluded.lon,upstream_host=excluded.upstream_host,hostname=excluded.hostname,protocol=excluded.protocol,version=excluded.version,receiver_type=excluded.receiver_type,antenna=excluded.antenna,last_discovered_at=excluded.last_discovered_at;\n`;
}

const sqlPath = '/tmp/freqbeacon-receiver-seed.sql';
await writeFile(sqlPath, sql, 'utf8');
const result = spawnSync('npx', ['wrangler', 'd1', 'execute', DB, '--remote', '--file', sqlPath, '--json'], {
  encoding: 'utf8',
  timeout: 120000,
  env: process.env
});

const payload = {
  capturedAt: new Date().toISOString(),
  receiverBookRows: rows.length,
  status: result.status,
  stdout: String(result.stdout || ''),
  stderr: String(result.stderr || '')
};
await writeFile(new URL('../receiver-seed-result.json', import.meta.url), JSON.stringify(payload, null, 2) + '\n', 'utf8');
if (result.status !== 0) throw new Error(`D1 seed failed: ${payload.stderr || payload.stdout}`);
console.log(`FREQBEACON_RECEIVER_SEED_ROWS=${rows.length}`);
