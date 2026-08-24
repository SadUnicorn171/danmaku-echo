interface BoxEdges {
  bottom: number;
  left: number;
  right: number;
  top: number;
}

interface PaintGradient {
  gradientPieces: Array<[number, string]>;
  type: "linear" | "radial";
}

export type SafePaint = PaintGradient | string;

export interface SerializedBarrageItem {
  assetHints?: string[];
  backgroundColor?: SafePaint;
  borderColor?: SafePaint;
  borderRadius?: number;
  borderRadiusRatio?: number;
  borderWidth?: number;
  color?: SafePaint;
  content?: SerializedBarrageItem[];
  fontFamily?: string;
  fontSize?: number;
  fontWeight?: string;
  height?: number;
  isInline?: boolean;
  margin?: number | number[];
  opacity?: number;
  padding?: number | number[];
  emojiToken?: string;
  src?: string;
  strokeColor?: SafePaint;
  strokeWidth?: number;
  text?: string;
  type: "block" | "image" | "text";
  width?: number;
}

interface SerializationBudget {
  remaining: number;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object";
}

export function numberOr(value: unknown, fallback: number): number {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : fallback;
}

export function normalizeText(value: unknown): string {
  return String(value == null ? "" : value)
    .replace(/[\u200B\u200C\u2060\uFEFF]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

export function plausibleText(value: unknown): boolean {
  const text = normalizeText(value);
  const length = Array.from(text).length;
  return length > 0
    && length <= 1000
    && !/^(高清|超清|蓝光|原画|自动|流畅|发送|设置|退出全屏|直播已结束)$/.test(text);
}

export function barrageInteractionText(value: unknown, imageCount: unknown): string {
  const text = normalizeText(value);
  if (plausibleText(text)) {
    return text;
  }
  return numberOr(imageCount, 0) > 0 ? "表情" : "";
}

export function boxEdges(value: unknown): BoxEdges {
  if (Array.isArray(value)) {
    const top = numberOr(value[0], 0);
    const right = numberOr(value[1], top);
    const bottom = numberOr(value[2], top);
    const left = numberOr(value[3], right);
    return { top, right, bottom, left };
  }
  const edge = numberOr(value, 0);
  return { top: edge, right: edge, bottom: edge, left: edge };
}

function safePaint(value: unknown): SafePaint | "" {
  if (typeof value === "string") {
    return value.slice(0, 200);
  }
  if (!isRecord(value) || !Array.isArray(value.gradientPieces)) {
    return "";
  }
  return {
    type: value.type === "radial" ? "radial" : "linear",
    gradientPieces: value.gradientPieces.slice(0, 12)
      .filter((piece): piece is unknown[] => Array.isArray(piece) && piece.length >= 2)
      .map((piece) => [numberOr(piece[0], 0), String(piece[1]).slice(0, 100)])
  };
}

function safeBox(value: unknown): number | number[] {
  if (Array.isArray(value)) {
    return value.slice(0, 4).map((edge) => numberOr(edge, 0));
  }
  return numberOr(value, 0);
}

function imageAssetHints(value: Record<string, unknown>): string[] {
  const keys = [
    "id", "key", "name", "text", "alt", "title", "uri", "url",
    "emojiId", "emoji_id", "emojiName", "emoji_name",
    "resourceId", "resource_id", "webUri", "web_uri"
  ];
  const hints = new Set<string>();
  const add = (raw: unknown): void => {
    if (typeof raw !== "string" && typeof raw !== "number") return;
    const hint = String(raw).trim();
    if (hint && hint.length <= 4096) hints.add(hint);
  };
  keys.forEach((key) => add(value[key]));
  ["image", "emoji", "resource"].forEach((key) => {
    const nested = value[key];
    if (!isRecord(nested)) return;
    keys.forEach((nestedKey) => add(nested[nestedKey]));
  });
  return [...hints].slice(0, 20);
}

function nativeEmojiToken(value: Record<string, unknown>): string {
  const semanticKeys = [
    "emojiName", "emoji_name", "text", "alt", "title", "name"
  ];
  const candidates: unknown[] = [];
  semanticKeys.forEach((key) => candidates.push(value[key]));
  ["emoji", "image", "resource"].forEach((key) => {
    const nested = value[key];
    if (!isRecord(nested)) return;
    semanticKeys.forEach((nestedKey) => candidates.push(nested[nestedKey]));
  });
  for (const candidate of candidates) {
    const text = normalizeText(candidate);
    if (!text || Array.from(text).length > 40 || /[\\/\r\n]/u.test(text)
        || /^(?:https?|data|blob):/iu.test(text)) {
      continue;
    }
    if (/^\[[^\]\r\n]{1,40}\]$/u.test(text) || /\p{Extended_Pictographic}/u.test(text)) {
      return text;
    }
    return `[${text}]`;
  }
  return "";
}

export function serializedBarrageText(content: unknown): string {
  let text = "";
  const visit = (item: unknown): void => {
    if (!isRecord(item) || Array.from(text).length >= 1000) return;
    if (item.type === "text") {
      text += String(item.text == null ? "" : item.text);
    } else if (item.type === "image") {
      text += typeof item.emojiToken === "string" ? item.emojiToken : "";
    }
    if (Array.isArray(item.content)) item.content.forEach(visit);
  };
  (Array.isArray(content) ? content : []).forEach(visit);
  return normalizeText(text).slice(0, 1000);
}

export function rendererPaint(value: unknown, background: boolean): string {
  if (typeof value === "string") {
    return value.slice(0, 200);
  }
  if (!isRecord(value) || !Array.isArray(value.gradientPieces)) {
    return "";
  }
  const pieces = value.gradientPieces
    .filter((piece): piece is unknown[] => Array.isArray(piece) && piece.length >= 2)
    .slice(0, 12);
  if (!pieces.length) {
    return "";
  }
  if (!background) {
    return String(pieces[0][1]).slice(0, 100);
  }
  const stops = pieces.map((piece) => {
    const offset = Math.max(0, Math.min(1, numberOr(piece[0], 0))) * 100;
    return `${String(piece[1]).slice(0, 100)} ${offset}%`;
  });
  const prefix = value.type === "radial" ? "radial-gradient(circle" : "linear-gradient(90deg";
  return `${prefix}, ${stops.join(", ")})`;
}

export function rendererBox(value: unknown): string {
  const edges = boxEdges(value);
  return [edges.top, edges.right, edges.bottom, edges.left]
    .map((edge) => `${Math.max(-100, Math.min(200, numberOr(edge, 0)))}px`)
    .join(" ");
}

export function serializeContent(
  value: unknown,
  depth: number,
  budget: SerializationBudget
): SerializedBarrageItem | null {
  if (!isRecord(value) || depth > 5 || budget.remaining <= 0) {
    return null;
  }
  budget.remaining -= 1;
  const type = value.type === "text" || value.type === "image" || value.type === "block"
    ? value.type
    : "block";
  const result: SerializedBarrageItem = { type };
  if (type === "text") {
    result.text = String(value.text == null ? "" : value.text).slice(0, 1000);
  } else if (type === "image" && typeof value.src === "string") {
    result.src = value.src.slice(0, 4096);
    const emojiToken = nativeEmojiToken(value);
    if (emojiToken) result.emojiToken = emojiToken;
    const hints = imageAssetHints(value);
    if (hints.length) result.assetHints = hints;
  }
  ["width", "height", "fontSize", "strokeWidth", "borderWidth", "borderRadius", "borderRadiusRatio", "opacity"]
    .forEach((key) => {
      if (Number.isFinite(Number(value[key]))) {
        result[key as keyof SerializedBarrageItem] = Number(value[key]) as never;
      }
    });
  ["fontFamily", "fontWeight"].forEach((key) => {
    if (typeof value[key] === "string" || typeof value[key] === "number") {
      result[key as "fontFamily" | "fontWeight"] = String(value[key]).slice(0, 100);
    }
  });
  ["color", "strokeColor", "backgroundColor", "borderColor"].forEach((key) => {
    const paint = safePaint(value[key]);
    if (paint) {
      result[key as "backgroundColor" | "borderColor" | "color" | "strokeColor"] = paint;
    }
  });
  if (value.margin != null) {
    result.margin = safeBox(value.margin);
  }
  if (value.padding != null) {
    result.padding = safeBox(value.padding);
  }
  if (value.isInline != null) {
    result.isInline = Boolean(value.isInline);
  }
  if (Array.isArray(value.content)) {
    result.content = value.content
      .map((child) => serializeContent(child, depth + 1, budget))
      .filter((child): child is SerializedBarrageItem => Boolean(child));
  }
  return result;
}

export function serializeBarrage(options: unknown): SerializedBarrageItem[] {
  const budget: SerializationBudget = { remaining: 80 };
  const content = isRecord(options) && Array.isArray(options.content) ? options.content : [];
  return content
    .map((item) => serializeContent(item, 0, budget))
    .filter((item): item is SerializedBarrageItem => Boolean(item));
}
