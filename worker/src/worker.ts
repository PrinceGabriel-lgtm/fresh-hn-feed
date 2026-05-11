import { handleHnFeedRequest, runHnFeedCron } from "./products/hn-feed/hn-format.js";

interface Env {
  DB: D1Database;
  PRODUCT?: string;
}

function jsonError(message: string, status = 500): Response {
  return new Response(JSON.stringify({ error: message }, null, 2), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    if (env.PRODUCT !== "hn-feed") {
      return jsonError("Fresh HN Feed is not enabled for this Worker.", 503);
    }

    try {
      return await handleHnFeedRequest(request, env.DB);
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : "Fresh HN Feed error";
      return jsonError(message);
    }
  },

  async scheduled(_event: ScheduledController, env: Env, ctx: ExecutionContext): Promise<void> {
    if (env.PRODUCT !== "hn-feed") return;
    ctx.waitUntil(runHnFeedCron(env.DB));
  },
} satisfies ExportedHandler<Env>;

