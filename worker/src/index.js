/* Carpe Canem stats Worker.
   POST /collect   the site's tracker.js sends events here (public, origin-checked)
   GET  /api/stats the dashboard reads aggregates here (needs the ADMIN_TOKEN secret)
   everything else is the admin dashboard (worker/admin), served as static assets. */

const MAX_BODY = 2000;
const BOT_RE = /bot|crawl|spider|slurp|headless|lighthouse|preview|curl|wget|python|httpclient|http-client|axios|go-http|java\/|facebookexternalhit|monitor|uptime/i;

const clip = (v, n = 200) => (typeof v === 'string' && v ? v.slice(0, n) : null);

function parseUA(ua = '') {
  const os = /Windows/.test(ua) ? 'Windows'
    : /Android/.test(ua) ? 'Android'
    : /iPhone|iPad|iPod/.test(ua) ? 'iOS'
    : /Mac OS X|Macintosh/.test(ua) ? 'macOS'
    : /CrOS/.test(ua) ? 'ChromeOS'
    : /Linux/.test(ua) ? 'Linux' : 'Other';
  const browser = /Edg\//.test(ua) ? 'Edge'
    : /OPR\/|Opera/.test(ua) ? 'Opera'
    : /Firefox\//.test(ua) ? 'Firefox'
    : /Chrome\/|CriOS/.test(ua) ? 'Chrome'
    : /Safari\//.test(ua) ? 'Safari' : 'Other';
  const device = /iPad|Tablet/.test(ua) ? 'Tablet'
    : /Mobi|iPhone|Android/.test(ua) ? 'Mobile' : 'Desktop';
  return { os, browser, device };
}

function originAllowed(origin, env) {
  if (!origin) return false;
  if (/^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(origin)) return true;
  return String(env.ALLOWED_ORIGINS || '').split(',').map((s) => s.trim()).includes(origin);
}

function cors(origin) {
  return {
    'access-control-allow-origin': origin,
    'access-control-allow-methods': 'POST, OPTIONS',
    'access-control-allow-headers': 'content-type',
    vary: 'origin',
  };
}

const json = (obj, status = 200, extra = {}) =>
  new Response(JSON.stringify(obj), {
    status,
    headers: { 'content-type': 'application/json', 'cache-control': 'no-store', ...extra },
  });

/* constant-time token check: compare SHA-256 digests byte by byte */
async function tokenOk(request, env) {
  const given = (request.headers.get('authorization') || '').replace(/^Bearer\s+/i, '');
  if (!env.ADMIN_TOKEN || !given) return false;
  const enc = new TextEncoder();
  const [a, b] = await Promise.all([
    crypto.subtle.digest('SHA-256', enc.encode(given)),
    crypto.subtle.digest('SHA-256', enc.encode(env.ADMIN_TOKEN)),
  ]);
  const x = new Uint8Array(a), y = new Uint8Array(b);
  let diff = 0;
  for (let i = 0; i < x.length; i++) diff |= x[i] ^ y[i];
  return diff === 0;
}

async function collect(request, env) {
  const origin = request.headers.get('origin');
  if (!originAllowed(origin, env)) return new Response('forbidden', { status: 403 });
  const headers = cors(origin);
  if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers });

  const ua = request.headers.get('user-agent') || '';
  if (BOT_RE.test(ua)) return new Response(null, { status: 204, headers });

  const raw = await request.text();
  if (raw.length > MAX_BODY) return new Response('too large', { status: 413, headers });
  let b;
  try { b = JSON.parse(raw); } catch { return new Response('bad json', { status: 400, headers }); }
  if (!b || !['view', 'click', 'section'].includes(b.t)) return new Response('bad type', { status: 400, headers });

  const cf = request.cf || {};
  const { os, browser, device } = parseUA(ua);
  const lat = cf.latitude != null ? parseFloat(cf.latitude) : null;
  const lon = cf.longitude != null ? parseFloat(cf.longitude) : null;

  await env.DB.prepare(
    `INSERT INTO events (ts,type,sid,vid,is_new,target,path,ref,country,region,city,lat,lon,tz,asn,isp,device,browser,os,lang,scr)
     VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`
  ).bind(
    Date.now(), b.t, clip(b.sid, 40), clip(b.vid, 40), b.n ? 1 : 0,
    clip(b.target, 80), clip(b.path, 120), clip(b.ref, 120),
    cf.country || null, cf.region || null, cf.city || null,
    Number.isFinite(lat) ? lat : null, Number.isFinite(lon) ? lon : null,
    cf.timezone || null, cf.asn || null, cf.asOrganization || null,
    device, browser, os, clip(b.lang, 20), clip(b.scr, 20)
  ).run();

  return new Response(null, { status: 204, headers });
}

async function stats(request, env) {
  if (!(await tokenOk(request, env))) return json({ error: 'unauthorized' }, 401);
  const url = new URL(request.url);
  const days = Math.min(90, Math.max(1, parseInt(url.searchParams.get('days'), 10) || 7));
  const now = Date.now();
  const since = now - days * 86400000;
  const q = (sql, ...args) => env.DB.prepare(sql).bind(...args).all().then((r) => r.results);

  const [totals, daily, clicks, countries, devices, browsers, refs, hours, sections, places, recent, live] = await Promise.all([
    q(`SELECT COUNT(CASE WHEN type='view' THEN 1 END) views,
              COUNT(DISTINCT vid) visitors,
              COUNT(DISTINCT sid) sessions,
              COUNT(CASE WHEN type='click' THEN 1 END) clicks,
              COUNT(DISTINCT CASE WHEN is_new=1 THEN vid END) new_visitors
       FROM events WHERE ts >= ?`, since),
    q(`SELECT CAST(ts/86400000 AS INTEGER) day,
              COUNT(CASE WHEN type='view' THEN 1 END) views,
              COUNT(DISTINCT vid) visitors,
              COUNT(CASE WHEN type='click' THEN 1 END) clicks
       FROM events WHERE ts >= ? GROUP BY day ORDER BY day`, since),
    q(`SELECT target, COUNT(*) n, COUNT(DISTINCT vid) visitors FROM events
       WHERE type='click' AND ts >= ? GROUP BY target ORDER BY n DESC LIMIT 30`, since),
    q(`SELECT country, COUNT(DISTINCT vid) visitors, COUNT(*) events FROM events
       WHERE type='view' AND ts >= ? GROUP BY country ORDER BY visitors DESC LIMIT 20`, since),
    q(`SELECT device k, COUNT(DISTINCT vid) n FROM events WHERE type='view' AND ts >= ? GROUP BY device ORDER BY n DESC`, since),
    q(`SELECT browser k, COUNT(DISTINCT vid) n FROM events WHERE type='view' AND ts >= ? GROUP BY browser ORDER BY n DESC`, since),
    q(`SELECT ref k, COUNT(*) n FROM events WHERE type='view' AND ref IS NOT NULL AND ts >= ? GROUP BY ref ORDER BY n DESC LIMIT 10`, since),
    q(`SELECT CAST((ts/3600000)%24 AS INTEGER) hour, COUNT(*) n FROM events WHERE type='view' AND ts >= ? GROUP BY hour`, since),
    q(`SELECT target, COUNT(DISTINCT sid) n FROM events WHERE type='section' AND ts >= ? GROUP BY target ORDER BY n DESC`, since),
    q(`SELECT lat, lon, city, region, country, COUNT(DISTINCT vid) visitors, COUNT(*) events, MAX(ts) last_seen
       FROM events WHERE lat IS NOT NULL AND lon IS NOT NULL AND ts >= ?
       GROUP BY lat, lon ORDER BY visitors DESC LIMIT 500`, since),
    q(`SELECT ts,type,target,path,ref,country,region,city,tz,asn,isp,device,browser,os,lang,scr,is_new,vid,sid
       FROM events WHERE ts >= ? ORDER BY ts DESC LIMIT 300`, since),
    q(`SELECT COUNT(DISTINCT vid) n FROM events WHERE ts >= ?`, now - 5 * 60000),
  ]);

  return json({ days, now, totals: totals[0], daily, clicks, countries, devices, browsers, refs, hours, sections, places, recent, live: live[0].n });
}

async function purge(env) {
  const days = parseInt(env.RETENTION_DAYS, 10) || 90;
  await env.DB.prepare('DELETE FROM events WHERE ts < ?').bind(Date.now() - days * 86400000).run();
}

export default {
  async fetch(request, env) {
    const { pathname } = new URL(request.url);
    try {
      if (pathname === '/collect' && (request.method === 'POST' || request.method === 'OPTIONS')) return await collect(request, env);
      if (pathname === '/api/stats' && request.method === 'GET') return await stats(request, env);
    } catch (e) {
      return json({ error: 'server error' }, 500);
    }
    const res = await env.ASSETS.fetch(request);
    const h = new Headers(res.headers);
    h.set('x-robots-tag', 'noindex, nofollow');
    h.set('referrer-policy', 'no-referrer');
    return new Response(res.body, { status: res.status, headers: h });
  },
  async scheduled(event, env, ctx) {
    ctx.waitUntil(purge(env));
  },
};
