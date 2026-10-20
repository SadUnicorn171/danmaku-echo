import { EMOJI_METADATA_ATTRIBUTES, EMOJI_DISPLAY_ATTRIBUTES } from './editor-config'
import { normalizedAssetKeys as normalizedRichAssetKeys, type RichEmojiAsset } from './rich-message'

export interface RichEmojiMetadataAdapter {
  extraMetadataCandidate?(element: Element): boolean
  stopAtMessageBoundary?(element: Element): boolean
  rejectToken?(text: string): boolean
  imageToken?(image: HTMLImageElement, normalize: (value: unknown, marker: string) => string, marker: (element: Element) => string): string
  assetMetadata?(context: {
    element: Element; metadataElements: Element[]; sources: string[]; displayMetadata: string[]
    normalize: (value: unknown, marker: string) => string; marker: (element: Element) => string
  }): { token?: string; keys: string[] }
}
export interface RichEmojiMetadataOptions {
  adapter?: RichEmojiMetadataAdapter
  normalizeWhitespace(value: unknown): string
  marker(element: Element): string
  isMessageBoundary(element: Element): boolean
  href(): string
}
export function createRichEmojiMetadataReader(options: RichEmojiMetadataOptions) {
  const shared = { normalizeWhitespace: options.normalizeWhitespace }
  const elementMarker = options.marker
  function emojiMetadataElements(element: Element, image: HTMLImageElement | null): Element[] {
    const elements: Element[] = []
    const seen = new Set<Element>()
    const append = (candidate: Element | null) => {
      if (!(candidate instanceof Element) || seen.has(candidate)) return
      seen.add(candidate)
      elements.push(candidate)
    }
    append(image)
    append(element)

    let current = (image || element).parentElement
    for (let depth = 0; current && depth < 12; depth += 1) {
      const currentElement = current
      const marker = elementMarker(currentElement)
      if (
        /(?:emoji|emote|emoticon|emotion|face|sticker|表情)/i.test(marker) ||
        EMOJI_METADATA_ATTRIBUTES.some((attribute) => currentElement.hasAttribute(attribute)) ||
        Boolean(options.adapter?.extraMetadataCandidate?.(currentElement))
      ) {
        append(currentElement)
      }
      if (options.isMessageBoundary(currentElement) && (options.adapter?.stopAtMessageBoundary?.(currentElement) ?? true)) {
        break
      }
      current = currentElement.parentElement
    }
    return elements
  }

  function isGenericEmojiLabel(value: unknown): boolean {
    const normalized = shared.normalizeWhitespace(value).replace(/^\[|\]$/g, '')
    return /^(?:图片|图片表情|表情|表情包|emoji|emote|emoticon|image|sticker)$/i.test(normalized)
  }

  function normalizedEmojiToken(value: unknown, marker: string): string {
    const normalized = shared.normalizeWhitespace(value)
    if (!normalized || isGenericEmojiLabel(normalized)) return ''
    if (options.adapter?.rejectToken?.(normalized)) return ''
    if (/^\[[^\]\n]{1,40}\]$/.test(normalized)) return normalized
    if (/\p{Extended_Pictographic}/u.test(normalized)) return normalized
    if (
      /^(?:data|blob|https?):/i.test(normalized) ||
      /[\\/]/.test(normalized) ||
      Array.from(normalized).length > 40
    ) {
      return ''
    }
    if (
      /(?:emoji|emote|emoticon|emotion|face|sticker|表情)/i.test(marker) &&
      !/^(?:\d{6,}|[a-f\d]{16,})$/i.test(normalized)
    ) {
      return `[${normalized}]`
    }
    return ''
  }

  function emojiTokenFromElement(element: Element): string {
    if (!(element instanceof Element)) return ''
    const image = element instanceof HTMLImageElement ? element : element.querySelector('img')
    const preferred = image ? options.adapter?.imageToken?.(image, normalizedEmojiToken, elementMarker) : ''
    if (preferred) return preferred
    for (const metadataElement of emojiMetadataElements(element, image)) {
      const marker = elementMarker(metadataElement)
      for (const attribute of EMOJI_METADATA_ATTRIBUTES) {
        const raw = shared.normalizeWhitespace(metadataElement.getAttribute(attribute))
        if (
          raw &&
          !EMOJI_DISPLAY_ATTRIBUTES.has(attribute) &&
          !/^\[[^\]\n]{1,40}\]$/.test(raw) &&
          !/\p{Extended_Pictographic}/u.test(raw)
        ) {
          continue
        }
        const token = normalizedEmojiToken(raw, `${marker} ${attribute}`)
        if (token) return token
      }
    }
    return ''
  }

  function emojiTokenFromImage(image: HTMLImageElement): string {
    return emojiTokenFromElement(image)
  }

  function assetDescriptorFromElement(element: Element): RichEmojiAsset | null {
    if (!(element instanceof Element)) {
      return null
    }
    const image = element instanceof HTMLImageElement ? element : element.querySelector('img')
    const metadataElements = emojiMetadataElements(element, image)
    const sources: string[] = []
    const displayMetadata: string[] = []
    const identityMetadata: string[] = []
    metadataElements.forEach((metadataElement) => {
      const sourceValues = [
        metadataElement instanceof HTMLImageElement && metadataElement.currentSrc,
        metadataElement.getAttribute('src'),
        metadataElement.getAttribute('data-src'),
        metadataElement.getAttribute('data-url'),
        metadataElement.getAttribute('data-image'),
        metadataElement.getAttribute('data-image-url'),
      ]
      sourceValues
        .filter((value): value is string => Boolean(value))
        .forEach((value) => sources.push(value))
      EMOJI_METADATA_ATTRIBUTES.forEach((attribute) => {
        const value = metadataElement.getAttribute(attribute)
        if (!value) return
        if (
          EMOJI_DISPLAY_ATTRIBUTES.has(attribute) ||
          /^\[[^\]\n]{1,40}\]$/.test(shared.normalizeWhitespace(value)) ||
          /\p{Extended_Pictographic}/u.test(value)
        ) {
          displayMetadata.push(value)
        } else {
          identityMetadata.push(value)
        }
      })
    })
    const metadata = options.adapter?.assetMetadata?.({ element, metadataElements, sources, displayMetadata, normalize: normalizedEmojiToken, marker: elementMarker })
    const token = metadata?.token || emojiTokenFromElement(element)
    const keys = new Set<string>(metadata?.keys || [])
    sources
      .concat(displayMetadata)
      .concat(token || [])
      .forEach((value) => {
        normalizedRichAssetKeys(value, options.href()).forEach((key) => keys.add(key))
      })
    identityMetadata.forEach((value) => {
      normalizedRichAssetKeys(value, options.href())
        .filter((key) => !key.startsWith('name:'))
        .forEach((key) => keys.add(key))
    })
    if (!keys.size) {
      return null
    }
    return {
      src: String(sources[0] || '').slice(0, 4096),
      token: shared.normalizeWhitespace(token).slice(0, 120),
      keys: Array.from(keys).slice(0, 48),
    }
  }

  return { emojiTokenFromElement, emojiTokenFromImage, normalizedEmojiToken, isGenericEmojiLabel, assetDescriptorFromElement }
}
