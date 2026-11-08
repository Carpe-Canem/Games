/* Kennel Stats dashboard. All event fields come from visitors, so everything is inserted as text, never as HTML. */
(function () {
  var $ = function (id) { return document.getElementById(id); };
  var KEY = 'cc_admin_token';
  var map = null, layer = null, timer = null;

  function el(tag, cls, text) {
    var n = document.createElement(tag);
    if (cls) n.className = cls;
    if (text != null) n.textContent = text;
    return n;
  }
  function clear(n) { while (n.firstChild) n.removeChild(n.firstChild); return n; }
  function fmt(n) { return Number(n || 0).toLocaleString(); }
  function flag() { return ''; }   // Windows does not draw flag emoji, so country names are shown as text
  var regionNames = null;
  try { regionNames = new Intl.DisplayNames(['en'], { type: 'region' }); } catch (e) {}
  function country(cc) { if (!cc) return 'Unknown'; try { return flag(cc) + (regionNames.of(cc) || cc); } catch (e) { return flag(cc) + cc; } }
  function ago(ts, now) {
    var s = Math.max(0, Math.round((now - ts) / 1000));
    if (s < 60) return s + 's ago';
    if (s < 3600) return Math.round(s / 60) + 'm ago';
    if (s < 86400) return Math.round(s / 3600) + 'h ago';
    return Math.round(s / 86400) + 'd ago';
  }

  /* ---------- auth ---------- */
  function token() { try { return localStorage.getItem(KEY) || ''; } catch (e) { return ''; } }
  function showLogin(msg) {
    $('app').hidden = true; $('login').hidden = false;
    $('login-err').textContent = msg || '';
    $('token').focus();
  }
  $('login').addEventListener('submit', function (e) {
    e.preventDefault();
    try { localStorage.setItem(KEY, $('token').value.trim()); } catch (err) {}
    $('token').value = '';
    load();
  });
  $('logout').addEventListener('click', function () {
    try { localStorage.removeItem(KEY); } catch (e) {}
    showLogin('');
  });
  $('refresh').addEventListener('click', load);
  $('range').addEventListener('change', load);

  /* ---------- rendering ---------- */
  function bars(node, rows, labelOf) {
    clear(node);
    if (!rows.length) { node.appendChild(el('p', 'empty', 'Nothing yet.')); return; }
    var max = Math.max.apply(null, rows.map(function (r) { return r.n; })) || 1;
    rows.forEach(function (r) {
      var row = el('div', 'bar');
      row.appendChild(el('span', '', labelOf(r)));
      row.appendChild(el('b', '', fmt(r.n)));
      var track = el('div'), fill = el('i');
      fill.style.width = Math.max(2, r.n / max * 100) + '%';
      track.appendChild(fill); row.appendChild(track);
      node.appendChild(row);
    });
  }

  function kpis(t, days) {
    var box = clear($('kpis'));
    [['Visitors', t.visitors], ['Page views', t.views], ['Sessions', t.sessions], ['Clicks', t.clicks], ['New visitors', t.new_visitors]]
      .forEach(function (k) {
        var d = el('div', 'kpi'); d.appendChild(el('b', '', fmt(k[1]))); d.appendChild(el('span', '', k[0])); box.appendChild(d);
      });
  }

  function dailyChart(rows, days, now) {
    var box = clear($('daily')), by = {};
    rows.forEach(function (r) { by[r.day] = r; });
    var today = Math.floor(now / 86400000), list = [];
    for (var d = today - days + 1; d <= today; d++) list.push(by[d] || { day: d, views: 0, visitors: 0, clicks: 0 });
    var max = Math.max.apply(null, list.map(function (r) { return r.views; })) || 1;
    var step = Math.ceil(list.length / 12);
    list.forEach(function (r, i) {
      var col = el('div', 'col');
      col.title = new Date(r.day * 86400000).toUTCString().slice(0, 16) + ' (UTC): ' + r.views + ' views, ' + r.visitors + ' visitors, ' + r.clicks + ' clicks';
      var v = el('i'); v.style.height = (r.views / max * 120) + 'px'; col.appendChild(v);
      var lbl = el('em', '', i % step === 0 ? new Date(r.day * 86400000).toISOString().slice(5, 10) : '');
      col.appendChild(lbl); box.appendChild(col);
    });
    var lg = el('p', 'legend', 'Bars show page views per day (UTC). Hover for visitors and clicks.');
    box.parentNode.querySelectorAll('.legend').forEach(function (n) { n.remove(); });
    box.parentNode.appendChild(lg);
  }

  function hoursChart(rows) {
    var box = clear($('hours')), off = -new Date().getTimezoneOffset() / 60, by = new Array(24).fill(0);
    rows.forEach(function (r) { by[(((r.hour + Math.round(off)) % 24) + 24) % 24] += r.n; });
    var max = Math.max.apply(null, by) || 1;
    by.forEach(function (n, h) {
      var col = el('div', 'col'); col.title = h + ':00 — ' + n + ' views';
      var v = el('i'); v.style.height = (n / max * 80) + 'px'; col.appendChild(v);
      col.appendChild(el('em', '', h % 6 === 0 ? String(h) : '')); box.appendChild(col);
    });
  }

  function drawMap(places) {
    if (typeof L === 'undefined') { $('map-note').textContent = 'Map library did not load.'; return; }
    if (!map) {
      map = L.map('map', { worldCopyJump: true, minZoom: 1 }).setView([25, 0], 2);
      L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', {
        maxZoom: 18,
        attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
      }).addTo(map);
      layer = L.layerGroup().addTo(map);
    }
    layer.clearLayers();
    var pts = [];
    places.forEach(function (p) {
      var r = 5 + Math.min(18, Math.sqrt(p.visitors) * 4);
      var m = L.circleMarker([p.lat, p.lon], { radius: r, color: '#e9b44c', weight: 2, fillColor: '#66d6f0', fillOpacity: 0.55 });
      var tip = document.createElement('div');
      tip.textContent = [p.city, p.region, p.country].filter(Boolean).join(', ') + ' — ' + p.visitors + ' visitor' + (p.visitors === 1 ? '' : 's');
      m.bindTooltip(tip);
      m.addTo(layer); pts.push([p.lat, p.lon]);
    });
    if (pts.length) map.fitBounds(pts, { padding: [40, 40], maxZoom: 5 });
    $('map-note').textContent = pts.length
      ? 'Locations come from the visitor’s IP and are accurate to roughly city level; VPNs and mobile networks can be far off.'
      : 'No locations yet. Cloudflare only supplies them for live traffic, not when testing locally.';
    setTimeout(function () { map.invalidateSize(); }, 50);
  }

  function recent(rows, now) {
    var body = clear($('recent').tBodies[0]);
    if (!rows.length) { var tr = el('tr'), td = el('td', 'empty', 'No activity in this range.'); td.colSpan = 6; tr.appendChild(td); body.appendChild(tr); return; }
    rows.forEach(function (r) {
      var tr = el('tr');
      var t = el('td', '', ago(r.ts, now)); t.title = new Date(r.ts).toLocaleString(); tr.appendChild(t);
      var ev = el('td'), tag = el('span', 'tag ' + r.type, r.type === 'view' ? 'visit' : r.type === 'click' ? 'click' : 'saw');
      ev.appendChild(tag);
      if (r.type !== 'view' && r.target) ev.appendChild(document.createTextNode(' ' + r.target));
      if (r.type === 'view' && r.is_new) ev.appendChild(el('span', 'tag new', 'new'));
      tr.appendChild(ev);
      var place = [r.city, r.region].filter(Boolean).join(', ');
      tr.appendChild(el('td', '', r.country ? flag(r.country) + (place ? place + ', ' + r.country : country(r.country)) : '—'));
      tr.appendChild(el('td', '', r.isp || '—'));
      tr.appendChild(el('td', '', [r.device, r.browser, r.os].filter(Boolean).join(' · ')));
      var vt = el('td', 'ip', r.vid ? r.vid.slice(0, 6) : '—'); vt.title = 'Anonymous visitor id'; tr.appendChild(vt);
      body.appendChild(tr);
    });
  }

  function render(d) {
    kpis(d.totals, d.days);
    $('live-n').textContent = d.live; $('live').classList.toggle('on', d.live > 0);
    dailyChart(d.daily, d.days, d.now);
    hoursChart(d.hours);
    bars($('clicks'), d.clicks, function (r) { return r.target || '(unlabelled)'; });
    bars($('countries'), d.countries.map(function (c) { return { n: c.visitors, country: c.country }; }), function (r) { return country(r.country); });
    bars($('sections'), d.sections, function (r) { return r.target || '?'; });
    bars($('devices'), d.devices, function (r) { return r.k || 'Unknown'; });
    bars($('browsers'), d.browsers, function (r) { return r.k || 'Unknown'; });
    var refs = clear($('refs'));
    refs.appendChild(el('h2', '', 'Came from'));
    var holder = el('div', 'bars'); refs.appendChild(holder);
    bars(holder, d.refs, function (r) { return r.k; });
    recent(d.recent, d.now);
    $('app').hidden = false; $('login').hidden = true;
    drawMap(d.places);
  }

  /* ---------- load ---------- */
  function load() {
    var tk = token();
    if (!tk) { showLogin(''); return; }
    fetch('/api/stats?days=' + encodeURIComponent($('range').value), { headers: { Authorization: 'Bearer ' + tk }, cache: 'no-store' })
      .then(function (r) {
        if (r.status === 401) { try { localStorage.removeItem(KEY); } catch (e) {} showLogin('That token was not accepted.'); return null; }
        if (!r.ok) throw new Error('HTTP ' + r.status);
        return r.json();
      })
      .then(function (d) { if (d) render(d); })
      .catch(function (e) { showLogin('Could not load stats (' + e.message + ').'); });
  }

  load();
  timer = setInterval(function () { if (!document.hidden && !$('app').hidden) load(); }, 60000);
})();
