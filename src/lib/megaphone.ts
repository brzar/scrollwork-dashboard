import "server-only";

/**
 * Megaphone CMS API client — content management only (podcasts, episodes).
 *
 * Analytics endpoints (downloads, streams, revenue) are NOT exposed by
 * the public CMS API; we use the reverse-engineered `/api/v2/private`
 * endpoints via `megaphone-web.ts` for those. See README → "Megaphone
 * limitations" for the full story.
 */

const DEFAULT_BASE = "https://cms.megaphone.fm/api";

function token(): string {
  const t = process.env.MEGAPHONE_API_TOKEN;
  if (!t) {
    throw new Error(
      "MEGAPHONE_API_TOKEN is not set. Add it to your server env (never client).",
    );
  }
  return t;
}

function networkId(): string {
  const n = process.env.MEGAPHONE_NETWORK_ID;
  if (!n) throw new Error("MEGAPHONE_NETWORK_ID is not set.");
  return n;
}

function baseUrl(): string {
  return process.env.MEGAPHONE_API_BASE || DEFAULT_BASE;
}

// ---- Low-level fetch -----------------------------------------------------

export class MegaphoneError extends Error {
  status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

async function callCms<T>(
  path: string,
  query?: Record<string, string | number | undefined>,
  retries = 2,
): Promise<T> {
  const url = new URL(baseUrl() + path);
  if (query) {
    for (const [k, v] of Object.entries(query)) {
      if (v !== undefined && v !== null && v !== "") url.searchParams.set(k, String(v));
    }
  }

  let attempt = 0;
  while (true) {
    const res = await fetch(url.toString(), {
      headers: {
        Authorization: `Token token="${token()}"`,
        Accept: "application/json",
      },
      cache: "no-store",
    });
    if (res.ok) return (await res.json()) as T;
    if ((res.status === 429 || res.status >= 500) && attempt < retries) {
      const retryAfter = Number(res.headers.get("retry-after")) || 0;
      await new Promise((r) => setTimeout(r, retryAfter > 0 ? retryAfter * 1000 : 250 * 2 ** attempt));
      attempt += 1;
      continue;
    }
    throw new MegaphoneError(res.status, `Megaphone ${res.status}`);
  }
}

// ---- Types ---------------------------------------------------------------

export type MegaphonePodcast = {
  id: string;
  title: string;
  subtitle?: string | null;
  author?: string | null;
  imageFile?: string | null;
  episodesCount?: number | null;
};

export type MegaphoneEpisode = {
  id: string;
  podcastId: string;
  title: string;
  pubdate?: string | null;
  duration?: number | null;
  episodeNumber?: number | null;
  seasonNumber?: number | null;
};

// ---- Reads ---------------------------------------------------------------

export async function listPodcasts(): Promise<MegaphonePodcast[]> {
  const raw = await callCms<any[]>(`/networks/${networkId()}/podcasts`, {
    per_page: 200,
  });
  return raw.map(normalizePodcast);
}

export async function listEpisodes(
  podcastMegaphoneId: string,
  opts: { perPage?: number; page?: number } = {},
): Promise<MegaphoneEpisode[]> {
  const raw = await callCms<any[]>(
    `/networks/${networkId()}/podcasts/${podcastMegaphoneId}/episodes`,
    { per_page: opts.perPage ?? 50, page: opts.page ?? 1 },
  );
  return raw.map((e) => normalizeEpisode(e, podcastMegaphoneId));
}

function normalizePodcast(raw: any): MegaphonePodcast {
  return {
    id: String(raw.id ?? raw.uid ?? ""),
    title: raw.title ?? "Untitled",
    subtitle: raw.subtitle ?? null,
    author: raw.author ?? null,
    imageFile: raw.imageFile ?? raw.image_file ?? null,
    episodesCount: raw.episodesCount ?? raw.episodes_count ?? null,
  };
}

function normalizeEpisode(raw: any, podcastId: string): MegaphoneEpisode {
  return {
    id: String(raw.id ?? raw.uid ?? ""),
    podcastId,
    title: raw.title ?? "Untitled",
    pubdate: raw.pubdate ?? raw.pub_date ?? null,
    duration: raw.duration ?? null,
    episodeNumber: raw.episodeNumber ?? raw.episode_number ?? null,
    seasonNumber: raw.seasonNumber ?? raw.season_number ?? null,
  };
}
