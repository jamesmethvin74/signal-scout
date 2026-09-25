import baseWorker from './worker-program-v21.js';

const ACCOUNT_API = '/api/account';
const FAVORITES_API = '/api/account/favorites';
const HTML_ROUTES = new Set(['/', '/index.html', '/explore', '/explore/', '/zero', '/zero/', '/freqbeacon-zero.html', '/lookup.html']);

function json(value, status = 200) {
  return new Response(JSON.stringify(value), {
    status,
    headers: {
      'content-type': 'application/json; charset=utf-8',
      'cache-control': 'no-store, max-age=0'
    }
  });
}

function normalizeEmail(value) {
  const email = String(value || '').trim().toLowerCase();
  return email && email.includes('@') && email.length <= 254 ? email : '';
}

function previewEnabled(request) {
  const url = new URL(request.url);
  if (!url.hostname.endsWith('.workers.dev')) return false;
  if (url.searchParams.get('preview') === '1' || url.searchParams.get('accountPreview') === '1') return true;
  return /(?:^|;\\s*)fb_account_preview=1(?:;|$)/.test(request.headers.get('cookie') || '');
}

function previewIdentity(request) {
  return previewEnabled(request) ? 'preview@freqbeacon.local' : '';
}

function identityEmail(request) {
  return normalizeEmail(
    request.headers.get('Cf-Access-Authenticated-User-Email')
    || previewIdentity(request)
  );
}

async function ensureAccountSchema(env) {
  const db = env?.RECEIVER_HEALTH_DB;
  if (!db) throw new Error('Account database binding is unavailable');
  await db.batch([
    db.prepare(`CREATE TABLE IF NOT EXISTS app_users (
      email TEXT PRIMARY KEY,
      created_at TEXT NOT NULL,
      last_seen_at TEXT NOT NULL
    )`),
    db.prepare(`CREATE TABLE IF NOT EXISTS app_favorites (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_email TEXT NOT NULL,
      kind TEXT NOT NULL,
      favorite_key TEXT NOT NULL,
      label TEXT NOT NULL,
      metadata_json TEXT,
      created_at TEXT NOT NULL,
      UNIQUE(user_email, kind, favorite_key)
    )`),
    db.prepare('CREATE INDEX IF NOT EXISTS idx_app_favorites_user ON app_favorites(user_email, created_at DESC)')
  ]);
  return db;
}

async function touchUser(db, email) {
  const now = new Date().toISOString();
  await db.prepare(`
    INSERT INTO app_users(email, created_at, last_seen_at)
    VALUES(?, ?, ?)
    ON CONFLICT(email) DO UPDATE SET last_seen_at=excluded.last_seen_at
  `).bind(email, now, now).run();
}

async function accountResponse(request, env) {
  const email = identityEmail(request);
  if (!email) return json({ authenticated: false }, 401);
  const db = await ensureAccountSchema(env);
  await touchUser(db, email);

  const user = await db.prepare('SELECT email,created_at,last_seen_at FROM app_users WHERE email=? LIMIT 1')
    .bind(email).first();
  const favorites = await db.prepare(`
    SELECT id,kind,favorite_key AS favoriteKey,label,metadata_json AS metadataJson,created_at AS createdAt
    FROM app_favorites
    WHERE user_email=?
    ORDER BY created_at DESC
    LIMIT 100
  `).bind(email).all();

  return json({
    authenticated: true,
    user,
    favorites: (favorites?.results || []).map((row) => ({
      ...row,
      metadata: (() => { try { return row.metadataJson ? JSON.parse(row.metadataJson) : null; } catch { return null; } })()
    }))
  });
}

async function favoriteResponse(request, env) {
  const email = identityEmail(request);
  if (!email) return json({ authenticated: false }, 401);
  const db = await ensureAccountSchema(env);
  await touchUser(db, email);

  if (request.method === 'POST') {
    let body;
    try { body = await request.json(); } catch { return json({ error: 'Invalid JSON' }, 400); }
    const kind = String(body?.kind || '').trim().slice(0, 40);
    const favoriteKey = String(body?.favoriteKey || '').trim().slice(0, 180);
    const label = String(body?.label || '').trim().slice(0, 220);
    if (!kind || !favoriteKey || !label) return json({ error: 'kind, favoriteKey and label are required' }, 400);

    const metadataJson = body?.metadata == null ? null : JSON.stringify(body.metadata).slice(0, 4000);
    const createdAt = new Date().toISOString();
    await db.prepare(`
      INSERT INTO app_favorites(user_email,kind,favorite_key,label,metadata_json,created_at)
      VALUES(?,?,?,?,?,?)
      ON CONFLICT(user_email,kind,favorite_key)
      DO UPDATE SET label=excluded.label, metadata_json=excluded.metadata_json
    `).bind(email, kind, favoriteKey, label, metadataJson, createdAt).run();
    return json({ ok: true });
  }

  if (request.method === 'DELETE') {
    const url = new URL(request.url);
    const id = Number(url.searchParams.get('id'));
    if (!Number.isInteger(id) || id <= 0) return json({ error: 'Valid favorite id required' }, 400);
    await db.prepare('DELETE FROM app_favorites WHERE id=? AND user_email=?').bind(id, email).run();
    return json({ ok: true });
  }

  return json({ error: 'Method not allowed' }, 405);
}

function authGateResponse(request) {
  const url = new URL(request.url);
  const returnTo = encodeURIComponent(url.href);
  return new Response(`<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Sign in — FREQBEACON</title><style>
html,body{margin:0;min-height:100%;background:#07111f;color:#eef8ff;font-family:Inter,system-ui,sans-serif}
body{display:grid;place-items:center;padding:24px;box-sizing:border-box}
.card{width:min(430px,100%);padding:34px;border:1px solid rgba(83,211,255,.24);border-radius:24px;background:linear-gradient(180deg,#0c1a2b,#08131f);box-shadow:0 28px 90px rgba(0,0,0,.45)}
.kicker{font-size:12px;letter-spacing:.16em;color:#62d9ff;font-weight:800}.brand{font-size:30px;font-weight:950;letter-spacing:.04em;margin:8px 0 2px}.tag{color:#9fb4c8;margin-bottom:28px}
h1{font-size:22px;margin:0 0 9px}.copy{color:#b9cad8;line-height:1.55}.button{display:block;text-align:center;text-decoration:none;margin-top:24px;padding:14px 18px;border-radius:14px;background:#f0a928;color:#07111f;font-weight:900}
.note{margin-top:16px;color:#6f879d;font-size:12px;line-height:1.45}
</style></head><body><main class="card"><div class="kicker">PRIVATE BETA</div><div class="brand">FREQBEACON</div><div class="tag">Explore the airwaves.</div><h1>Sign in to continue</h1><div class="copy">FREQBEACON is currently available to approved testers. Sign in with your approved email address to use the radio and keep your favorites.</div><a class="button" href="/cdn-cgi/access/login?redirect_url=${returnTo}">SIGN IN</a><div class="note">Access is limited while FREQBEACON is in private beta.</div></main></body></html>`, {
    status: 401,
    headers: { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store, max-age=0' }
  });
}

function decorateHtml(html, preview) {
  if (!html.includes('/freqbeacon-account.css')) {
    html = html.replace('</head>', '  <link rel="stylesheet" href="/freqbeacon-account.css?v=1">\n</head>');
  }
  if (!html.includes('/freqbeacon-account.js')) {
    const suffix = preview ? '?preview=1' : '';
    html = html.replace('</body>', `  <script>window.__FREQBEACON_ACCOUNT_PREVIEW__=${preview ? 'true' : 'false'};</script>\n  <script src="/freqbeacon-account.js?v=1${suffix}"></script>\n</body>`);
  }
  return html;
}

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    const email = identityEmail(request);
    const authRequired = String(env?.FREQBEACON_AUTH_REQUIRED || '') === '1';

    if (url.pathname === ACCOUNT_API && request.method === 'GET') {
      try { return await accountResponse(request, env); }
      catch (error) { return json({ error: error?.message || 'Account unavailable' }, 500); }
    }
    if (url.pathname === FAVORITES_API) {
      try { return await favoriteResponse(request, env); }
      catch (error) { return json({ error: error?.message || 'Favorites unavailable' }, 500); }
    }

    if (authRequired && HTML_ROUTES.has(url.pathname) && !email) {
      return authGateResponse(request);
    }

    const response = await baseWorker.fetch(request, env, ctx);
    if ((request.method === 'GET' || request.method === 'HEAD') && HTML_ROUTES.has(url.pathname)
      && response?.ok && String(response.headers.get('content-type') || '').includes('text/html')) {
      const headers = new Headers(response.headers);
      headers.delete('content-length');
      headers.delete('etag');
      headers.set('cache-control', 'no-store, max-age=0');
      headers.set('x-freqbeacon-account', 'private-beta-v1');
      const preview = previewEnabled(request);
      if (url.hostname.endsWith('.workers.dev') && url.searchParams.get('accountPreview') === '1') {
        headers.append('set-cookie', 'fb_account_preview=1; Path=/; Max-Age=86400; Secure; SameSite=Lax');
      }
      return new Response(decorateHtml(await response.text(), preview), {
        status: response.status,
        statusText: response.statusText,
        headers
      });
    }
    return response;
  },

  async scheduled(event, env, ctx) {
    if (typeof baseWorker.scheduled === 'function') return baseWorker.scheduled(event, env, ctx);
    return undefined;
  }
};
