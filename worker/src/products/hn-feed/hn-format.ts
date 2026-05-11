import {
  explainHnSignal,
  getHnFeed,
  HN_LAMBDA,
  HnFeedMode,
  ingestHnSignals,
  RankedHnSignal,
} from "./hn-rank.js";

function jsonResponse(body: unknown, init: ResponseInit = {}): Response {
  return new Response(JSON.stringify(body, null, 2), {
    ...init,
    headers: {
      "Content-Type": "application/json",
      ...(init.headers ?? {}),
    },
  });
}

function parseLimit(url: URL): number {
  const parsed = Number.parseInt(url.searchParams.get("limit") ?? "20", 10);
  if (!Number.isFinite(parsed)) return 20;
  return Math.max(1, Math.min(100, parsed));
}

function parseMinScore(url: URL): number {
  const parsed = Number.parseFloat(url.searchParams.get("min_score") ?? "0");
  if (!Number.isFinite(parsed)) return 0;
  return Math.max(0, parsed);
}

function publicSignal(signal: RankedHnSignal): Record<string, unknown> {
  return {
    id: signal.id,
    title: signal.title,
    url: signal.url,
    score: signal.score,
    comment_count: signal.comment_count,
    rt_score: signal.rt_score,
    age_hours: signal.age_hours,
    published_at: signal.published_at,
    semantic_fingerprint: signal.semantic_fingerprint,
    inserted_at: signal.inserted_at,
  };
}

function endpointList() {
  return {
    service: "fresh-hn-feed",
    description: "Hacker News signals ranked with FreshContext temporal decay",
    endpoints: {
      health: "GET /health",
      feed: "GET /v1/hn/feed?limit=20&min_score=0",
      fresh: "GET /v1/hn/fresh?limit=20&min_score=0",
      trending: "GET /v1/hn/trending?limit=20&min_score=0",
      explain: "GET /v1/hn/explain/:id",
    },
  };
}

function feedPayload(mode: HnFeedMode, signals: RankedHnSignal[], options: { limit: number; min_score: number }) {
  return {
    feed_metadata: {
      product: "fresh-hn-feed",
      mode,
      generated_at: new Date().toISOString(),
      signal_count: signals.length,
      limit: options.limit,
      min_score: options.min_score,
      decay: {
        lambda: HN_LAMBDA,
        formula: "rt_score = log1p(score) * exp(-lambda * age_hours)",
      },
    },
    signals: signals.map(publicSignal),
  };
}

export async function handleHnFeedRequest(request: Request, db: D1Database): Promise<Response> {
  const url = new URL(request.url);

  if (request.method !== "GET") {
    return jsonResponse({ error: "Method not allowed" }, { status: 405 });
  }

  if (url.pathname === "/health") {
    return jsonResponse({
      status: "ok",
      service: "fresh-hn-feed",
      time: new Date().toISOString(),
    });
  }

  if (url.pathname === "/" || url.pathname === "") {
    return jsonResponse(endpointList());
  }

  const modeByPath: Record<string, HnFeedMode> = {
    "/v1/hn/feed": "feed",
    "/v1/hn/fresh": "fresh",
    "/v1/hn/trending": "trending",
  };

  const mode = modeByPath[url.pathname];
  if (mode) {
    const options = {
      limit: parseLimit(url),
      min_score: parseMinScore(url),
    };
    const signals = await getHnFeed(db, mode, options);
    return jsonResponse(feedPayload(mode, signals, options));
  }

  if (url.pathname.startsWith("/v1/hn/explain/")) {
    const idText = url.pathname.replace("/v1/hn/explain/", "").trim();
    const id = Number.parseInt(idText, 10);
    if (!Number.isFinite(id)) {
      return jsonResponse({ error: "Invalid Hacker News id" }, { status: 400 });
    }

    const explanation = await explainHnSignal(db, id);
    if (!explanation) {
      return jsonResponse({ error: `HN signal not found: ${id}` }, { status: 404 });
    }

    return jsonResponse(explanation);
  }

  return jsonResponse({
    error: `Not found: ${url.pathname}`,
    ...endpointList(),
  }, { status: 404 });
}

export async function runHnFeedCron(db: D1Database): Promise<void> {
  const result = await ingestHnSignals(db);
  console.log(JSON.stringify({
    product: "fresh-hn-feed",
    event: "hn_ingest_complete",
    ...result,
  }));
}

