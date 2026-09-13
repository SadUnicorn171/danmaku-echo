import {
  boxEdges,
  normalizeText,
  numberOr,
  serializeBarrage,
  type SafePaint,
  type SerializedBarrageItem,
} from '../barrage-model'
import type {
  CssPixels,
  RendererBarrageOptions,
  RendererConfig,
  RendererTextStyle,
} from './runtime-types'

const DEFAULT_TEXT_CACHE_LIMIT = 512
const DEFAULT_FONT_SIZE = 20

interface MeasurementContext {
  font: string
  measureText(text: string): Pick<TextMetrics, 'width'>
}

interface ContentMeasurement {
  firstText: RendererTextStyle | null
  height: CssPixels
  imageCount: number
  text: string
  width: CssPixels
}

type ContentRecord = Record<string, unknown>

export type MeasuredBarrageContent = ContentMeasurement

export interface DouyinContentMeasurerDiagnostics {
  cacheEvictions: number
  cacheHits: number
  cacheInvalidations: number
  cacheMisses: number
  cachedTextMeasurements: number
  contextAvailable: boolean
}

export interface DouyinContentMeasurerOptions {
  createContext?: () => MeasurementContext | null
  fontAvailability?: (font: string, text: string) => string | boolean
  maxTextCacheEntries?: number
}

export interface DouyinContentMeasurer {
  diagnostics(): DouyinContentMeasurerDiagnostics
  invalidate(): void
  measure(
    options: RendererBarrageOptions,
    config: Pick<RendererConfig, 'fontSize'>,
    content?: readonly SerializedBarrageItem[],
    imageRatios?: ReadonlyMap<string, number> | null,
  ): MeasuredBarrageContent
}

function isRecord(value: unknown): value is ContentRecord {
  return Boolean(value) && typeof value === 'object'
}

function defaultContext(): MeasurementContext | null {
  try {
    return document.createElement('canvas').getContext('2d')
  } catch {
    return null
  }
}

function defaultFontAvailability(font: string, text: string): string {
  try {
    if (!document.fonts || typeof document.fonts.check !== 'function') return 'unknown'
    return document.fonts.check(font, text) ? 'available' : 'loading'
  } catch {
    return 'unknown'
  }
}

function emptyMeasurement(): ContentMeasurement {
  return { firstText: null, height: 0, imageCount: 0, text: '', width: 0 }
}

function safePaint(value: unknown): SafePaint | undefined {
  if (typeof value === 'string') return value.slice(0, 200)
  if (!isRecord(value) || !Array.isArray(value.gradientPieces)) return undefined
  const gradientPieces = value.gradientPieces
    .filter((piece): piece is unknown[] => Array.isArray(piece) && piece.length >= 2)
    .slice(0, 12)
    .map((piece): [number, string] => [numberOr(piece[0], 0), String(piece[1]).slice(0, 100)])
  if (!gradientPieces.length) return undefined
  return {
    gradientPieces,
    type: value.type === 'radial' ? 'radial' : 'linear',
  }
}

function inheritableTextStyle(style: ContentRecord): ContentRecord {
  return {
    color: style.color,
    fontFamily: style.fontFamily,
    fontSize: style.fontSize,
    fontWeight: style.fontWeight,
    strokeColor: style.strokeColor,
    strokeWidth: style.strokeWidth,
  }
}

function mergeMeasurement(
  target: ContentMeasurement,
  child: ContentMeasurement,
  inline: boolean,
): void {
  target.text += child.text
  target.imageCount += child.imageCount
  target.firstText ||= child.firstText
  if (inline) {
    target.width += child.width
    target.height = Math.max(target.height, child.height)
    return
  }
  target.width = Math.max(target.width, child.width)
  target.height += child.height
}

function layoutEdges(item: ContentRecord): { height: number; width: number } {
  const margin = boxEdges(item.margin)
  const padding = boxEdges(item.padding)
  const border = Math.max(0, numberOr(item.borderWidth, 0)) * 2
  return {
    height: margin.top + margin.bottom + padding.top + padding.bottom + border,
    width: margin.left + margin.right + padding.left + padding.right + border,
  }
}

export function createDouyinContentMeasurer(
  options: DouyinContentMeasurerOptions = {},
): DouyinContentMeasurer {
  const createContext = options.createContext ?? defaultContext
  const fontAvailability = options.fontAvailability ?? defaultFontAvailability
  const cacheLimit = Math.max(
    1,
    Math.min(4_096, Math.floor(numberOr(options.maxTextCacheEntries, DEFAULT_TEXT_CACHE_LIMIT))),
  )
  const textWidthCache = new Map<string, number>()
  let context: MeasurementContext | null | undefined
  let cacheEvictions = 0
  let cacheHits = 0
  let cacheInvalidations = 0
  let cacheMisses = 0

  const measurementContext = (): MeasurementContext | null => {
    if (context !== undefined) return context
    context = createContext()
    return context
  }

  const cachedTextWidth = (
    text: string,
    fontSize: number,
    fontWeight: string | number,
    fontFamily: string,
  ): number => {
    const font = `${fontWeight} ${fontSize}px ${fontFamily}`
    const availability = String(fontAvailability(font, text))
    // CSS font shorthand, normalized text and current font availability are the
    // complete cache key. Config/font changes naturally miss; callers use
    // invalidate() after an external font-metrics change that this key cannot see.
    const key = JSON.stringify([font, text, availability])
    const cached = textWidthCache.get(key)
    if (cached !== undefined) {
      cacheHits += 1
      return cached
    }
    cacheMisses += 1
    let width = Array.from(text).length * fontSize
    const activeContext = measurementContext()
    if (activeContext) {
      try {
        activeContext.font = font
        width = activeContext.measureText(text).width
      } catch {
        // The character estimate remains usable when a site font is unavailable.
      }
    }
    if (textWidthCache.size >= cacheLimit) {
      const oldestKey = textWidthCache.keys().next().value
      if (typeof oldestKey === 'string') textWidthCache.delete(oldestKey)
      cacheEvictions += 1
    }
    textWidthCache.set(key, width)
    return width
  }

  const measureTextItem = (item: ContentRecord, style: ContentRecord): ContentMeasurement => {
    const text = normalizeText(item.text)
    const fontSize = Math.max(8, numberOr(style.fontSize, DEFAULT_FONT_SIZE))
    const fontWeight =
      typeof style.fontWeight === 'string' || typeof style.fontWeight === 'number'
        ? style.fontWeight
        : 400
    const fontFamily =
      typeof style.fontFamily === 'string' && style.fontFamily ? style.fontFamily : 'Arial'
    const edges = layoutEdges(item)
    return {
      firstText: {
        color: safePaint(style.color),
        fontFamily,
        fontSize,
        fontWeight,
        strokeColor: safePaint(style.strokeColor),
        strokeWidth: numberOr(style.strokeWidth, 1),
      },
      height: fontSize + edges.height,
      imageCount: 0,
      text,
      width: cachedTextWidth(text, fontSize, fontWeight, fontFamily) + edges.width,
    }
  }

  const measureImageItem = (
    item: ContentRecord,
    style: ContentRecord,
    imageRatios: ReadonlyMap<string, number> | null,
  ): ContentMeasurement => {
    const fontSize = Math.max(8, numberOr(style.fontSize, DEFAULT_FONT_SIZE))
    const height = Math.max(1, numberOr(item.height, fontSize))
    const source = typeof item.src === 'string' ? item.src : ''
    const ratio = source ? imageRatios?.get(source) : undefined
    const width = Math.max(
      1,
      Number.isFinite(ratio) && Number(ratio) > 0
        ? height * Number(ratio)
        : numberOr(item.width, numberOr(item.height, fontSize)),
    )
    const edges = layoutEdges(item)
    return {
      firstText: null,
      height: height + edges.height,
      imageCount: 1,
      text: '',
      width: width + edges.width,
    }
  }

  const measureContent = (
    value: unknown,
    inherited: ContentRecord,
    imageRatios: ReadonlyMap<string, number> | null,
  ): ContentMeasurement => {
    if (!isRecord(value)) return emptyMeasurement()
    const style = { ...inherited, ...value }
    if (value.type === 'text') return measureTextItem(value, style)
    if (value.type === 'image') return measureImageItem(value, style, imageRatios)

    const result = emptyMeasurement()
    const children = Array.isArray(value.content) ? value.content : []
    const childStyle = inheritableTextStyle(style)
    children.forEach((child) => {
      const childResult = measureContent(child, childStyle, imageRatios)
      const childRecord = isRecord(child) ? child : null
      const isBlock = !childRecord?.type || childRecord.type === 'block'
      mergeMeasurement(result, childResult, !isBlock || Boolean(childRecord?.isInline))
    })
    const edges = layoutEdges(value)
    result.width += edges.width
    result.height += edges.height
    return result
  }

  return {
    diagnostics: () => ({
      cacheEvictions,
      cacheHits,
      cacheInvalidations,
      cacheMisses,
      cachedTextMeasurements: textWidthCache.size,
      contextAvailable: measurementContext() !== null,
    }),
    invalidate: () => {
      textWidthCache.clear()
      cacheInvalidations += 1
    },
    measure: (value, config, content, imageRatios = null) => {
      const optionsRecord: ContentRecord = isRecord(value) ? value : {}
      const result = measureContent(
        {
          ...optionsRecord,
          content: content ?? serializeBarrage(value),
          type: 'block',
        },
        {
          color: '#ffffff',
          fontFamily: 'Arial',
          fontSize: numberOr(config.fontSize, DEFAULT_FONT_SIZE),
          fontWeight: 400,
          strokeColor: 'rgba(0, 0, 0, 0.8)',
          strokeWidth: 1,
        },
        imageRatios,
      )
      return {
        ...result,
        height: Math.max(8, result.height || numberOr(config.fontSize, DEFAULT_FONT_SIZE)),
        text: normalizeText(result.text),
        width: Math.max(4, result.width),
      }
    },
  }
}
