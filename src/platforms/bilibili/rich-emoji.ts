import {
  richEmojiAssetCacheKey,
  type RichEmojiAsset,
  type RichMessagePayload,
} from '../live/rich-message'
import {
  BILIBILI_AUTO_TEXT_ASSET_KEY_PREFIX,
  BILIBILI_NATIVE_PANEL_IDENTITY_ATTRIBUTES,
  NATIVE_PANEL_ASSET_KEY_PREFIX,
} from '../live/editor-config'
import {
  bilibiliNativeEmoticonDisplayToken,
  isBilibiliDecorativeImageDescription,
} from './emoticon-metadata'

export interface BilibiliRichAssetMetadata {
  keys: string[]
  token: string
}

export function bilibiliRichAssetMetadata(options: {
  displayMetadata: readonly unknown[]
  metadataElements: readonly Element[]
  sources: readonly string[]
}): BilibiliRichAssetMetadata {
  const { displayMetadata, metadataElements, sources } = options
  const identityRows = metadataElements.filter(
    (element) =>
      element.getAttribute('data-type') === '1' ||
      BILIBILI_NATIVE_PANEL_IDENTITY_ATTRIBUTES.some((attribute) =>
        element.hasAttribute(attribute),
      ),
  )
  const token = bilibiliNativeEmoticonDisplayToken([
    ...displayMetadata,
    ...identityRows.map((element) => element.getAttribute('data-danmaku')),
  ])
  const keys = new Set<string>()
  let nativePanelIdentity = ''
  let isNativePanelAsset = false

  metadataElements.forEach((element) => {
    const standardEmoticonId = String(element.getAttribute('data-emoticon-id') || '').trim()
    if (standardEmoticonId) {
      keys.add(
        `${BILIBILI_AUTO_TEXT_ASSET_KEY_PREFIX}${standardEmoticonId.toLowerCase().slice(0, 180)}`,
      )
    }
    if (element.getAttribute('data-type') === '1') isNativePanelAsset = true
    BILIBILI_NATIVE_PANEL_IDENTITY_ATTRIBUTES.forEach((attribute) => {
      const value = String(element.getAttribute(attribute) || '').trim()
      if (!value) return
      isNativePanelAsset = true
      if (!nativePanelIdentity) nativePanelIdentity = value
    })
  })

  if (isNativePanelAsset) {
    keys.add(
      `${NATIVE_PANEL_ASSET_KEY_PREFIX}${String(nativePanelIdentity || sources[0] || 'type-1')
        .trim()
        .toLowerCase()
        .slice(0, 220)}`,
    )
  }
  return { keys: [...keys], token }
}

export interface BilibiliEmojiRecovery {
  clear(): void
  complete(payload: RichMessagePayload | null): void
  findDescriptor(asset: RichEmojiAsset): RichEmojiAsset | null
}

export interface BilibiliEmojiRecoveryOptions {
  assetDescriptor(element: Element): RichEmojiAsset | null
  assetMatchScore(element: Element, asset: RichEmojiAsset): number
  isAdvertisement(row: Element): boolean
  isOwned(row: Element): boolean
  listMessageImages(row: Element, messageElement: Element): readonly Element[]
  listRows(): readonly Element[]
  merge(target: RichEmojiAsset, source: RichEmojiAsset): void
  messageElement(row: Element): Element | null
  now?: () => number
  ttlMs?: number
}

function isNativeEmoticonRow(row: Element): boolean {
  return (
    row.getAttribute('data-type') === '1' ||
    BILIBILI_NATIVE_PANEL_IDENTITY_ATTRIBUTES.some((attribute) => row.hasAttribute(attribute))
  )
}

export function createBilibiliEmojiRecovery(
  options: BilibiliEmojiRecoveryOptions,
): BilibiliEmojiRecovery {
  const cache = new Map<string, { expiresAt: number; value: RichEmojiAsset | null }>()
  const now = options.now ?? Date.now
  const ttlMs = Math.max(0, options.ttlMs ?? 2_000)

  const findDescriptor = (asset: RichEmojiAsset): RichEmojiAsset | null => {
    const cacheKey = richEmojiAssetCacheKey(asset)
    const cached = cache.get(cacheKey)
    if (cached) {
      if (cached.expiresAt > now()) return cached.value
      cache.delete(cacheKey)
    }

    const rows = options.listRows()
    let result: RichEmojiAsset | null = null
    for (let rowIndex = rows.length - 1; rowIndex >= 0; rowIndex -= 1) {
      const row = rows[rowIndex]
      if (options.isOwned(row) || options.isAdvertisement(row) || !isNativeEmoticonRow(row)) {
        continue
      }
      const messageElement = options.messageElement(row)
      if (!messageElement) continue
      for (const image of options.listMessageImages(row, messageElement)) {
        const descriptor = options.assetDescriptor(image)
        if (!descriptor?.token) continue
        if (options.assetMatchScore(image, asset) >= 4) {
          result = descriptor
          break
        }
      }
      if (result) break
    }

    cache.set(cacheKey, { expiresAt: now() + ttlMs, value: result })
    return result
  }

  return {
    clear() {
      cache.clear()
    },
    complete(payload) {
      completeBilibiliEmojiTokens(payload, { findDescriptor, merge: options.merge })
    },
    findDescriptor,
  }
}

export function completeBilibiliEmojiTokens(
  payload: RichMessagePayload | null,
  options: {
    findDescriptor(asset: RichEmojiAsset): RichEmojiAsset | null
    merge(target: RichEmojiAsset, source: RichEmojiAsset): void
  },
): void {
  if (!payload) return
  const prepare = (asset: RichEmojiAsset | null | undefined): asset is RichEmojiAsset => {
    if (!asset) return false
    if (isBilibiliDecorativeImageDescription(asset.token)) asset.token = ''
    asset.keys = asset.keys.filter((key) => {
      const match = /^(?:name|raw):(.*)$/iu.exec(String(key || ''))
      return !match || !isBilibiliDecorativeImageDescription(match[1])
    })
    return !asset.token
  }
  const assets = new Set([
    ...payload.assets,
    ...payload.parts.flatMap((part) => (part.type === 'emoji' ? [part.asset] : [])),
  ])
  assets.forEach((asset) => {
    if (!prepare(asset)) return
    const descriptor = options.findDescriptor(asset)
    if (descriptor) options.merge(asset, descriptor)
  })
}
