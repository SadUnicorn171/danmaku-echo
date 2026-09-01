import type { EmojiAssetDescriptor } from "./rich-data";

export interface RichPayload {
  assets: EmojiAssetDescriptor[];
  parts: Array<{ asset: EmojiAssetDescriptor; type: "emoji" } | { text: string; type: "text" }>;
  plainText: string;
  text: string;
}

type TextParser = (value: unknown) => string;

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object";
}

function sanitizeAsset(value: unknown): EmojiAssetDescriptor | null {
  if (!isRecord(value) || !Array.isArray(value.keys) || !value.keys.length) {
    return null;
  }
  return {
    src: String(value.src || "").slice(0, 4096),
    token: String(value.token || "").slice(0, 120),
    keys: value.keys.map((key) => String(key).slice(0, 520)).slice(0, 64)
  };
}

export function normalizeRichPayload(value: unknown, parseText: TextParser, maxLength: number): RichPayload {
  if (typeof value === "string") {
    const text = parseText(value);
    return { text, plainText: text, assets: [], parts: [{ type: "text", text }] };
  }
  const record = isRecord(value) ? value : {};
  const text = parseText(record.text);
  const plainText = Object.hasOwn(record, "plainText") ? parseText(record.plainText) : text;
  const assets = Array.isArray(record.assets)
    ? record.assets.map(sanitizeAsset).filter((asset): asset is EmojiAssetDescriptor => Boolean(asset)).slice(0, 8)
    : [];
  const parts = Array.isArray(record.parts)
    ? record.parts.slice(0, 40).map((part) => {
      if (!isRecord(part)) return null;
      if (part.type === "emoji") {
        const asset = sanitizeAsset(part.asset);
        return asset ? { type: "emoji" as const, asset } : null;
      }
      return part.type === "text"
        ? { type: "text" as const, text: String(part.text || "").slice(0, maxLength) }
        : null;
    }).filter((part): part is RichPayload["parts"][number] => Boolean(part))
    : [{ type: "text" as const, text: plainText }, ...assets.map((asset) => ({ type: "emoji" as const, asset }))];
  return { text, plainText, assets, parts };
}

export function assetsMatch(first: EmojiAssetDescriptor | null | undefined, second: EmojiAssetDescriptor | null | undefined): boolean {
  return Boolean(first && second && first.keys.some((key) => second.keys.includes(key)));
}

export function allAssetsMatch(
  expected: EmojiAssetDescriptor[] | null | undefined,
  actual: EmojiAssetDescriptor[] | null | undefined
): boolean {
  if (!expected?.length || !actual?.length || expected.length > actual.length) {
    return false;
  }
  const unused = new Set(actual.map((_asset, index) => index));
  return expected.every((item) => {
    const index = actual.findIndex((candidate, candidateIndex) =>
      unused.has(candidateIndex) && assetsMatch(item, candidate));
    if (index < 0) return false;
    unused.delete(index);
    return true;
  });
}

function normalizedOwnText(value: unknown): string {
  return String(value ?? "").normalize("NFKC").replace(/\s+/gu, " ").trim();
}

function textOutsideBracketEmoji(value: string): string {
  return value.replace(/\[[^\]\r\n]{1,40}\]/gu, "").replace(/\s+/gu, "");
}

export function douyinOwnMessageTextMatches(
  expected: unknown,
  observed: unknown,
  observedHasImage: boolean
): boolean {
  const expectedText = normalizedOwnText(expected);
  const observedText = normalizedOwnText(observed);
  if (!expectedText || !observedText) return false;
  if (expectedText === observedText) return true;

  const expectedPlain = textOutsideBracketEmoji(expectedText);
  const observedPlain = textOutsideBracketEmoji(observedText);
  if (expectedPlain && observedPlain && expectedPlain === observedPlain) return true;

  const bracketOnly = !expectedPlain && /\[[^\]\r\n]{1,40}\]/u.test(expectedText);
  return bracketOnly && observedHasImage && observedText === "表情";
}

export function payloadSignature(payload: RichPayload, comparableText: (value: unknown) => string): string {
  const textKey = comparableText(payload.plainText || payload.text);
  const assetKey = payload.assets.map((asset) => asset.keys.slice().sort()[0] || "")
    .filter(Boolean).join("|");
  return `${textKey}::${assetKey}`.slice(0, 1000);
}
