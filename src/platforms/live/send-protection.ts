export type SendBlockReason = 'accidental' | 'cooldown' | 'duplicate' | 'in-flight'
export type PlatformSendFeedbackKind = 'duplicate' | 'rate-limit' | 'rejected'

export interface SendBlock {
  allowed: boolean
  reason?: SendBlockReason
  remainingMs: number
}

export interface PlatformSendFeedback {
  cooldownMs: number
  kind: PlatformSendFeedbackKind
  message: string
}

interface SendProtectionOptions {
  accidentalIntervalMs?: number
  now?: () => number
  sameMessageCooldownMs?: number
  successCooldownMs?: number
}

const DEFAULT_ACCIDENTAL_INTERVAL_MS = 800
const DEFAULT_SAME_MESSAGE_COOLDOWN_MS = 1_000
const DEFAULT_SUCCESS_COOLDOWN_MS = 1_000
const DEFAULT_DUPLICATE_COOLDOWN_MS = 8_000
const DEFAULT_RATE_LIMIT_COOLDOWN_MS = 15_000
const MAX_PLATFORM_COOLDOWN_MS = 120_000
const PLATFORM_FEEDBACK_MAX_LENGTH = 180

const DUPLICATE_PATTERN = /(?:请勿|不要|不能|无法)?\s*(?:重复|连续重复|相同内容).{0,14}(?:发送|发言|弹幕|评论|内容)|(?:发送|发言|弹幕|评论).{0,14}(?:重复|相同)|duplicate(?:\s+(?:message|content))?|same\s+(?:message|content)/i
const RATE_LIMIT_PATTERN = /(?:发送|发言|弹幕|评论|操作|请求|点击|频率|手速).{0,14}(?:太快|过快|频繁|过于频繁|过高|受限|限制)|(?:太快|过快|频繁|过于频繁).{0,14}(?:发送|发言|弹幕|评论|操作|请求)|请.{0,8}(?:稍后|过一会儿?|片刻后|休息).{0,8}(?:再试|发送|发言)|too\s+(?:fast|frequent)|rate[ -]?limit|try\s+again\s+later/i
const REJECTED_PATTERN = /(?:发送|发言|弹幕|评论).{0,12}(?:失败|未成功|被拒绝|不可用|受限)|(?:被禁言|已禁言|禁止发言|无权发言|内容.{0,8}(?:违规|不合规|敏感)|包含.{0,8}敏感|等级.{0,8}(?:不足|限制)|登录.{0,10}(?:发送|发言))|(?:send|comment).{0,10}(?:failed|rejected|unavailable|not allowed)/i
const ALERT_MARKER_PATTERN = /(?:toast|notice|tips?|alert|prompt|error|warning|feedback|notify|notification|snackbar)/i
const CHAT_FEED_SELECTOR = [
  '#chat-room__list',
  '.chat-room__list',
  '.Barrage-list',
  '.Barrage-listItem',
  "[class*='chat-message-list' i]",
  "[class*='message-list' i]",
  "[class*='danmaku-list' i]",
  "[class*='barrage-list' i]",
  '[data-cmid]',
  '[data-chatid]',
].join(',')

function normalizeMessage(value: unknown): string {
  return String(value ?? '').normalize('NFKC').replace(/\s+/g, ' ').trim().toLowerCase()
}

function explicitCooldownMs(message: string): number {
  const minuteMatch = message.match(/(\d+(?:\.\d+)?)\s*(?:分钟|分|min(?:ute)?s?)/i)
  const secondMatch = message.match(/(\d+(?:\.\d+)?)\s*(?:秒|s(?:ec(?:ond)?s?)?)(?:后|之后|later)?/i)
  const milliseconds = minuteMatch
    ? Number(minuteMatch[1]) * 60_000
    : secondMatch
      ? Number(secondMatch[1]) * 1_000
      : 0
  if (milliseconds <= 0) return 0
  return Number.isFinite(milliseconds)
    ? Math.min(MAX_PLATFORM_COOLDOWN_MS, Math.max(1_000, Math.round(milliseconds)))
    : 0
}

export function classifyPlatformSendFeedback(value: unknown): PlatformSendFeedback | null {
  const message = String(value ?? '').replace(/\s+/g, ' ').trim().slice(0, PLATFORM_FEEDBACK_MAX_LENGTH)
  if (!message) return null
  const explicit = explicitCooldownMs(message)
  if (DUPLICATE_PATTERN.test(message)) {
    return {
      cooldownMs: explicit || DEFAULT_DUPLICATE_COOLDOWN_MS,
      kind: 'duplicate',
      message,
    }
  }
  if (RATE_LIMIT_PATTERN.test(message)) {
    return {
      cooldownMs: explicit || DEFAULT_RATE_LIMIT_COOLDOWN_MS,
      kind: 'rate-limit',
      message,
    }
  }
  if (REJECTED_PATTERN.test(message)) {
    return { cooldownMs: explicit, kind: 'rejected', message }
  }
  return null
}

export function createSendProtection(options: SendProtectionOptions = {}) {
  const now = options.now || Date.now
  const accidentalIntervalMs = options.accidentalIntervalMs ?? DEFAULT_ACCIDENTAL_INTERVAL_MS
  const sameMessageCooldownMs = options.sameMessageCooldownMs ?? DEFAULT_SAME_MESSAGE_COOLDOWN_MS
  const successCooldownMs = options.successCooldownMs ?? DEFAULT_SUCCESS_COOLDOWN_MS
  let inFlight = false
  let lastAttemptAt = Number.NEGATIVE_INFINITY
  let lastSuccessfulMessage = ''
  let sameMessageUntil = 0
  let globalCooldownUntil = 0

  function cooldownBlock(message: unknown): SendBlock {
    const current = now()
    const globalRemaining = Math.max(0, globalCooldownUntil - current)
    if (globalRemaining > 0) {
      return { allowed: false, reason: 'cooldown', remainingMs: globalRemaining }
    }
    const normalized = normalizeMessage(message)
    const duplicateRemaining = normalized && normalized === lastSuccessfulMessage
      ? Math.max(0, sameMessageUntil - current)
      : 0
    if (duplicateRemaining > 0) {
      return { allowed: false, reason: 'duplicate', remainingMs: duplicateRemaining }
    }
    return { allowed: true, remainingMs: 0 }
  }

  return {
    applyPlatformFeedback(feedback: PlatformSendFeedback, message: unknown): void {
      const until = now() + feedback.cooldownMs
      if (feedback.kind === 'duplicate') {
        lastSuccessfulMessage = normalizeMessage(message)
        sameMessageUntil = Math.max(sameMessageUntil, until)
      } else if (feedback.cooldownMs > 0) {
        globalCooldownUntil = Math.max(globalCooldownUntil, until)
      }
      inFlight = false
    },
    begin(message: unknown): SendBlock {
      if (inFlight) return { allowed: false, reason: 'in-flight', remainingMs: 0 }
      const cooldown = cooldownBlock(message)
      if (!cooldown.allowed) return cooldown
      const accidentalRemaining = Math.max(0, accidentalIntervalMs - (now() - lastAttemptAt))
      if (accidentalRemaining > 0) {
        return { allowed: false, reason: 'accidental', remainingMs: accidentalRemaining }
      }
      inFlight = true
      lastAttemptAt = now()
      return { allowed: true, remainingMs: 0 }
    },
    finish(message: unknown, success: boolean): void {
      inFlight = false
      if (!success) return
      lastSuccessfulMessage = normalizeMessage(message)
      // Confirmation time is part of the interval between two send attempts.
      // Anchor local protection to the attempt so a slower platform does not
      // add hidden waiting time after the UI has already confirmed success.
      sameMessageUntil = Math.max(sameMessageUntil, lastAttemptAt + sameMessageCooldownMs)
      globalCooldownUntil = Math.max(globalCooldownUntil, lastAttemptAt + successCooldownMs)
    },
    remainingMs(message: unknown): number {
      return cooldownBlock(message).remainingMs
    },
  }
}

function elementText(element: Element): string {
  const htmlElement = element as HTMLElement
  return String(htmlElement.innerText || element.textContent || '').replace(/\s+/g, ' ').trim()
}

function elementMarker(element: Element): string {
  return [
    element.id,
    typeof element.className === 'string' ? element.className : '',
    element.getAttribute('role'),
    element.getAttribute('aria-live'),
    element.getAttribute('data-e2e'),
    element.getAttribute('data-testid'),
  ].filter(Boolean).join(' ')
}

function feedbackFromElement(value: unknown): PlatformSendFeedback | null {
  let element = value instanceof Element ? value : null
  for (let depth = 0; element && depth < 8; depth += 1, element = element.parentElement) {
    if (element.closest('[data-bcp-one-owned], [data-bcp-douyin-owned]')) return null
    if (element.closest(CHAT_FEED_SELECTOR)) return null
    const marker = elementMarker(element)
    const role = element.getAttribute('role')
    const ariaLive = element.getAttribute('aria-live')
    const alertLike = role === 'alert' || role === 'status' || Boolean(ariaLive)
      || ALERT_MARKER_PATTERN.test(marker)
    if (!alertLike) continue
    const text = elementText(element)
    if (text.length > PLATFORM_FEEDBACK_MAX_LENGTH) continue
    const feedback = classifyPlatformSendFeedback(text)
    if (feedback) return feedback
  }
  return null
}

function feedbackFromNode(value: unknown): PlatformSendFeedback | null {
  if (!(value instanceof Element)) return null
  const direct = feedbackFromElement(value)
  if (direct) return direct
  const selectors = [
    "[role='alert']",
    "[role='status']",
    '[aria-live]',
    "[class*='toast' i]",
    "[class*='notice' i]",
    "[class*='tip' i]",
    "[class*='prompt' i]",
    "[class*='error' i]",
    "[class*='warning' i]",
    "[class*='notify' i]",
    "[class*='snackbar' i]",
    '#pubNoticMe',
    "[data-e2e*='toast' i]",
    "[data-testid*='toast' i]",
  ].join(',')
  return Array.from(value.querySelectorAll(selectors))
    .map(feedbackFromElement)
    .find((candidate): candidate is PlatformSendFeedback => Boolean(candidate)) || null
}

export interface PlatformFeedbackProbe {
  stop(): void
  wait(timeoutMs?: number): Promise<PlatformSendFeedback | null>
}

export function createPlatformFeedbackProbe(root: Document | Element = document): PlatformFeedbackProbe {
  let feedback: PlatformSendFeedback | null = null
  let stopped = false
  let resolveFeedback: ((value: PlatformSendFeedback | null) => void) | null = null
  let timer: ReturnType<typeof setTimeout> | undefined
  const target = root instanceof Document ? root.documentElement : root
  const observer = new MutationObserver((mutations) => {
    if (feedback || stopped) return
    for (const mutation of mutations) {
      const candidates = mutation.type === 'childList'
        ? Array.from(mutation.addedNodes)
        : [mutation.target]
      for (const candidate of candidates) {
        const matched = feedbackFromNode(
          candidate instanceof Element ? candidate : candidate.parentElement,
        )
        if (!matched) continue
        feedback = matched
        observer.disconnect()
        if (timer !== undefined) clearTimeout(timer)
        resolveFeedback?.(feedback)
        resolveFeedback = null
        return
      }
    }
  })
  if (target) {
    observer.observe(target, {
      attributeFilter: ['aria-hidden', 'class', 'hidden', 'style'],
      attributes: true,
      characterData: true,
      childList: true,
      subtree: true,
    })
  }

  function stop(): void {
    if (stopped) return
    stopped = true
    observer.disconnect()
    if (timer !== undefined) clearTimeout(timer)
    resolveFeedback?.(feedback)
    resolveFeedback = null
  }

  return {
    stop,
    wait(timeoutMs = 900): Promise<PlatformSendFeedback | null> {
      if (feedback || stopped) return Promise.resolve(feedback)
      return new Promise((resolve) => {
        resolveFeedback = resolve
        timer = setTimeout(() => {
          timer = undefined
          observer.disconnect()
          stopped = true
          resolveFeedback = null
          resolve(feedback)
        }, Math.max(0, timeoutMs))
      })
    },
  }
}
