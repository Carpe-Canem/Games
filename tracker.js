/* Carpe Canem visitor stats: page views, clicks and which sections get seen.
   No cookies. A random anonymous id is kept in the visitor's browser (localStorage), a per-tab id in sessionStorage.
   Nothing is sent when the visitor has Do Not Track / Global Privacy Control on, or for automated browsers.
   Events go to the stats Worker (see worker/README.md). Leave ENDPOINT empty to switch tracking off. */
(function () {
  var ENDPOINT = 'https://carpe-canem-stats.carpecanem.workers.dev/collect';
  if (window.CC_TRACK_URL) ENDPOINT = window.CC_TRACK_URL;   // lets local testing point at wrangler dev
  if (!ENDPOINT) return;
  if (navigator.webdriver === true || navigator.doNotTrack === '1' || navigator.globalPrivacyControl === true) return;
  if (/[?&#]notrack/.test(location.search + location.hash)) return;

  function rand() {
    try { var a = new Uint8Array(9); crypto.getRandomValues(a); return Array.prototype.map.call(a, function (b) { return ('0' + b.toString(16)).slice(-2); }).join(''); }
    catch (e) { return Math.random().toString(16).slice(2, 20); }
  }
  function store(area, key) {
    try { var v = window[area].getItem(key); if (v) return [v, false]; v = rand(); window[area].setItem(key, v); return [v, true]; }
    catch (e) { return [rand(), true]; }
  }
  var v = store('localStorage', 'cc_vid'), s = store('sessionStorage', 'cc_sid');
  var vid = v[0], sid = s[0], isNew = v[1];

  function send(type, target) {
    var body = JSON.stringify({
      t: type, sid: sid, vid: vid, n: type === 'view' && isNew ? 1 : 0, target: target || null,
      path: location.pathname, lang: navigator.language, scr: screen.width + 'x' + screen.height,
      ref: type === 'view' ? externalRef() : null
    });
    // a plain-text body keeps this a "simple" request (no CORS preflight), and sendBeacon survives leaving the page
    try { if (navigator.sendBeacon && navigator.sendBeacon(ENDPOINT, body)) return; } catch (e) {}
    try { fetch(ENDPOINT, { method: 'POST', body: body, keepalive: true, mode: 'cors', headers: { 'content-type': 'text/plain' } }).catch(function () {}); } catch (e) {}
  }
  function externalRef() {
    try { var h = new URL(document.referrer).hostname; return h && h !== location.hostname ? h : null; } catch (e) { return null; }
  }

  send('view');

  /* clicks: a data-track label wins, otherwise the link text */
  document.addEventListener('click', function (e) {
    var t = e.target && e.target.closest ? e.target.closest('[data-track], a[href]') : null;
    if (!t) return;
    var label = t.getAttribute('data-track') ||
      (t.tagName === 'A' ? (t.textContent || '').trim().replace(/\s+/g, ' ').slice(0, 40) + ' -> ' + (t.getAttribute('href') || '').slice(0, 40) : '');
    if (label) send('click', label);
  }, true);

  /* which sections scroll into view (once each per page load) */
  if ('IntersectionObserver' in window) {
    var seen = {}, io = new IntersectionObserver(function (entries) {
      entries.forEach(function (en) {
        if (en.isIntersecting && !seen[en.target.id]) { seen[en.target.id] = 1; send('section', en.target.id); io.unobserve(en.target); }
      });
    }, { threshold: 0, rootMargin: '0px 0px -30% 0px' });   // counts once the section's top is 30% up the screen, however tall it is
    ['games', 'chapters', 'kennel', 'close'].forEach(function (id) { var n = document.getElementById(id); if (n) io.observe(n); });
  }
})();
