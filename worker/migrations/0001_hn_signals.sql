CREATE TABLE IF NOT EXISTS hn_signals (
  id INTEGER PRIMARY KEY,
  title TEXT NOT NULL,
  url TEXT NOT NULL,
  score INTEGER NOT NULL DEFAULT 0,
  comment_count INTEGER NOT NULL DEFAULT 0,
  rt_score REAL NOT NULL DEFAULT 0,
  published_at TEXT NOT NULL,
  semantic_fingerprint TEXT NOT NULL,
  inserted_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_hn_signals_rt_score ON hn_signals(rt_score);
CREATE INDEX IF NOT EXISTS idx_hn_signals_published_at ON hn_signals(published_at);
CREATE INDEX IF NOT EXISTS idx_hn_signals_semantic_fingerprint ON hn_signals(semantic_fingerprint);

