import { ReceiverHealthStore as BaseReceiverHealthStore } from './receiver-health.js';

const BATCH_SIZE = 8;
const DISCOVERY_STALE_MS = 14 * 86400000;

export class ReceiverHealthStore extends BaseReceiverHealthStore {
  candidates(url) {
    const limit = Math.max(1, Math.min(BATCH_SIZE, Number(url.searchParams.get('limit')) || BATCH_SIZE));
    const cutoff = Date.now() - DISCOVERY_STALE_MS;
    const progress = this.rows(`
      SELECT id,name,location,country,lat,lon,upstream_host AS upstreamHost,hostname,protocol,version,
             receiver_type AS receiverType,antenna,trusted,recent_successes AS recentSuccesses,last_tested_at AS lastTestedAt
      FROM receivers
      WHERE last_discovered_at>=? AND trusted=0 AND recent_successes>0
      ORDER BY COALESCE(last_tested_at,0) ASC
      LIMIT ?
    `, cutoff, limit);
    const trusted = this.rows(`
      SELECT id,name,location,country,lat,lon,upstream_host AS upstreamHost,hostname,protocol,version,
             receiver_type AS receiverType,antenna,trusted,recent_successes AS recentSuccesses,last_tested_at AS lastTestedAt
      FROM receivers
      WHERE last_discovered_at>=? AND trusted=1
      ORDER BY COALESCE(last_tested_at,0) ASC
      LIMIT ?
    `, cutoff, Math.max(1, Math.floor(limit / 4)));
    const fresh = this.rows(`
      SELECT id,name,location,country,lat,lon,upstream_host AS upstreamHost,hostname,protocol,version,
             receiver_type AS receiverType,antenna,trusted,recent_successes AS recentSuccesses,last_tested_at AS lastTestedAt
      FROM receivers
      WHERE last_discovered_at>=? AND trusted=0 AND recent_successes=0
      ORDER BY COALESCE(last_tested_at,0) ASC
      LIMIT ?
    `, cutoff, limit);

    const picked = [];
    const seen = new Set();
    const add = (items, cap = Infinity) => {
      let count = 0;
      for (const item of items) {
        if (picked.length >= limit || count >= cap) break;
        if (seen.has(item.id)) continue;
        seen.add(item.id);
        picked.push(item);
        count += 1;
      }
    };
    add(progress, Math.ceil(limit / 2));
    add(trusted, Math.max(1, Math.floor(limit / 4)));
    add(fresh);
    add(progress);
    add(trusted);
    return new Response(JSON.stringify({ receivers: picked }), {
      headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' }
    });
  }
}
