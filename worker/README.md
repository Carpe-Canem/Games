# Kennel Stats (visitor analytics + admin dashboard)

The landing page is static (GitHub Pages), so it can't see IP addresses. A small Cloudflare Worker does:

- `POST /collect` receives events from `tracker.js` on the site (page views, clicks, sections seen).
  Cloudflare supplies the city, lat/long, ISP and timezone (the IP address itself is never stored); no third-party geo service.
- `GET /api/stats` feeds the dashboard. It needs your admin token.
- `/` is the dashboard itself (`admin/`), served by the Worker, **not** by the public site.

Free tier is plenty (Workers + D1). Everything in this folder is public once pushed, so the token is never stored here.

## One-time setup (run in this `worker` folder)

1. `npm install`
2. `npx wrangler login` (opens a browser; create a free Cloudflare account first if needed)
3. `npx wrangler d1 create carpe-canem-stats`, then paste the `database_id` it prints into `wrangler.toml`
4. `npm run db:init` (creates the table)
5. `npx wrangler secret put ADMIN_TOKEN`, then type a long random string (this is your dashboard password)
6. `npx wrangler deploy`, which prints your URL, like `https://carpe-canem-stats.<you>.workers.dev`
7. In `../tracker.js` set `ENDPOINT = 'https://carpe-canem-stats.<you>.workers.dev/collect'`
8. If the landing page isn't served from `https://carpe-canem.github.io`, add its origin to `ALLOWED_ORIGINS` in `wrangler.toml` and redeploy
9. Commit and push the site. Open your Worker URL and sign in with the token.

## Try it locally

```
echo ADMIN_TOKEN=local-test-token > .dev.vars
npm run db:init:local
npm run dev            # http://localhost:8787
```
Local runs return made-up geo data; real locations only appear on the deployed Worker.

## What is collected

Per event: time, event type, click/section label, page, external referrer host, country/region/city/lat/long,
timezone, ISP/ASN, device/browser/OS, language, screen size, an anonymous random visitor id (browser localStorage) and a per-tab session id.
No cookies. Visitors with Do Not Track or Global Privacy Control on, and automated browsers, aren't counted. `?notrack` on the URL skips your own visits.
Rows older than `RETENTION_DAYS` (90) are deleted daily.

IP addresses are not stored. City-level location is, which is far less identifying than an IP, but if you have visitors in the EU/UK a short privacy note is still good practice.

## Limits

- IP geolocation is city-level at best; VPNs, mobile carriers and corporate networks can put people far from where they are.
- You can't see "who" by name, only anonymous visitors (by visitor id, location and device). Returning visitors are detected per browser.
- Clicks on the game itself are not visible here: MOOP Monster lives on a different page. Only the click *out* to it is counted.
