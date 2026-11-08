CREATE TABLE IF NOT EXISTS events (
  id      INTEGER PRIMARY KEY AUTOINCREMENT,
  ts      INTEGER NOT NULL,          -- ms since epoch (UTC)
  type    TEXT NOT NULL,             -- view | click | section
  sid     TEXT,                      -- per-tab session id
  vid     TEXT,                      -- per-browser anonymous visitor id
  is_new  INTEGER NOT NULL DEFAULT 0,
  target  TEXT,                      -- click label or section id
  path    TEXT,
  ref     TEXT,                      -- external referrer host
  country TEXT, region TEXT, city TEXT,
  lat     REAL, lon REAL,
  tz      TEXT,
  asn     INTEGER, isp TEXT,
  device  TEXT, browser TEXT, os TEXT,
  lang    TEXT, scr TEXT
);
CREATE INDEX IF NOT EXISTS idx_events_ts ON events(ts);
CREATE INDEX IF NOT EXISTS idx_events_type_ts ON events(type, ts);
