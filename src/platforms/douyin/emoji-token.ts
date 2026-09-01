import {
  douyinEmojiResourceMarkers,
  type DouyinEmojiCatalogEntry
} from "./emoji-catalog";

const BRACKET_EMOJI_PATTERN = /^\[[^\]\r\n]{1,40}\]$/u;
const BRACKET_EMOJI_GLOBAL_PATTERN = /\[[^\]\r\n]{1,40}\]/gu;
const GENERIC_EMOJI_LABEL_PATTERN = /^(?:\[)?(?:表情|图片表情|表情包|emoji|emote|emoticon|image|sticker)(?:\])?$/iu;
const RESOURCE_LIKE_PATTERN = /(?:^(?:https?|data|blob):|[\\/]|\.(?:avif|gif|jpe?g|png|svg|webp)(?:$|[?#])|^[a-f\d]{16,64}$)/iu;

const SEMANTIC_KEYS = [
  "alternativeText", "alternative_text",
  "defaultContent", "default_content",
  "displayName", "display_name",
  "emojiName", "emoji_name",
  "showName", "show_name",
  "text", "alt", "title", "label", "name"
] as const;

const MESSAGE_TEXT_KEYS = [
  "defaultContent", "default_content",
  "emojiText", "emoji_text",
  "messageText", "message_text"
] as const;

const NESTED_METADATA_KEYS = [
  "content", "data", "emoji", "emojiContent", "emoji_content",
  "image", "imageContent", "image_content", "metadata", "resource"
] as const;

// Some native/hidden Douyin Emoji arrive at the barrage renderer as an image
// URL only. Keep narrowly scoped resource aliases for those messages so every
// repeated image can still be represented by the text Douyin accepts.
const KNOWN_RESOURCE_TOKENS = [
  ["ed5fb68598cf4741b3e7f2affd825650", "[杀马特]"],
  ["87c2ae45679c4cc4a35bd7182fd76935", "[看]"]
] as const;

const resourceTokens = new Map<string, string>(KNOWN_RESOURCE_TOKENS);

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object";
}

function normalizedText(value: unknown): string {
  return String(value ?? "")
    .normalize("NFKC")
    .replace(/[\u200B\u200C\u2060\uFEFF]/gu, "")
    .replace(/\s+/gu, " ")
    .trim();
}

function decodedValues(value: unknown): string[] {
  const initial = normalizedText(value);
  if (!initial) return [];
  const values = [initial];
  let current = initial;
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
  return values;
}

export function douyinEmojiTokenFromResource(value: unknown): string {
  for (const marker of douyinEmojiResourceMarkers(value)) {
    const token = resourceTokens.get(marker);
    if (token) return token;
  }
  for (const candidate of decodedValues(value)) {
    const normalized = candidate.toLowerCase();
    for (const [resourceMarker, token] of resourceTokens) {
      if (normalized.includes(resourceMarker)) return token;
    }
  }
  return "";
}

export function registerDouyinEmojiCatalog(entries: unknown): number {
  if (!Array.isArray(entries)) return 0;
  let registered = 0;
  entries.slice(0, 2_000).forEach((entry) => {
    if (!Array.isArray(entry) || entry.length < 2) return;
    const marker = String(entry[0] ?? "").trim().toLowerCase();
    const token = normalizedText(entry[1]);
    if (!marker || marker.length > 160 || !BRACKET_EMOJI_PATTERN.test(token)) return;
    resourceTokens.set(marker, token);
    registered += 1;
  });
  return registered;
}

export function registeredDouyinEmojiCatalog(): DouyinEmojiCatalogEntry[] {
  return [...resourceTokens];
}

function semanticEmojiToken(value: unknown): string {
  const text = normalizedText(value);
  if (!text || Array.from(text).length > 40 || GENERIC_EMOJI_LABEL_PATTERN.test(text)) {
    return "";
  }
  if (BRACKET_EMOJI_PATTERN.test(text) || /\p{Extended_Pictographic}/u.test(text)) {
    return text;
  }
  if (
    RESOURCE_LIKE_PATTERN.test(text)
    || text.includes("[")
    || text.includes("]")
    || /[\r\n]/u.test(text)
  ) return "";
  return `[${text}]`;
}

function walkRecords(
  value: unknown,
  visit: (record: Record<string, unknown>) => string,
  depth = 0,
  seen = new Set<object>()
): string {
  if (!isRecord(value) || depth > 4 || seen.has(value)) return "";
  seen.add(value);
  const direct = visit(value);
  if (direct) return direct;
  for (const key of NESTED_METADATA_KEYS) {
    const nested = value[key];
    const candidates = Array.isArray(nested) ? nested.slice(0, 24) : [nested];
    for (const candidate of candidates) {
      const result = walkRecords(candidate, visit, depth + 1, seen);
      if (result) return result;
    }
  }
  return "";
}

export function douyinEmojiTokenFromMetadata(value: unknown): string {
  const resourceToken = walkRecords(value, (record) => {
    for (const candidate of Object.values(record).slice(0, 40)) {
      if (typeof candidate !== "string") continue;
      const token = douyinEmojiTokenFromResource(candidate);
      if (token) return token;
    }
    return "";
  });
  if (resourceToken) return resourceToken;

  return walkRecords(value, (record) => {
    for (const key of SEMANTIC_KEYS) {
      const token = semanticEmojiToken(record[key]);
      if (token) return token;
    }
    return "";
  });
}

function specificBracketMessageText(value: unknown): string {
  const text = normalizedText(value);
  if (!text || Array.from(text).length > 1_000) return "";
  const tokens = text.match(BRACKET_EMOJI_GLOBAL_PATTERN) || [];
  if (!tokens.length || tokens.every((token) => GENERIC_EMOJI_LABEL_PATTERN.test(token))) {
    return "";
  }
  return text;
}

/**
 * Reads the text fallback carried by WebcastEmojiChatMessage. This is kept
 * separate from per-image metadata so one fallback never replaces a sequence
 * containing several image nodes with only one token.
 */
export function douyinEmojiMessageText(value: unknown): string {
  if (!isRecord(value)) return "";
  for (const key of MESSAGE_TEXT_KEYS) {
    const text = specificBracketMessageText(value[key]);
    if (text) return text;
  }
  for (const key of ["emojiMessage", "emoji_message", "message"] as const) {
    const nested = value[key];
    if (!isRecord(nested)) continue;
    for (const textKey of MESSAGE_TEXT_KEYS) {
      const text = specificBracketMessageText(nested[textKey]);
      if (text) return text;
    }
  }
  return "";
}
