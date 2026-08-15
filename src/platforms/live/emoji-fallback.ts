export interface EmojiAssetLike {
  keys?: unknown;
  token?: unknown;
}

export interface RichPartLike {
  asset?: unknown;
  text?: unknown;
  type?: unknown;
}

export interface RichPayloadLike {
  assets?: unknown;
  parts?: unknown;
  text?: unknown;
}

function containsUnicodeEmoji(value: string): boolean {
  return /(?:\p{Extended_Pictographic}|\p{Regional_Indicator}{2}|[#*0-9]\uFE0F?\u20E3)/u.test(value);
}

/**
 * Platform image Emoji sometimes expose their exact Unicode equivalent in
 * alt/data attributes. In that case text insertion is both lossless and more
 * reliable than reopening a virtualized Emoji panel. Bracketed platform names
 * are deliberately excluded because sending "[表情名]" is not equivalent to
 * sending the original platform resource.
 */
export function unicodeEmojiFallbackText(payload: RichPayloadLike | null | undefined): string {
  if (!payload || !Array.isArray(payload.assets) || !payload.assets.length) {
    return "";
  }
  const tokens = payload.assets.map((asset) => {
    if (!asset || typeof asset !== "object") return "";
    return String((asset as EmojiAssetLike).token || "").trim();
  });
  if (tokens.some((token) => !token
      || /^\[[^\]\n]{1,80}\]$/.test(token)
      || !containsUnicodeEmoji(token))) {
    return "";
  }
  const text = String(payload.text || "").trim();
  return containsUnicodeEmoji(text) ? text : "";
}

/**
 * Rebuild a mixed text/bracket-Emoji message from its ordered DOM parts.
 * Whether bracket tokens can be submitted as text is platform-specific, so
 * callers must opt into this fallback only when the native editor supports it.
 */
export function orderedBracketEmojiText(payload: RichPayloadLike | null | undefined): string {
  if (!payload || !Array.isArray(payload.assets) || !payload.assets.length
      || !Array.isArray(payload.parts) || !payload.parts.length) {
    return "";
  }

  const assetTokens = payload.assets.map((asset) => {
    if (!asset || typeof asset !== "object") return "";
    return String((asset as EmojiAssetLike).token || "").trim();
  });
  if (assetTokens.some((token) => !/^\[[^\]\n]{1,80}\]$/.test(token))) {
    return "";
  }

  let emojiCount = 0;
  const ordered = (payload.parts as RichPartLike[]).map((part) => {
    if (!part || typeof part !== "object") return null;
    if (part.type === "text") return String(part.text || "");
    if (part.type !== "emoji" || !part.asset || typeof part.asset !== "object") return null;
    const token = String((part.asset as EmojiAssetLike).token || "").trim();
    if (!/^\[[^\]\n]{1,80}\]$/.test(token)) return null;
    emojiCount += 1;
    return token;
  });
  if (ordered.some((part) => part === null) || emojiCount !== payload.assets.length) {
    return "";
  }
  return ordered.join("").replace(/\s+/g, " ").trim();
}
