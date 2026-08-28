export type BilibiliRepeatReminderExclusionReason = 'lottery-entry'

export interface BilibiliRepeatReminderCandidate {
  element?: Element | null
  source?: 'chat' | 'video'
  text?: unknown
}

const LOTTERY_MARKER_PATTERN = /anchor.?lottery|lottery|lucky.?bag|red.?packet|福袋|天选|抽奖/iu
const LOTTERY_CODE_PATTERN = /^[\p{L}]{2,24}\d{5,8}$/u
const BILIBILI_OVERLAY_SELECTOR = '.bili-danmaku-x-dm'

function normalizedText(value: unknown): string {
  return String(value ?? '')
    .normalize('NFKC')
    .replace(/\s+/gu, '')
    .trim()
}

function overlayRow(element: Element | null | undefined): HTMLElement | null {
  if (!(element instanceof HTMLElement)) return null
  try {
    const row = element.matches(BILIBILI_OVERLAY_SELECTOR)
      ? element
      : element.closest(BILIBILI_OVERLAY_SELECTOR)
    return row instanceof HTMLElement ? row : null
  } catch {
    return null
  }
}

function inlineFontSize(element: HTMLElement): number | null {
  const raw = element.style.getPropertyValue('--fontSize') || element.style.fontSize
  const value = Number.parseFloat(raw)
  return Number.isFinite(value) && value > 0 ? value : null
}

function neighboringFontSizes(row: HTMLElement): number[] {
  const parent = row.parentElement
  if (!parent) return []
  let rows: Element[] = []
  try {
    rows = Array.from(parent.querySelectorAll(BILIBILI_OVERLAY_SELECTOR)).slice(-48)
  } catch {
    return []
  }
  return rows
    .filter((candidate) => candidate !== row && candidate instanceof HTMLElement)
    .map((candidate) => inlineFontSize(candidate as HTMLElement))
    .filter((value): value is number => value !== null)
    .sort((first, second) => first - second)
}

function isProminentLotteryFont(row: HTMLElement): boolean {
  const fontSize = inlineFontSize(row)
  if (fontSize === null) return false
  const neighbors = neighboringFontSizes(row)
  if (!neighbors.length) return fontSize >= 32
  const middle = Math.floor(neighbors.length / 2)
  const median = neighbors.length % 2
    ? neighbors[middle]
    : (neighbors[middle - 1] + neighbors[middle]) / 2
  return fontSize >= median * 1.25
}

function structuralHints(element: Element | null | undefined): string {
  if (!element) return ''
  const hints: string[] = []
  let current: Element | null = element
  for (let depth = 0; current && depth < 4; depth += 1, current = current.parentElement) {
    hints.push(String(current.className || ''))
    for (const attribute of current.attributes) {
      if (/^(?:data-(?:biz|event|kind|message|msg|scene|type)|aria-label|role)$/iu.test(attribute.name)) {
        hints.push(`${attribute.name}:${attribute.value}`)
      }
    }
  }
  return hints.join(' ')
}

export function bilibiliRepeatReminderExclusionReason(
  candidate: BilibiliRepeatReminderCandidate,
): BilibiliRepeatReminderExclusionReason | null {
  if (LOTTERY_MARKER_PATTERN.test(structuralHints(candidate.element))) return 'lottery-entry'
  if (candidate.source !== 'video') return null
  const row = overlayRow(candidate.element)
  const text = normalizedText(candidate.text)
  return row && LOTTERY_CODE_PATTERN.test(text) && isProminentLotteryFont(row)
    ? 'lottery-entry'
    : null
}
