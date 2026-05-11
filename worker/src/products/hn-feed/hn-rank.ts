import { applyDecay, LAMBDA, semanticFingerprint } from "../../intelligence.js";
import { fetchHnStories, HnStory } from "./hn-fetch.js";

export type HnFeedMode = "feed" | "fresh" | "trending";

export interface HnSignal {
  id: number;
  title: string;
  url: string;
  score: number;
  comment_count: number;
  rt_score: number;
  published_at: string;
  semantic_fingerprint: string;
  inserted_at: string;
}

export interface RankedHnSignal extends HnSignal {
  age_hours: number;
}

export interface HnFeedOptions {
  limit: number;
  min_score: number;
}

export const HN_LAMBDA = LAMBDA.hackernews ?? 0.05;

const HN_SCHEMA_STATEMENTS = [
  `CREATE TABLE IF NOT EXISTS hn_signals (
    id INTEGER PRIMARY KEY,
    title TEXT NOT NULL,
    url TEXT NOT NULL,
    score INTEGER NOT NULL DEFAULT 0,
    comment_count INTEGER NOT NULL DEFAULT 0,
    rt_score REAL NOT NULL DEFAULT 0,
    published_at TEXT NOT NULL,
    semantic_fingerprint TEXT NOT NULL,
    inserted_at TEXT NOT NULL
  )`,
  `CREATE INDEX IF NOT EXISTS idx_hn_signals_rt_score ON hn_signals(rt_score)`,
  `CREATE INDEX IF NOT EXISTS idx_hn_signals_published_at ON hn_signals(published_at)`,
  `CREATE INDEX IF NOT EXISTS idx_hn_signals_semantic_fingerprint ON hn_signals(semantic_fingerprint)`,
];

let hnSchemaPromise: Promise<void> | null = null;

export async function ensureHnSchema(db: D1Database): Promise<void> {
  if (hnSchemaPromise) return hnSchemaPromise;

  hnSchemaPromise = (async () => {
    for (const sql of HN_SCHEMA_STATEMENTS) {
      await db.prepare(sql).run();
    }
  })();

  try {
    await hnSchemaPromise;
  } catch (error) {
    hnSchemaPromise = null;
    throw error;
  }
}

function ageHours(publishedAt: string, now = Date.now()): number {
  const published = new Date(publishedAt).getTime();
  if (Number.isNaN(published)) return 0;
  return Math.max(0, (now - published) / (1000 * 60 * 60));
}

function roundScore(value: number): number {
  return Math.round(value * 1_000_000) / 1_000_000;
}

export function calculateHnRtScore(score: number, publishedAt: string): number {
  const baseScore = Math.log1p(Math.max(0, score));
  const decayed = applyDecay(baseScore, publishedAt, "hackernews");
  return roundScore(decayed.rt);
}

async function fingerprintStory(story: HnStory): Promise<string> {
  return await semanticFingerprint([
    story.title,
    `URL: ${story.url}`,
    `Posted: ${story.published_at}`,
  ].join("\n"));
}

async function upsertStory(db: D1Database, story: HnStory): Promise<void> {
  const rtScore = calculateHnRtScore(story.score, story.published_at);
  const fingerprint = await fingerprintStory(story);
  const insertedAt = new Date().toISOString();

  await db.prepare(`
    INSERT INTO hn_signals
      (id, title, url, score, comment_count, rt_score, published_at, semantic_fingerprint, inserted_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(id) DO UPDATE SET
      title = excluded.title,
      url = excluded.url,
      score = excluded.score,
      comment_count = excluded.comment_count,
      rt_score = excluded.rt_score,
      published_at = excluded.published_at,
      semantic_fingerprint = excluded.semantic_fingerprint,
      inserted_at = excluded.inserted_at
  `).bind(
    story.id,
    story.title,
    story.url,
    story.score,
    story.comment_count,
    rtScore,
    story.published_at,
    fingerprint,
    insertedAt
  ).run();
}

export async function ingestHnSignals(db: D1Database): Promise<{ fetched: number; stored: number; generated_at: string }> {
  await ensureHnSchema(db);
  const stories = await fetchHnStories();

  let stored = 0;
  for (const story of stories) {
    await upsertStory(db, story);
    stored++;
  }

  return {
    fetched: stories.length,
    stored,
    generated_at: new Date().toISOString(),
  };
}

function recompute(row: HnSignal): RankedHnSignal {
  return {
    ...row,
    rt_score: calculateHnRtScore(row.score, row.published_at),
    age_hours: roundScore(ageHours(row.published_at)),
  };
}

function sortRanked(rows: RankedHnSignal[], mode: HnFeedMode): RankedHnSignal[] {
  if (mode === "fresh") {
    return rows.sort((a, b) => b.published_at.localeCompare(a.published_at));
  }

  if (mode === "trending") {
    return rows.sort((a, b) => (b.rt_score - a.rt_score) || (b.comment_count - a.comment_count));
  }

  return rows.sort((a, b) => b.rt_score - a.rt_score);
}

export async function getHnFeed(
  db: D1Database,
  mode: HnFeedMode,
  options: HnFeedOptions
): Promise<RankedHnSignal[]> {
  await ensureHnSchema(db);
  const overFetch = Math.min(500, Math.max(options.limit * 5, 100));
  const orderBy = mode === "fresh"
    ? "published_at DESC"
    : "rt_score DESC, published_at DESC";

  const { results } = await db.prepare(`
    SELECT id, title, url, score, comment_count, rt_score, published_at, semantic_fingerprint, inserted_at
    FROM hn_signals
    ORDER BY ${orderBy}
    LIMIT ?
  `).bind(overFetch).all<HnSignal>();

  return sortRanked(
    results.map(recompute).filter(row => row.rt_score >= options.min_score),
    mode
  ).slice(0, options.limit);
}

export async function explainHnSignal(db: D1Database, id: number) {
  await ensureHnSchema(db);
  const row = await db.prepare(`
    SELECT id, title, url, score, comment_count, rt_score, published_at, semantic_fingerprint, inserted_at
    FROM hn_signals
    WHERE id = ?
    LIMIT 1
  `).bind(id).first<HnSignal>();

  if (!row) return null;

  return {
    id: row.id,
    title: row.title,
    url: row.url,
    raw_score: row.score,
    comment_count: row.comment_count,
    age_hours: roundScore(ageHours(row.published_at)),
    lambda: HN_LAMBDA,
    rt_score: calculateHnRtScore(row.score, row.published_at),
    formula: "log1p(score) * exp(-lambda * age_hours)",
    score_transform: `log1p(${row.score})`,
    published_at: row.published_at,
    semantic_fingerprint: row.semantic_fingerprint,
  };
}

