export const LAMBDA: Record<string, number> = {
  hackernews: 0.05,
  default: 0.001,
};

export type EntropyLevel = "low" | "stable" | "high";

export function applyDecay(
  baseScore: number,
  publishedAt: string | null,
  adapter: string
): { rt: number; entropy: EntropyLevel; is_expired: boolean } {
  if (baseScore <= 0) return { rt: 0, entropy: "high", is_expired: true };

  const lambda = LAMBDA[adapter] ?? LAMBDA.default;
  const halfLifeHours = Math.log(2) / lambda;
  let ageHours = halfLifeHours;

  if (publishedAt) {
    const published = new Date(publishedAt).getTime();
    if (!Number.isNaN(published)) {
      ageHours = Math.max(0, (Date.now() - published) / (1000 * 60 * 60));
    }
  }

  const rt = baseScore * Math.exp(-lambda * ageHours);
  const roundedRt = Math.round(rt * 10) / 10;
  const entropyRatio = ageHours / halfLifeHours;
  const entropy: EntropyLevel =
    entropyRatio < 0.5 ? "low" :
    entropyRatio < 1.5 ? "stable" :
    "high";

  return {
    rt: roundedRt,
    entropy,
    is_expired: roundedRt < 0.01,
  };
}

export async function semanticFingerprint(raw: string): Promise<string> {
  const urlMatch = raw.match(/https?:\/\/[^\s"'<>]{8,}/);
  let url = "";

  if (urlMatch) {
    try {
      const parsed = new URL(urlMatch[0]);
      const tracking = /^(utm_|fbclid$|gclid$|mc_|igshid$)/i;
      for (const key of Array.from(parsed.searchParams.keys())) {
        if (tracking.test(key)) parsed.searchParams.delete(key);
      }
      parsed.hash = "";
      url = `${parsed.origin}${parsed.pathname}${parsed.search}`.toLowerCase();
    } catch {
      url = urlMatch[0].split(/[?#]/)[0].toLowerCase();
    }
  }

  const date = raw.match(/\b(202[0-9]|203[0-9])-\d{2}-\d{2}\b/)?.[0] ?? "";
  const title = raw
    .split("\n")
    .map(line => line.trim())
    .filter(line => line.length > 10 && !line.startsWith("http"))[0] ?? "";
  const normalizedTitle = title
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 80);

  const input = `${normalizedTitle}|${url}|${date}`;
  const encoded = new TextEncoder().encode(input);
  const hashBuffer = await crypto.subtle.digest("SHA-256", encoded);
  return Array.from(new Uint8Array(hashBuffer))
    .map(byte => byte.toString(16).padStart(2, "0"))
    .join("")
    .slice(0, 16);
}

