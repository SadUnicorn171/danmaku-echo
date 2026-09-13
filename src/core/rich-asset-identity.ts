const OPAQUE_RICH_ASSET_IDENTITY =
  /^(?:official|room|anchor|up|live|emoji|emote|emoticon|face|sticker|pack|package|group|custom)(?:[_:-][a-z\d]+)+$/i

/** Returns true for a platform resource identity that is not a user-facing asset name. */
export function isOpaqueRichAssetIdentity(value: unknown): boolean {
  const normalized = String(value == null ? '' : value)
    .normalize('NFKC')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/^\[|\]$/g, '')
  return Boolean(normalized && OPAQUE_RICH_ASSET_IDENTITY.test(normalized))
}
