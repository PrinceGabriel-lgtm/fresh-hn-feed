export type HnFeedKind = "topstories" | "newstories" | "beststories";

export interface HnStory {
  id: number;
  title: string;
  url: string;
  score: number;
  comment_count: number;
  published_at: string;
}

interface HnItem {
  id?: number;
  type?: string;
  deleted?: boolean;
  dead?: boolean;
  title?: string;
  url?: string;
  score?: number;
  descendants?: number;
  time?: number;
}

const HN_API = "https://hacker-news.firebaseio.com/v0";
const FEEDS: HnFeedKind[] = ["topstories", "newstories", "beststories"];
const IDS_PER_LIST = 15;

async function fetchJson<T>(url: string): Promise<T> {
  const response = await fetch(url, {
    headers: {
      "Accept": "application/json",
      "User-Agent": "fresh-hn-feed/0.1",
    },
  });

  if (!response.ok) {
    throw new Error(`Hacker News API error ${response.status} for ${url}`);
  }

  return await response.json() as T;
}

function normalizeStory(item: HnItem): HnStory | null {
  if (
    item.deleted ||
    item.dead ||
    item.type !== "story" ||
    typeof item.id !== "number" ||
    !item.title ||
    typeof item.time !== "number"
  ) {
    return null;
  }

  return {
    id: item.id,
    title: item.title.trim(),
    url: item.url?.trim() || `https://news.ycombinator.com/item?id=${item.id}`,
    score: Math.max(0, Math.trunc(item.score ?? 0)),
    comment_count: Math.max(0, Math.trunc(item.descendants ?? 0)),
    published_at: new Date(item.time * 1000).toISOString(),
  };
}

export async function fetchHnStories(): Promise<HnStory[]> {
  const feedIdLists = await Promise.all(
    FEEDS.map(feed => fetchJson<number[]>(`${HN_API}/${feed}.json`))
  );

  const seen = new Set<number>();
  const ids = feedIdLists
    .flatMap(list => list.slice(0, IDS_PER_LIST))
    .filter(id => {
      if (seen.has(id)) return false;
      seen.add(id);
      return true;
    });

  const items = await Promise.all(
    ids.map(id => fetchJson<HnItem | null>(`${HN_API}/item/${id}.json`).catch(() => null))
  );

  return items
    .map(item => item ? normalizeStory(item) : null)
    .filter((story): story is HnStory => story !== null);
}

