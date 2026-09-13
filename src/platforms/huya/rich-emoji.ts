import {
  richEmojiAssetCacheKey,
  type RichEmojiAsset,
  type RichMessagePayload,
} from '../live/rich-message'

export function huyaEmojiPanelToken(
  element: Element,
  normalizeToken: (value: unknown, marker: string) => string,
): string {
  const item = element.matches("[class*='emot--']") ? element : element.closest("[class*='emot--']")
  if (!item) return ''
  const values = [
    item.querySelector("img[class*='emot-icon--'][alt]")?.getAttribute('alt'),
    item.querySelector("[class*='emot-preview--'] span")?.textContent,
    item.querySelector("[class*='emot-preview--'] img[alt]")?.getAttribute('alt'),
  ]
  for (const value of values) {
    const token = normalizeToken(value, 'huya emoticon')
    if (token) return token
  }
  return ''
}

export function huyaRichAssetKeys(
  metadataElements: readonly Element[],
  sources: readonly string[],
  markerFor: (element: Element) => string,
): string[] {
  const keys = new Set<string>()
  metadataElements.forEach((metadataElement) => {
    const marker = markerFor(metadataElement)
    const id = String(metadataElement.getAttribute('data-id') || '').trim()
    if (id && /(?:^|\s)emot(?:--|-icon--|-preview--)/i.test(marker)) {
      keys.add(`huya-emoticon-id:${id.toLowerCase().slice(0, 120)}`)
    }
  })
  sources.forEach((source) => {
    const matches = String(source).matchAll(
      /(?:web_base_material_|material[_/-])([0-9]{8,})(?:_pic)?/gi,
    )
    for (const match of matches) keys.add(`huya-material:${match[1]}`)
  })
  return [...keys]
}

export interface HuyaEmojiRecovery {
  clear(): void
  complete(payload: RichMessagePayload | null): void
  findDescriptor(asset: RichEmojiAsset): RichEmojiAsset | null
}

export interface HuyaEmojiRecoveryOptions {
  assetDescriptor(element: Element): RichEmojiAsset | null
  assetMatchScore(element: Element, asset: RichEmojiAsset): number
  isGenericLabel(value: string): boolean
  isOwned(row: Element): boolean
  listMessageImages(row: Element, messageElement: Element): readonly Element[]
  listRows(): readonly Element[]
  merge(target: RichEmojiAsset, source: RichEmojiAsset): void
  messageElement(row: Element): Element | null
  now?: () => number
  refresh(payload: RichMessagePayload): void
  tokenQuality(token: string): number
  ttlMs?: number
}

export function createHuyaEmojiRecovery(options: HuyaEmojiRecoveryOptions): HuyaEmojiRecovery {
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

    let result: RichEmojiAsset | null = null
    const rows = options.listRows().slice(-100)
    for (const row of rows) {
      if (options.isOwned(row)) continue
      const messageElement = options.messageElement(row)
      if (!messageElement) continue
      for (const image of options.listMessageImages(row, messageElement)) {
        const descriptor = options.assetDescriptor(image)
        if (!descriptor?.token || options.isGenericLabel(descriptor.token)) continue
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
      completeHuyaEmojiTokens(payload, {
        findDescriptor,
        merge: options.merge,
        refresh: options.refresh,
        tokenQuality: options.tokenQuality,
      })
    },
    findDescriptor,
  }
}

export function completeHuyaEmojiTokens(
  payload: RichMessagePayload | null,
  options: {
    findDescriptor(asset: RichEmojiAsset): RichEmojiAsset | null
    merge(target: RichEmojiAsset, source: RichEmojiAsset): void
    refresh(payload: RichMessagePayload): void
    tokenQuality(token: string): number
  },
): void {
  if (!payload) return
  const assets = new Set([
    ...payload.assets,
    ...payload.parts.flatMap((part) => (part.type === 'emoji' ? [part.asset] : [])),
  ])
  assets.forEach((asset) => {
    if (options.tokenQuality(asset.token) >= 3) return
    const descriptor = options.findDescriptor(asset)
    if (descriptor) options.merge(asset, descriptor)
  })
  options.refresh(payload)
}
