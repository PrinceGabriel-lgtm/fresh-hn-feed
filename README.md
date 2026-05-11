# Fresh HN Feed

A freshness-ranked Hacker News intelligence feed powered by FreshContext DAR scoring.

Fresh HN Feed is a standalone Cloudflare Worker API that fetches Hacker News stories, stores scored signals in Cloudflare D1, and serves ranked feeds optimized for current relevance rather than raw popularity alone.

Powered by FreshContext.

## Architecture

```text
Hacker News Firebase API
        |
        v
Cloudflare Worker cron, every 15 minutes
        |
        v
FreshContext DAR scoring
        |
        v
Cloudflare D1: hn_signals
        |
        v
GET /v1/hn/feed, /fresh, /trending, /explain/:id
```

The Worker fetches `topstories`, `newstories`, and `beststories` from the official Hacker News Firebase API, hydrates each story, filters deleted/dead/non-story items, computes a freshness-aware score, and upserts each signal into D1.

No UI, auth, billing, embeddings, clustering, scraping, or multi-source orchestration is included.

## DAR Scoring

Fresh HN Feed uses FreshContext Decay-Adjusted Relevancy (DAR) scoring for Hacker News:

```text
rt_score = log1p(score) * exp(-0.05 * age_hours)
```

Where:

- `score` is the raw Hacker News score.
- `age_hours` is the story age at read time.
- `0.05` is the Hacker News decay lambda.
- `log1p(score)` prevents very high raw scores from overwhelming freshness.

Scores are computed when stories are ingested and recomputed again when feeds are read, so rankings keep aging naturally between cron runs.

## Why Freshness-Aware Ranking Matters

AI systems often need signals that are current enough to act on. Raw Hacker News ranking can keep older high-score stories above newer fast-moving signals. DAR scoring helps agents, research workflows, and monitoring systems prioritize stories that are both meaningful and temporally fresh.

## API Endpoints

### `GET /health`

Returns Worker health status.

### `GET /v1/hn/feed`

Returns the default freshness-ranked feed, sorted by recomputed `rt_score`.

Query parameters:

- `limit`: number, default `20`, clamped to `1..100`.
- `min_score`: number, default `0`.

### `GET /v1/hn/fresh`

Returns the newest stories first, still filtered by recomputed `rt_score`.

### `GET /v1/hn/trending`

Returns stories sorted by recomputed `rt_score`, tie-broken by `comment_count`.

### `GET /v1/hn/explain/:id`

Returns the scoring explanation for a stored Hacker News story.

## Example Requests

```bash
curl "http://localhost:8787/health"
curl "http://localhost:8787/v1/hn/feed?limit=10"
curl "http://localhost:8787/v1/hn/fresh?limit=10&min_score=0.5"
curl "http://localhost:8787/v1/hn/trending?limit=10"
curl "http://localhost:8787/v1/hn/explain/48090029"
```

Production examples:

```bash
curl "https://fresh-hn-feed.gimmanuel73.workers.dev/v1/hn/feed?limit=10"
curl "https://fresh-hn-feed.gimmanuel73.workers.dev/v1/hn/explain/48090029"
```

## Example Response

```json
{
  "feed_metadata": {
    "product": "fresh-hn-feed",
    "mode": "feed",
    "generated_at": "2026-05-11T09:16:34.703Z",
    "signal_count": 1,
    "limit": 1,
    "min_score": 0,
    "decay": {
      "lambda": 0.05,
      "formula": "rt_score = log1p(score) * exp(-lambda * age_hours)"
    }
  },
  "signals": [
    {
      "id": 48091737,
      "title": "Mythos Finds a Curl Vulnerability",
      "url": "https://daniel.haxx.se/blog/2026/05/11/mythos-finds-a-curl-vulnerability/",
      "score": 109,
      "comment_count": 44,
      "rt_score": 4.1,
      "age_hours": 2.62,
      "published_at": "2026-05-11T06:39:08.000Z",
      "semantic_fingerprint": "0bb9a87d9bd96629",
      "inserted_at": "2026-05-11T09:15:02.852Z"
    }
  ]
}
```

## Explainability Example

```json
{
  "id": 48091737,
  "raw_score": 109,
  "comment_count": 44,
  "age_hours": 2.66,
  "lambda": 0.05,
  "rt_score": 4.1,
  "formula": "log1p(score) * exp(-lambda * age_hours)",
  "score_transform": "log1p(109)"
}
```

## Local Development

Install dependencies:

```bash
cd worker
npm install
```

Run type checks:

```bash
npm run check
```

Run locally:

```bash
npm run dev
```

Trigger the scheduled handler locally:

```bash
curl "http://localhost:8787/__scheduled"
```

## D1 Setup

Create a D1 database:

```bash
npx wrangler d1 create fresh-hn-feed-db
```

Paste the generated `database_id` into `worker/wrangler.hn-feed.jsonc`.

Apply the schema locally or remotely if needed:

```bash
npx wrangler d1 execute fresh-hn-feed-db --local --file migrations/0001_hn_signals.sql
npx wrangler d1 execute fresh-hn-feed-db --remote --file migrations/0001_hn_signals.sql
```

The Worker also creates the table and indexes lazily before reads and cron ingests.

## Cron Behavior

The Worker runs every 15 minutes:

```text
*/15 * * * *
```

Each cron run:

1. Fetches Hacker News `topstories`, `newstories`, and `beststories`.
2. Hydrates up to 15 IDs per list.
3. Filters deleted, dead, and non-story items.
4. Computes `rt_score`.
5. Upserts each signal into D1 by HN item ID.

## Deployment

Deploy independently from the `worker/` directory:

```bash
cd worker
npx wrangler deploy --config wrangler.hn-feed.jsonc
```

The config deploys the standalone Worker named `fresh-hn-feed` with D1 binding `DB` and `PRODUCT=hn-feed`.

