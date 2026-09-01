export type DouyinRepeatReminderExclusionReason = 'gift' | 'synthetic-activity'

export interface DouyinRepeatReminderCandidate {
  element?: Element | null
  messageId?: unknown
  record?: unknown
  text?: unknown
}

const GIFT_TEXT_PATTERN = /(?:^|[\s:：])送出(?:了)?\s*\S[\s\S]{0,100}?[x×✕]\s*\d+\s*$/u
const SYNTHETIC_ID_PATTERN = /^__mocked__(?:__)?/iu
const TYPE_HINT_KEY_PATTERN = /(?:action|biz|business|event|kind|message|method|scene|source|type)/iu
const GIFT_TYPE_PATTERN = /(?:webcast)?gift(?:message)?|送礼|礼物/iu
const SYNTHETIC_TYPE_PATTERN = /lucky.?bag|lucky.?box|lottery|red.?packet|treasure.?box|福袋|抽奖/iu
const SYNTHETIC_FIELD_KEY_PATTERN = /lucky.?bag|lucky.?box|lottery|red.?packet|treasure.?box/iu
const SYNTHETIC_TEXT_PATTERN = /(?:福袋[\s\S]{0,24}(?:抽|开奖|口令|领取|参与|倒计时)|(?:左上角|右上角|点击|进入|参与|输入|发送)[\s\S]{0,24}福袋)/u
const STRUCTURAL_GIFT_PATTERN = /(?:^|[-_])gift(?:[-_]|$)/iu
const STRUCTURAL_SYNTHETIC_PATTERN = /(?:lucky.?bag|lottery|red.?packet|福袋|抽奖)/iu

function normalizedText(value: unknown): string {
  return String(value ?? '')
    .normalize('NFKC')
    .replace(/\s+/gu, ' ')
    .trim()
}

function recordHints(value: unknown): string[] {
  const hints: string[] = []
  const seen = new WeakSet<object>()
  let remaining = 60
  const visit = (candidate: unknown, depth: number): void => {
    if (!candidate || typeof candidate !== 'object' || depth > 4 || remaining <= 0) return
    if (seen.has(candidate)) return
    seen.add(candidate)
    remaining -= 1
    for (const [key, nested] of Object.entries(candidate)) {
      if (SYNTHETIC_FIELD_KEY_PATTERN.test(key)) {
        hints.push(`field:${key}`.slice(0, 240))
      }
      if (TYPE_HINT_KEY_PATTERN.test(key) && (typeof nested === 'string' || typeof nested === 'number')) {
        hints.push(`${key}:${String(nested)}`.slice(0, 240))
      }
      if (nested && typeof nested === 'object') visit(nested, depth + 1)
      if (remaining <= 0) break
    }
  }
  visit(value, 0)
  return hints
}

function elementHints(element: Element | null | undefined): string[] {
  if (!element) return []
  const hints: string[] = []
  let current: Element | null = element
  for (let depth = 0; current && depth < 4; depth += 1, current = current.parentElement) {
    hints.push(String(current.className || ''))
    for (const attribute of current.attributes) {
      if (/^(?:data-(?:type|kind|message-type|event-type|biz-type)|role)$/iu.test(attribute.name)) {
        hints.push(`${attribute.name}:${attribute.value}`)
      }
      if (/^data-(?:message-|msg-)?id$/iu.test(attribute.name) && SYNTHETIC_ID_PATTERN.test(attribute.value)) {
        hints.push(attribute.value)
      }
    }
  }
  try {
    const marked = element.querySelector(
      '[data-message-id^="__mocked__"], [data-msg-id^="__mocked__"], [class*="gift"], [class*="lucky"], [class*="lottery"]',
    )
    if (marked) hints.push(String(marked.className || ''), marked.getAttribute('data-message-id') || '')
  } catch {
    // Ignore unsupported or temporarily invalid platform DOM.
  }
  return hints
}

export function douyinRepeatReminderExclusionReason(
  candidate: DouyinRepeatReminderCandidate,
): DouyinRepeatReminderExclusionReason | null {
  const messageId = normalizedText(candidate.messageId)
  if (SYNTHETIC_ID_PATTERN.test(messageId)) return 'synthetic-activity'

  const text = normalizedText(candidate.text)
  if (GIFT_TEXT_PATTERN.test(text)) return 'gift'
  if (SYNTHETIC_TEXT_PATTERN.test(text)) return 'synthetic-activity'

  const record = recordHints(candidate.record).join(' ')
  if (GIFT_TYPE_PATTERN.test(record)) return 'gift'
  if (SYNTHETIC_TYPE_PATTERN.test(record)) return 'synthetic-activity'

  const structure = elementHints(candidate.element).join(' ')
  if (structure.includes('__mocked__') || STRUCTURAL_SYNTHETIC_PATTERN.test(structure)) {
    return 'synthetic-activity'
  }
  if (STRUCTURAL_GIFT_PATTERN.test(structure)) return 'gift'
  return null
}
