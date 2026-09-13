import { normalizeWhitespace, parseMessageText } from '../../core/shared'
import { matchesAny } from './deep-dom'

export interface RichEmojiAsset {
  keys: string[]
  resourceId?: string
  src: string
  token: string
}

export function richEmojiAssetCacheKey(asset: Pick<RichEmojiAsset, 'keys'>): string {
  return Array.from(asset.keys).slice(0, 8).sort().join('|')
}

export type RichMessagePart =
  { text: string; type: 'text' } | { asset: RichEmojiAsset; type: 'emoji' }

export interface RichMessagePayload {
  assets: RichEmojiAsset[]
  parts: RichMessagePart[]
  plainText: string
  text: string
}

function decodedIdentityValues(value: string): string[] {
  const values = [value]
  let current = value
  for (let depth = 0; depth < 3; depth += 1) {
    try {
      const decoded = decodeURIComponent(current)
      if (!decoded || decoded === current) break
      values.push(decoded)
      current = decoded
    } catch {
      break
    }
  }
  return values
}

export function normalizedAssetKeys(value: unknown, baseUrl: string): string[] {
  const raw = normalizeWhitespace(value)
  if (!raw) return []
  const keys = new Set([`raw:${raw.toLocaleLowerCase().slice(0, 512)}`])
  const unwrapped = raw
    .replace(/^\[|\]$/gu, '')
    .trim()
    .toLocaleLowerCase()
  if (unwrapped) keys.add(`name:${unwrapped.slice(0, 120)}`)
  decodedIdentityValues(raw).forEach((candidate) => {
    for (const match of candidate
      .toLocaleLowerCase()
      .matchAll(/(?:^|[^a-f\d])([a-f\d]{16,64})(?=[^a-f\d]|$)/gu)) {
      keys.add(`digest:${match[1]}`)
    }
  })
  try {
    const url = new URL(raw, baseUrl)
    const pathname = decodeURIComponent(url.pathname).toLocaleLowerCase()
    if (pathname) {
      keys.add(`path:${pathname}`)
      const file = pathname.split('/').filter(Boolean).at(-1)
      if (file) {
        keys.add(`file:${file}`)
        keys.add(`stem:${file.split(/[@~!]/u, 1)[0]}`)
        const fileStem = file.replace(/\.[a-z\d]{2,8}$/iu, '')
        const stableBundleSlug = fileStem.replace(/[_-][a-f\d]{6,12}$/iu, '')
        if (stableBundleSlug && stableBundleSlug !== fileStem && stableBundleSlug.length >= 3) {
          keys.add(`slug:${stableBundleSlug.slice(0, 120)}`)
        }
      }
      const fragments = pathname.match(/[a-z\d][a-z\d_-]{9,}/gu) || []
      fragments.slice(-12).forEach((fragment) => {
        if (!/^(?:webcast|douyin|douyinpic|byteimg|tos-cn|webcast-platform)/u.test(fragment)) {
          keys.add(`fragment:${fragment.slice(0, 240)}`)
        }
      })
    }
    url.searchParams.forEach((parameter, name) => {
      if (/(?:sign|signature|expire|timestamp|token|auth)/iu.test(name)) return
      const fragments =
        decodeURIComponent(parameter)
          .toLocaleLowerCase()
          .match(/[a-z\d][a-z\d_-]{9,}/gu) || []
      fragments.slice(0, 8).forEach((fragment) => keys.add(`fragment:${fragment.slice(0, 240)}`))
    })
  } catch {
    // Internal resource IDs and Emoji names are not necessarily URLs.
  }
  return [...keys]
}

export function richPartsFromElement(options: {
  assetFromImage(image: HTMLImageElement): RichEmojiAsset | null
  element: Element
  maximumParts?: number
  removals?: readonly string[]
}): RichMessagePart[] {
  const parts: RichMessagePart[] = []
  const maximumParts = options.maximumParts ?? 40
  const appendText = (value: unknown): void => {
    const text = String(value ?? '')
    if (!text) return
    const previous = parts.at(-1)
    if (previous?.type === 'text') previous.text += text
    else parts.push({ text, type: 'text' })
  }
  const visit = (node: Node): void => {
    if (parts.length >= maximumParts) return
    if (node.nodeType === Node.TEXT_NODE) {
      appendText(node.textContent)
      return
    }
    if (!(node instanceof Element) || matchesAny(node, options.removals ?? [])) return
    if (node instanceof HTMLImageElement) {
      const asset = options.assetFromImage(node)
      if (asset) parts.push({ asset, type: 'emoji' })
      return
    }
    if (node.tagName === 'BR') {
      appendText(' ')
      return
    }
    node.childNodes.forEach(visit)
  }
  options.element.childNodes.forEach(visit)
  return parts
}

export function richMessagePayload(
  parts: RichMessagePart[],
  maxLength = 1_000,
): RichMessagePayload {
  const assets = parts.flatMap((part) => (part.type === 'emoji' ? [part.asset] : [])).slice(0, 8)
  const plainText = parseMessageText(
    parts.flatMap((part) => (part.type === 'text' ? [part.text] : [])).join(''),
    maxLength,
  )
  const text = parseMessageText(
    parts.map((part) => (part.type === 'text' ? part.text : part.asset.token)).join(''),
    maxLength,
  )
  return { assets, parts, plainText, text }
}
