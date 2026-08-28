export const DOUYIN_EMOJI_CATALOG_REQUEST = "danmaku-echo.douyin-emoji-catalog";
export const DOUYIN_EMOJI_CATALOG_ENDPOINT = "https://www.douyin.com/aweme/v1/web/emoji/list/";

export type DouyinEmojiCatalogEntry = readonly [resourceMarker: string, token: string];

export interface DouyinEmojiCatalogRequest {
  type: typeof DOUYIN_EMOJI_CATALOG_REQUEST;
}

export interface DouyinEmojiCatalogResponse {
  entries?: DouyinEmojiCatalogEntry[];
  error?: string;
  ok: boolean;
  version?: string;
}

const BRACKET_EMOJI_PATTERN = /^\[[^\]\r\n]{1,40}\]$/u;
const RESOURCE_DIGEST_PATTERN = /(?:^|[^a-f\d])([a-f\d]{16,64})(?=[^a-f\d]|$)/giu;

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object";
}

function normalizedToken(value: unknown): string {
  const token = String(value ?? "").normalize("NFKC").trim();
  return BRACKET_EMOJI_PATTERN.test(token) ? token : "";
}

/**
 * Extracts the stable parts shared by the catalog URI and signed CDN URLs.
 * Query signatures and expiry timestamps are deliberately excluded.
 */
export function douyinEmojiResourceMarkers(value: unknown): string[] {
  const raw = String(value ?? "").trim();
  if (!raw || raw.length > 4_096) return [];
  const values = [raw];
  let current = raw;
  for (let depth = 0; depth < 3; depth += 1) {
    try {
      const decoded = decodeURIComponent(current);
      if (!decoded || decoded === current) break;
      values.push(decoded);
      current = decoded;
    } catch {
      break;
    }
  }

  const markers = new Set<string>();
  values.forEach((candidate) => {
    const lower = candidate.toLowerCase();
    for (const match of lower.matchAll(RESOURCE_DIGEST_PATTERN)) {
      markers.add(match[1]);
    }
    try {
      const url = new URL(candidate, "https://www.douyin.com/");
      const file = decodeURIComponent(url.pathname).split("/").filter(Boolean).at(-1)?.toLowerCase();
      if (file && /^[a-z\d][a-z\d._-]{1,120}$/u.test(file)) markers.add(file);
    } catch {
      // Internal resource URIs are not always valid URLs.
    }
  });
  return [...markers].slice(0, 12);
}

function catalogList(payload: unknown): unknown[] {
  if (!isRecord(payload)) return [];
  if (Array.isArray(payload.emoji_list)) return payload.emoji_list;
  return isRecord(payload.data) && Array.isArray(payload.data.emoji_list)
    ? payload.data.emoji_list
    : [];
}

export function douyinEmojiCatalogVersion(payload: unknown): string {
  if (!isRecord(payload)) return "";
  const value = payload.version ?? (isRecord(payload.data) ? payload.data.version : "");
  return String(value ?? "").trim().slice(0, 80);
}

export function douyinEmojiCatalogEntries(payload: unknown): DouyinEmojiCatalogEntry[] {
  const entries = new Map<string, string>();
  catalogList(payload).slice(0, 500).forEach((rawEntry) => {
    if (!isRecord(rawEntry)) return;
    const token = normalizedToken(rawEntry.display_name);
    if (!token) return;
    const emojiUrl = isRecord(rawEntry.emoji_url) ? rawEntry.emoji_url : {};
    const resources = [
      rawEntry.origin_uri,
      emojiUrl.uri,
      ...(Array.isArray(emojiUrl.url_list) ? emojiUrl.url_list.slice(0, 8) : []),
    ];
    resources.forEach((resource) => {
      douyinEmojiResourceMarkers(resource).forEach((marker) => entries.set(marker, token));
    });
  });
  return [...entries].slice(0, 2_000);
}

export function isDouyinEmojiCatalogRequest(value: unknown): value is DouyinEmojiCatalogRequest {
  return isRecord(value) && value.type === DOUYIN_EMOJI_CATALOG_REQUEST;
}
