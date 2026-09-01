import type { PlatformId } from '../../core/types'

export type LiveAudienceMetricKind = 'guests' | 'viewers'

export type LiveAudienceMetricSource =
  | 'dom'
  | 'frame'

export interface LiveAudienceMetric {
  kind: LiveAudienceMetricKind
  label: string
  platform: PlatformId
  rawText: string
  sampledAt?: number
  source?: LiveAudienceMetricSource
  value: number
}

interface PlatformAudienceConfig {
  kind: LiveAudienceMetricKind
  label: string
  matches(element: Element, text: string): boolean
  selectors: readonly string[]
}

const NUMBER_PATTERN = /(\d[\d,]*(?:\.\d+)?)\s*(千|万|亿|[kKmMwWbB])?\s*(\+)?/
const NUMBER_FORMATTER = new Intl.NumberFormat('zh-CN', { maximumFractionDigits: 0 })

const PLATFORM_AUDIENCE_CONFIG: Record<PlatformId, PlatformAudienceConfig> = {
  bilibili: {
    kind: 'viewers',
    label: '房间观众',
    matches: (_element, text) => /房间观众\s*[（(]/.test(text),
    selectors: ['.tab-list .tab-item', '[class*="tab-list"] [class*="tab-item"]'],
  },
  douyin: {
    kind: 'viewers',
    label: '在线观众',
    matches: () => true,
    selectors: ['[data-e2e="live-room-audience"]'],
  },
  douyu: {
    kind: 'guests',
    label: '贵宾数',
    matches: (_element, text) => /^贵宾\s*[（(]\s*\d/.test(text),
    selectors: [
      '[class*="noble"]',
      '[class*="Noble"]',
      '[class*="vip"]',
      '[class*="Vip"]',
      '[class*="ChatRank"]',
      '.Barrage-container [class*="tab"]',
      '.Barrage-container [class*="title"]',
      '.layout-Player-chat [class*="tab"]',
      '.layout-Player-chat [class*="Tab"]',
      '.layout-Player-chat [class*="title"]',
      '.layout-Player-chat [class*="Title"]',
      '[class*="rank"] [role="tab"]',
      '[class*="Rank"] [role="tab"]',
      '[role="tab"]',
    ],
  },
  huya: {
    kind: 'guests',
    label: '贵宾数',
    matches: (_element, text) => /^贵宾\s*[（(]\s*\d/.test(text),
    selectors: [
      '.J_rankTabVip',
      '[class*="rankTabVip"]',
      '[class*="RankTabVip"]',
      '#J_roomWeeklyRankList [class*="nav-item"]',
    ],
  },
}

function normalizedText(value: unknown): string {
  return String(value ?? '')
    .normalize('NFKC')
    .replace(/\s+/g, ' ')
    .trim()
}

function audienceNumberMatch(value: unknown): RegExpMatchArray | null {
  return normalizedText(value).match(NUMBER_PATTERN)
}

export function parseLiveAudienceValue(value: unknown): number | null {
  const match = audienceNumberMatch(value)
  if (!match) return null
  const amount = Number.parseFloat(match[1].replace(/,/g, ''))
  const unit = String(match[2] || '').toLowerCase()
  const multiplier = unit === '亿' || unit === 'b'
    ? 100_000_000
    : unit === '万' || unit === 'w'
      ? 10_000
      : unit === '千' || unit === 'k'
        ? 1_000
        : unit === 'm'
          ? 1_000_000
          : 1
  const result = Math.round(amount * multiplier)
  return Number.isSafeInteger(result) && result >= 0 ? result : null
}

function rawAudienceNumber(value: unknown): string {
  const match = audienceNumberMatch(value)
  if (!match) return ''
  return `${match[1]}${match[2] || ''}${match[3] || ''}`
}

export function formatLiveAudienceMetric(metric: LiveAudienceMetric | null): string {
  if (!metric) return '识别中…'
  const suffix = metric.kind === 'guests' ? ' 位' : ' 人'
  if (/[千万亿kKmMwWbB+]/.test(metric.rawText)) {
    return `${metric.rawText}${suffix}`
  }
  return `${NUMBER_FORMATTER.format(metric.value)}${suffix}`
}

export function isAdaptiveAudienceMetric(
  metric: LiveAudienceMetric | null,
): metric is LiveAudienceMetric {
  return metric?.kind === 'viewers' || metric?.kind === 'guests'
}

export function readLiveAudienceMetric(
  platform: PlatformId,
  root: ParentNode = document,
): LiveAudienceMetric | null {
  const config = PLATFORM_AUDIENCE_CONFIG[platform]
  const visited = new Set<Element>()
  for (const selector of config.selectors) {
    let elements: Element[] = []
    try {
      elements = Array.from(root.querySelectorAll(selector))
    } catch {
      continue
    }
    for (const element of elements) {
      if (visited.has(element)) continue
      visited.add(element)
      const text = normalizedText(element.textContent)
      if (!config.matches(element, text)) continue
      const value = parseLiveAudienceValue(text)
      if (value === null) continue
      return {
        kind: config.kind,
        label: config.label,
        platform,
        rawText: rawAudienceNumber(text),
        sampledAt: Date.now(),
        source: 'dom',
        value,
      }
    }
  }
  return null
}
