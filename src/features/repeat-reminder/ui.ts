import { REPEAT_REMINDER_HIT_REGIONS_ATTRIBUTE } from './pointer-guard'
import type { RepeatReminderSuggestion } from './types'

interface RepeatReminderUiOptions {
  dismiss(suggestion: RepeatReminderSuggestion): void
  onboardingStorage?: {
    acknowledge(): Promise<void>
    isAcknowledged(): Promise<boolean>
  }
  openSettings(): void
  plusOne(suggestion: RepeatReminderSuggestion): void
}

interface RepeatReminderUiSettings {
  enabled: boolean
  promptDurationSeconds: number
  promptScalePercent: number
  queueLimit: number
  threshold: number
}

const RADAR_ICON = `
  <svg viewBox="0 0 24 24" aria-hidden="true">
    <circle cx="12" cy="12" r="8.5"></circle>
    <circle cx="12" cy="12" r="4.75"></circle>
    <circle cx="12" cy="12" r="1.4" class="is-filled"></circle>
    <path d="M12 12 18.2 7.7"></path>
  </svg>
`

const LAUNCHER_SIZE = 46
const PROMPT_ENTER_DURATION_MS = 220
const PROMPT_EXIT_DURATION_MS = 160
const PROMPT_MOVE_DURATION_MS = 260
const PROMPT_MOTION_EASING = 'cubic-bezier(0.22, 1, 0.36, 1)'
const VIEWPORT_GAP = 12

export function createRepeatReminderUi(options: RepeatReminderUiOptions) {
  const portal = document.createElement('div')
  portal.dataset.bcpRepeatReminderOwned = 'true'
  portal.style.setProperty('all', 'initial', 'important')
  portal.style.setProperty('position', 'fixed', 'important')
  portal.style.setProperty('inset', '0', 'important')
  portal.style.setProperty('pointer-events', 'none', 'important')
  portal.style.setProperty('z-index', '2147483647', 'important')
  const shadow = portal.attachShadow({ mode: 'open' })
  const style = document.createElement('style')
  style.textContent = `
    :host { all: initial; font-family: "Microsoft YaHei UI", "PingFang SC", sans-serif; }
    *, *::before, *::after { box-sizing: border-box; }
    button { font-family: inherit; }
    .launcher { align-items: center; background: rgb(255 255 255 / 96%); border: 1px solid rgb(23 24 29 / 12%); border-radius: 14px; box-shadow: 0 10px 28px rgb(23 24 29 / 20%); color: #ff7a00; cursor: grab; display: none; height: 46px; justify-content: center; padding: 0; pointer-events: auto; position: fixed; touch-action: none; transition: border-color 140ms ease, box-shadow 140ms ease; user-select: none; width: 46px; }
    .launcher.is-visible { display: flex; }
    .launcher:hover, .launcher[aria-expanded="true"] { border-color: rgb(255 122 0 / 42%); box-shadow: 0 12px 32px rgb(23 24 29 / 25%); }
    .launcher.is-dragging { cursor: grabbing; transition: none; }
    .launcher svg { fill: none; height: 23px; pointer-events: none; stroke: currentColor; stroke-linecap: round; stroke-linejoin: round; stroke-width: 1.65; width: 23px; }
    .launcher svg .is-filled { fill: currentColor; stroke: none; }
    .launcher-badge { align-items: center; background: #ff4747; border: 2px solid #fff; border-radius: 999px; color: #fff; display: none; font: 700 9px/1 ui-monospace, Consolas, monospace; height: 18px; justify-content: center; min-width: 18px; padding: 0 4px; pointer-events: none; position: absolute; right: -5px; top: -5px; }
    .launcher.has-alert .launcher-badge { display: flex; }
    .settings { backdrop-filter: blur(12px); background: rgb(255 255 255 / 97%); border: 1px solid rgb(23 24 29 / 12%); border-radius: 16px; box-shadow: 0 14px 36px rgb(23 24 29 / 22%); color: #17181d; display: none; padding: 14px; pointer-events: auto; position: fixed; width: 248px; }
    .settings.is-visible { display: block; }
    .settings-head { align-items: center; display: flex; gap: 10px; }
    .settings-icon { align-items: center; background: rgb(255 122 0 / 12%); border-radius: 10px; color: #ff7a00; display: flex; flex: 0 0 34px; height: 34px; justify-content: center; }
    .settings-icon svg { fill: none; height: 18px; stroke: currentColor; stroke-linecap: round; stroke-linejoin: round; stroke-width: 1.7; width: 18px; }
    .settings-icon svg .is-filled { fill: currentColor; stroke: none; }
    .settings-title { display: flex; flex: 1; flex-direction: column; min-width: 0; }
    .settings-title strong { font-size: 14px; font-weight: 650; line-height: 19px; }
    .settings-title small { color: #8b8f9c; font-size: 11px; line-height: 16px; }
    .status-dot { background: #12a96b; border-radius: 999px; height: 8px; width: 8px; }
    .setting-values { display: grid; gap: 7px; grid-template-columns: repeat(2, 1fr); margin-top: 13px; }
    .setting-value { background: #f5f6f9; border: 1px solid rgb(23 24 29 / 9%); border-radius: 10px; display: flex; flex-direction: column; gap: 2px; padding: 9px 10px; }
    .setting-value small { color: #8b8f9c; font-size: 10px; }
    .setting-value strong { color: #ff7a00; font: 650 12px/17px ui-monospace, Consolas, monospace; }
    .open-settings { background: transparent; border: 0; border-top: 1px solid rgb(23 24 29 / 9%); color: #565a66; cursor: pointer; font-size: 11px; margin-top: 12px; padding: 10px 2px 0; text-align: left; width: 100%; }
    .open-settings:hover { color: #ff7a00; }
    .onboarding { align-items: center; background: rgb(17 18 22 / 46%); backdrop-filter: blur(5px); display: none; inset: 0; justify-content: center; padding: 20px; pointer-events: auto; position: fixed; z-index: 10; }
    .onboarding.is-visible { display: flex; }
    .onboarding-card { animation: onboarding-enter 220ms cubic-bezier(0.22, 1, 0.36, 1); background: rgb(255 255 255 / 98%); border: 1px solid rgb(255 255 255 / 62%); border-radius: 20px; box-shadow: 0 24px 80px rgb(17 18 22 / 32%); color: #17181d; max-height: calc(100vh - 40px); overflow: auto; padding: 22px; width: min(440px, calc(100vw - 32px)); }
    .onboarding-head { align-items: flex-start; display: flex; gap: 13px; }
    .onboarding-icon { align-items: center; background: linear-gradient(145deg, #ff9a3c, #ff7000); border-radius: 14px; box-shadow: 0 8px 20px rgb(255 122 0 / 24%); color: #fff; display: flex; flex: 0 0 46px; height: 46px; justify-content: center; }
    .onboarding-icon svg { fill: none; height: 24px; stroke: currentColor; stroke-linecap: round; stroke-linejoin: round; stroke-width: 1.7; width: 24px; }
    .onboarding-icon svg .is-filled { fill: currentColor; stroke: none; }
    .onboarding-heading { min-width: 0; }
    .onboarding-eyebrow { color: #ff7a00; display: block; font-size: 11px; font-weight: 700; letter-spacing: 0.08em; line-height: 16px; margin-bottom: 2px; }
    .onboarding h2 { font-size: 18px; line-height: 25px; margin: 0; }
    .onboarding-description { color: #565a66; font-size: 13px; line-height: 21px; margin: 16px 0 0; }
    .onboarding-description strong { color: #17181d; font-weight: 700; }
    .onboarding-points { display: grid; gap: 8px; margin-top: 16px; }
    .onboarding-point { align-items: flex-start; background: #f7f7f9; border: 1px solid rgb(23 24 29 / 8%); border-radius: 12px; display: flex; gap: 10px; padding: 10px 11px; }
    .onboarding-point-mark { align-items: center; background: rgb(255 122 0 / 12%); border-radius: 999px; color: #ff7a00; display: flex; flex: 0 0 22px; font: 750 12px/1 ui-monospace, Consolas, monospace; height: 22px; justify-content: center; }
    .onboarding-point span:last-child { color: #565a66; font-size: 12px; line-height: 19px; }
    .onboarding-point strong { color: #17181d; }
    .onboarding-settings { border-top: 1px solid rgb(23 24 29 / 9%); margin-top: 17px; padding-top: 15px; }
    .onboarding-settings > strong { display: block; font-size: 12px; line-height: 18px; }
    .onboarding-setting-list { display: flex; flex-wrap: wrap; gap: 7px; list-style: none; margin: 9px 0 0; padding: 0; }
    .onboarding-setting-list li { background: rgb(255 122 0 / 9%); border: 1px solid rgb(255 122 0 / 18%); border-radius: 999px; color: #a34e00; font-size: 11px; line-height: 18px; padding: 4px 9px; }
    .onboarding-hint { color: #8b8f9c; font-size: 11px; line-height: 18px; margin: 10px 0 0; }
    .onboarding-actions { display: flex; gap: 9px; justify-content: flex-end; margin-top: 19px; }
    .onboarding-actions button { border-radius: 999px; cursor: pointer; font-size: 12px; font-weight: 650; min-height: 44px; padding: 0 18px; }
    .onboarding-open-settings { background: #f2f3f6; border: 1px solid rgb(23 24 29 / 12%); color: #565a66; }
    .onboarding-open-settings:hover { border-color: rgb(255 122 0 / 28%); color: #c55e00; }
    .onboarding-acknowledge { background: #ff7a00; border: 1px solid #ff7a00; color: #fff; box-shadow: 0 7px 16px rgb(255 122 0 / 22%); }
    .onboarding-acknowledge:hover { background: #ef7000; border-color: #ef7000; }
    .prompt-list { display: none; flex-direction: column; gap: 8px; max-width: min(360px, calc(100vw - 86px)); pointer-events: none; position: fixed; transform: scale(var(--bcp-repeat-prompt-scale, 1)); transform-origin: left top; width: 360px; }
    .prompt-list.is-visible { display: flex; }
    .prompt { align-items: center; backdrop-filter: blur(12px); background: rgb(255 255 255 / 96%); border: 1px solid rgb(255 122 0 / 28%); border-radius: 13px; box-shadow: 0 12px 34px rgb(23 24 29 / 22%); color: #17181d; display: flex; gap: 12px; padding: 11px 12px; pointer-events: auto; transform-origin: center top; width: 100%; }
    .prompt.is-leaving { pointer-events: none; }
    .prompt-copy { display: flex; flex: 1; flex-direction: column; min-width: 0; }
    .prompt small { color: #8b8f9c; font-size: 10px; }
    .prompt strong { font-size: 13px; line-height: 20px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    .prompt-meta { color: #ff7a00; font: 600 10px/16px ui-monospace, Consolas, monospace; }
    .prompt-actions { display: flex; flex: 0 0 auto; gap: 6px; }
    .prompt-actions button { background: #f2f3f6; border: 1px solid rgb(23 24 29 / 12%); border-radius: 999px; color: #565a66; cursor: pointer; font-size: 11px; padding: 7px 11px; }
    .prompt-actions button:hover { border-color: rgb(255 122 0 / 28%); }
    .prompt-actions button.is-primary { background: #ff7a00; border-color: #ff7a00; color: #fff; font-weight: 650; }
    button:focus-visible { outline: 2px solid #ff9e48; outline-offset: 2px; }
    @keyframes onboarding-enter {
      from { opacity: 0; transform: translate3d(0, 8px, 0) scale(0.98); }
      to { opacity: 1; transform: translate3d(0, 0, 0) scale(1); }
    }
    @media (max-width: 480px) {
      .onboarding { padding: 16px; }
      .onboarding-card { padding: 18px; }
      .onboarding-actions { flex-direction: column-reverse; }
      .onboarding-actions button { width: 100%; }
    }
    @media (prefers-reduced-motion: reduce) {
      .launcher { transition-duration: 0.01ms; }
      .onboarding-card { animation: none; }
    }
  `

  const launcher = document.createElement('button')
  launcher.dataset.bcpRepeatReminderInteractive = 'true'
  launcher.type = 'button'
  launcher.className = 'launcher'
  launcher.title = '弹幕雷达'
  launcher.setAttribute('aria-label', '打开弹幕雷达设置，可拖动')
  launcher.setAttribute('aria-expanded', 'false')
  launcher.innerHTML = `${RADAR_ICON}<span class="launcher-badge" aria-hidden="true"></span>`
  const launcherBadge = launcher.querySelector<HTMLElement>('.launcher-badge')!

  const settingsPanel = document.createElement('section')
  settingsPanel.dataset.bcpRepeatReminderInteractive = 'true'
  settingsPanel.className = 'settings'
  settingsPanel.setAttribute('aria-label', '弹幕雷达设置')
  settingsPanel.innerHTML = `
    <div class="settings-head">
      <span class="settings-icon">${RADAR_ICON}</span>
      <span class="settings-title"><strong>弹幕雷达</strong><small>高频 +1 队列统计中</small></span>
      <span class="status-dot" title="已启用"></span>
    </div>
    <div class="setting-values">
      <span class="setting-value"><small>触发次数</small><strong data-value="threshold">5 次</strong></span>
      <span class="setting-value"><small>提示停留</small><strong data-value="duration">6 秒</strong></span>
      <span class="setting-value"><small>队列上限</small><strong data-value="queue">3 条</strong></span>
      <span class="setting-value"><small>提示大小</small><strong data-value="scale">100%</strong></span>
    </div>
    <button type="button" class="open-settings">进入扩展主页设置 →</button>
  `

  const onboarding = document.createElement('div')
  onboarding.dataset.bcpRepeatReminderInteractive = 'true'
  onboarding.className = 'onboarding'
  onboarding.innerHTML = `
    <section
      class="onboarding-card"
      role="dialog"
      aria-modal="true"
      aria-labelledby="bcp-repeat-onboarding-title"
      aria-describedby="bcp-repeat-onboarding-description"
    >
      <header class="onboarding-head">
        <span class="onboarding-icon">${RADAR_ICON}</span>
        <span class="onboarding-heading">
          <small class="onboarding-eyebrow">首次触发</small>
          <h2 id="bcp-repeat-onboarding-title">认识弹幕雷达</h2>
        </span>
      </header>
      <p id="bcp-repeat-onboarding-description" class="onboarding-description">
        弹幕雷达会观察最近一分钟内重复出现的文字弹幕，达到设定次数后生成 <strong>+1 提示队列</strong>。
      </p>
      <div class="onboarding-points">
        <div class="onboarding-point">
          <span class="onboarding-point-mark">1</span>
          <span><strong>只提醒，不自动发送。</strong>只有你点击 +1 后，插件才会发送对应弹幕。</span>
        </div>
        <div class="onboarding-point">
          <span class="onboarding-point-mark">2</span>
          <span><strong>高频内容进入队列。</strong>每条提示独立倒计时，可选择 +1 或暂不处理。</span>
        </div>
      </div>
      <div class="onboarding-settings">
        <strong>可在扩展设置页面调整</strong>
        <ul class="onboarding-setting-list">
          <li>开启或关闭</li>
          <li>触发次数</li>
          <li>提示停留时间</li>
          <li>队列上限</li>
          <li>提示框大小</li>
        </ul>
        <p class="onboarding-hint">也可以点击页面上的雷达按钮查看当前设置；雷达按钮支持拖动。</p>
      </div>
      <footer class="onboarding-actions">
        <button type="button" class="onboarding-open-settings">进入设置</button>
        <button type="button" class="onboarding-acknowledge">知道了</button>
      </footer>
    </section>
  `
  const onboardingCard = onboarding.querySelector<HTMLElement>('.onboarding-card')!
  const onboardingOpenSettings = onboarding.querySelector<HTMLButtonElement>(
    '.onboarding-open-settings',
  )!
  const onboardingAcknowledge =
    onboarding.querySelector<HTMLButtonElement>('.onboarding-acknowledge')!

  const promptList = document.createElement('aside')
  promptList.dataset.bcpRepeatReminderInteractive = 'true'
  promptList.className = 'prompt-list'
  promptList.setAttribute('aria-live', 'polite')
  promptList.setAttribute('aria-label', '高频弹幕 +1 提示队列')
  shadow.append(style, launcher, settingsPanel, promptList, onboarding)

  let current: RepeatReminderSuggestion[] = []
  let enabled = false
  let settingsOpen = false
  let promptDurationSeconds = 6
  let promptScalePercent = 100
  let queueLimit = 3
  let threshold = 5
  let launcherX = Math.max(VIEWPORT_GAP, window.innerWidth - LAUNCHER_SIZE - 18)
  let launcherY = 18
  let countdownTimer: ReturnType<typeof setInterval> | undefined
  let destroyed = false
  let onboardingAcknowledged = !options.onboardingStorage
  let onboardingLoaded = !options.onboardingStorage
  let onboardingOpen = false
  const deadlines = new Map<string, number>()
  const leavingIds = new Set<string>()
  const snoozed = new Map<string, number>()

  function clamp(value: number, minimum: number, maximum: number): number {
    return Math.min(Math.max(value, minimum), Math.max(minimum, maximum))
  }

  function publishHitRegions(): void {
    const visibleElements = [
      enabled ? launcher : null,
      settingsOpen ? settingsPanel : null,
      enabled && current.length > 0 && !settingsOpen && onboardingAcknowledged ? promptList : null,
      onboardingOpen ? onboarding : null,
    ]
    const regions = visibleElements.flatMap((element) => {
      if (!element) return []
      const rect = element.getBoundingClientRect()
      if (rect.width <= 0 || rect.height <= 0) return []
      return [[rect.left, rect.top, rect.right, rect.bottom]]
    })
    portal.setAttribute(REPEAT_REMINDER_HIT_REGIONS_ATTRIBUTE, JSON.stringify(regions))
  }

  function positionFloatingUi(): void {
    launcherX = clamp(launcherX, VIEWPORT_GAP, window.innerWidth - LAUNCHER_SIZE - VIEWPORT_GAP)
    launcherY = clamp(launcherY, VIEWPORT_GAP, window.innerHeight - LAUNCHER_SIZE - VIEWPORT_GAP)
    launcher.style.left = `${launcherX}px`
    launcher.style.top = `${launcherY}px`
    const panelWidth = 248
    const promptWidth = Math.min(
      360 * (promptScalePercent / 100),
      Math.max(180, window.innerWidth - 2 * VIEWPORT_GAP),
    )
    const settingsLeft =
      launcherX >= panelWidth + 2 * VIEWPORT_GAP
        ? launcherX - panelWidth - 10
        : launcherX + LAUNCHER_SIZE + 10
    const promptLeft =
      launcherX >= promptWidth + 2 * VIEWPORT_GAP
        ? launcherX - promptWidth - 10
        : launcherX + LAUNCHER_SIZE + 10
    settingsPanel.style.left = `${clamp(settingsLeft, VIEWPORT_GAP, window.innerWidth - panelWidth - VIEWPORT_GAP)}px`
    settingsPanel.style.top = `${clamp(launcherY, VIEWPORT_GAP, window.innerHeight - 260)}px`
    promptList.style.left = `${clamp(promptLeft, VIEWPORT_GAP, window.innerWidth - promptWidth - VIEWPORT_GAP)}px`
    promptList.style.top = `${clamp(launcherY, VIEWPORT_GAP, window.innerHeight - 80)}px`
    publishHitRegions()
  }

  function ensureHost(): void {
    const host = document.fullscreenElement || document.documentElement
    if (host) host.appendChild(portal)
    positionFloatingUi()
  }

  function updateVisibility(): void {
    const hasSuggestions = enabled && current.length > 0
    launcher.classList.toggle('has-alert', hasSuggestions)
    launcherBadge.textContent = hasSuggestions ? String(current.length) : ''
    promptList.classList.toggle(
      'is-visible',
      hasSuggestions && !settingsOpen && onboardingLoaded && onboardingAcknowledged,
    )
    onboarding.classList.toggle('is-visible', onboardingOpen)
    publishHitRegions()
  }

  function setSettingsOpen(value: boolean): void {
    settingsOpen = enabled && !onboardingOpen && value
    launcher.setAttribute('aria-expanded', String(settingsOpen))
    settingsPanel.classList.toggle('is-visible', settingsOpen)
    updateVisibility()
  }

  function resetCurrentDeadlines(): void {
    const deadline = Date.now() + promptDurationSeconds * 1_000
    for (const suggestion of current) deadlines.set(suggestion.id, deadline)
  }

  function focusCurrentPrompt(): void {
    queueMicrotask(() => {
      if (destroyed || onboardingOpen) return
      const target = promptList.querySelector<HTMLButtonElement>('[data-plus-one-id]') || launcher
      target.focus({ preventScroll: true })
    })
  }

  function acknowledgeOnboarding(openSettings: boolean): void {
    onboardingAcknowledged = true
    onboardingLoaded = true
    onboardingOpen = false
    resetCurrentDeadlines()
    updateVisibility()
    ensureCountdown()
    void options.onboardingStorage?.acknowledge()
    if (openSettings) options.openSettings()
    else focusCurrentPrompt()
  }

  function maybeShowOnboarding(): void {
    if (
      destroyed ||
      !enabled ||
      !current.length ||
      !onboardingLoaded ||
      onboardingAcknowledged ||
      onboardingOpen
    )
      return
    onboardingOpen = true
    setSettingsOpen(false)
    stopCountdown()
    updateVisibility()
    queueMicrotask(() => {
      if (!destroyed && onboardingOpen) onboardingAcknowledge.focus({ preventScroll: true })
    })
  }

  function loadOnboardingState(): void {
    if (!options.onboardingStorage) return
    void options.onboardingStorage.isAcknowledged().then(
      (acknowledged) => {
        if (destroyed) return
        onboardingLoaded = true
        onboardingAcknowledged = acknowledged
        maybeShowOnboarding()
        updateVisibility()
        ensureCountdown()
      },
      () => {
        if (destroyed) return
        onboardingLoaded = true
        onboardingAcknowledged = false
        maybeShowOnboarding()
        updateVisibility()
      },
    )
  }

  function renderSettings(): void {
    const values: Record<string, string> = {
      duration: `${promptDurationSeconds} 秒`,
      queue: `${queueLimit} 条`,
      scale: `${promptScalePercent}%`,
      threshold: `${threshold} 次`,
    }
    for (const [key, value] of Object.entries(values)) {
      const target = settingsPanel.querySelector<HTMLElement>(`[data-value="${key}"]`)
      if (target) target.textContent = value
    }
    launcher.title = `弹幕雷达 · ${threshold} 次触发 · 最多 ${queueLimit} 条`
  }

  function stopCountdown(): void {
    if (countdownTimer !== undefined) clearInterval(countdownTimer)
    countdownTimer = undefined
  }

  function updateCountdowns(): void {
    const now = Date.now()
    const expired = current.filter(
      (suggestion) => !leavingIds.has(suggestion.id) && (deadlines.get(suggestion.id) || 0) <= now,
    )
    for (const button of promptList.querySelectorAll<HTMLButtonElement>('[data-plus-one-id]')) {
      const deadline = deadlines.get(button.dataset.plusOneId || '') || now
      button.textContent = `+1 · ${Math.max(0, Math.ceil((deadline - now) / 1_000))}s`
    }
    for (const suggestion of expired) removeSuggestion(suggestion, 'dismiss')
  }

  function ensureCountdown(): void {
    stopCountdown()
    if (!current.length || !onboardingLoaded || !onboardingAcknowledged || onboardingOpen) return
    countdownTimer = setInterval(updateCountdowns, 250)
  }

  function removeSuggestion(
    suggestion: RepeatReminderSuggestion,
    action: 'dismiss' | 'plus-one',
  ): void {
    if (leavingIds.has(suggestion.id)) return
    leavingIds.add(suggestion.id)
    snoozed.set(suggestion.id, Date.now() + suggestion.windowMs)
    deadlines.delete(suggestion.id)
    if (action === 'plus-one') options.plusOne(suggestion)
    else options.dismiss(suggestion)

    const finish = (): void => {
      if (destroyed || !leavingIds.delete(suggestion.id)) return
      current = current.filter((item) => item.id !== suggestion.id)
      renderPrompts()
    }
    const prompt = [...promptList.querySelectorAll<HTMLElement>('.prompt')].find(
      (item) => item.dataset.suggestionId === suggestion.id,
    )
    const animation =
      prompt &&
      playPromptAnimation(
        prompt,
        [
          { opacity: 1, transform: 'translate3d(0, 0, 0) scale(1)' },
          { opacity: 0, transform: 'translate3d(10px, 0, 0) scale(0.98)' },
        ],
        PROMPT_EXIT_DURATION_MS,
      )
    if (!prompt || !animation) {
      finish()
      return
    }
    prompt.classList.add('is-leaving')
    void animation.finished.then(finish, finish)
  }

  function prefersReducedPromptMotion(): boolean {
    try {
      return window.matchMedia?.('(prefers-reduced-motion: reduce)').matches || false
    } catch {
      return false
    }
  }

  function playPromptAnimation(
    prompt: HTMLElement,
    keyframes: Keyframe[],
    duration: number,
  ): Animation | null {
    if (prefersReducedPromptMotion() || typeof prompt.animate !== 'function') return null
    try {
      const animation = prompt.animate(keyframes, {
        duration,
        easing: PROMPT_MOTION_EASING,
        fill: 'both',
      })
      void animation.finished.then(
        () => animation.cancel(),
        () => undefined,
      )
      return animation
    } catch {
      return null
    }
  }

  function activeSuggestion(prompt: HTMLElement): RepeatReminderSuggestion | undefined {
    return current.find((item) => item.id === prompt.dataset.suggestionId)
  }

  function createPrompt(): HTMLElement {
    const prompt = document.createElement('article')
    prompt.className = 'prompt'
    const copy = document.createElement('div')
    copy.className = 'prompt-copy'
    const label = document.createElement('small')
    const text = document.createElement('strong')
    const meta = document.createElement('span')
    meta.className = 'prompt-meta'
    const actions = document.createElement('footer')
    actions.className = 'prompt-actions'
    const dismiss = document.createElement('button')
    dismiss.type = 'button'
    dismiss.textContent = '暂不'
    dismiss.addEventListener('click', () => {
      const suggestion = activeSuggestion(prompt)
      if (suggestion) removeSuggestion(suggestion, 'dismiss')
    })
    const plusOne = document.createElement('button')
    plusOne.type = 'button'
    plusOne.className = 'is-primary'
    plusOne.addEventListener('click', () => {
      const suggestion = activeSuggestion(prompt)
      if (suggestion) removeSuggestion(suggestion, 'plus-one')
    })
    copy.append(label, text, meta)
    actions.append(dismiss, plusOne)
    prompt.append(copy, actions)
    return prompt
  }

  function updatePrompt(prompt: HTMLElement, suggestion: RepeatReminderSuggestion): void {
    prompt.dataset.suggestionId = suggestion.id
    prompt.classList.toggle('is-leaving', leavingIds.has(suggestion.id))
    const label = prompt.querySelector<HTMLElement>('.prompt-copy small')
    const text = prompt.querySelector<HTMLElement>('.prompt-copy strong')
    const meta = prompt.querySelector<HTMLElement>('.prompt-meta')
    const plusOne = prompt.querySelector<HTMLButtonElement>('.is-primary')
    if (label) label.textContent = `最近 ${Math.round(suggestion.windowMs / 1_000)} 秒达到阈值`
    if (text) {
      text.textContent = suggestion.text
      text.title = suggestion.text
    }
    if (meta)
      meta.textContent = `${suggestion.count} 次${suggestion.senders ? ` · ${suggestion.senders} 人` : ''}`
    if (plusOne) {
      plusOne.dataset.plusOneId = suggestion.id
      plusOne.textContent = `+1 · ${Math.max(
        0,
        Math.ceil(((deadlines.get(suggestion.id) || Date.now()) - Date.now()) / 1_000),
      )}s`
    }
  }

  function renderPrompts(): void {
    const existing = new Map(
      [...promptList.querySelectorAll<HTMLElement>('.prompt')].map(
        (prompt) => [prompt.dataset.suggestionId || '', prompt] as const,
      ),
    )
    const previousPositions = new Map<string, DOMRect>()
    for (const [id, prompt] of existing) {
      previousPositions.set(id, prompt.getBoundingClientRect())
      if (!leavingIds.has(id)) prompt.getAnimations?.().forEach((animation) => animation.cancel())
    }
    const nextPrompts = current.map((suggestion) => {
      const prompt = existing.get(suggestion.id) || createPrompt()
      updatePrompt(prompt, suggestion)
      return prompt
    })
    promptList.replaceChildren(...nextPrompts)
    updateVisibility()
    const promptScale = promptScalePercent / 100
    for (const prompt of nextPrompts) {
      const id = prompt.dataset.suggestionId || ''
      if (leavingIds.has(id)) continue
      const previousPosition = previousPositions.get(id)
      if (!previousPosition) {
        playPromptAnimation(
          prompt,
          [
            { opacity: 0, transform: 'translate3d(0, -10px, 0) scale(0.97)' },
            { opacity: 1, transform: 'translate3d(0, 0, 0) scale(1)' },
          ],
          PROMPT_ENTER_DURATION_MS,
        )
        continue
      }
      const nextPosition = prompt.getBoundingClientRect()
      const deltaX = (previousPosition.left - nextPosition.left) / promptScale
      const deltaY = (previousPosition.top - nextPosition.top) / promptScale
      if (Math.abs(deltaX) < 0.5 && Math.abs(deltaY) < 0.5) continue
      playPromptAnimation(
        prompt,
        [
          { transform: `translate3d(${deltaX}px, ${deltaY}px, 0)` },
          { transform: 'translate3d(0, 0, 0)' },
        ],
        PROMPT_MOVE_DURATION_MS,
      )
    }
    ensureCountdown()
  }

  let dragStartX = 0
  let dragStartY = 0
  let dragOriginX = 0
  let dragOriginY = 0
  let dragging = false
  let suppressClick = false

  const onDragMove = (event: PointerEvent): void => {
    if (!dragging) return
    const deltaX = event.clientX - dragStartX
    const deltaY = event.clientY - dragStartY
    if (Math.abs(deltaX) + Math.abs(deltaY) > 4) suppressClick = true
    launcherX = dragOriginX + deltaX
    launcherY = dragOriginY + deltaY
    positionFloatingUi()
    event.preventDefault()
    event.stopPropagation()
  }
  const onDragEnd = (event: PointerEvent): void => {
    if (!dragging) return
    dragging = false
    launcher.classList.remove('is-dragging')
    document.removeEventListener('pointermove', onDragMove, true)
    document.removeEventListener('pointerup', onDragEnd, true)
    event.stopPropagation()
  }
  launcher.addEventListener('pointerdown', (event) => {
    if (event.button !== 0) return
    dragging = true
    suppressClick = false
    dragStartX = event.clientX
    dragStartY = event.clientY
    dragOriginX = launcherX
    dragOriginY = launcherY
    launcher.classList.add('is-dragging')
    document.addEventListener('pointermove', onDragMove, true)
    document.addEventListener('pointerup', onDragEnd, true)
    event.preventDefault()
    event.stopPropagation()
  })

  const stopPointer = (event: Event): void => event.stopPropagation()
  ;[settingsPanel, promptList, onboarding].forEach((element) => {
    element.addEventListener('pointerdown', stopPointer)
    element.addEventListener('click', stopPointer)
  })
  launcher.addEventListener('click', (event) => {
    event.stopPropagation()
    if (suppressClick) {
      suppressClick = false
      return
    }
    setSettingsOpen(!settingsOpen)
  })
  settingsPanel
    .querySelector<HTMLButtonElement>('.open-settings')
    ?.addEventListener('click', () => {
      setSettingsOpen(false)
      options.openSettings()
    })
  onboardingAcknowledge.addEventListener('click', () => acknowledgeOnboarding(false))
  onboardingOpenSettings.addEventListener('click', () => acknowledgeOnboarding(true))
  onboardingCard.addEventListener('keydown', (event) => {
    if (event.key !== 'Tab') return
    const focusable = [onboardingOpenSettings, onboardingAcknowledge]
    const first = focusable[0]
    const last = focusable.at(-1)
    if (event.shiftKey && shadow.activeElement === first) {
      last?.focus()
      event.preventDefault()
    } else if (!event.shiftKey && shadow.activeElement === last) {
      first?.focus()
      event.preventDefault()
    }
  })
  const closeFromOutside = (event: Event): void => {
    if (settingsOpen && !event.composedPath().includes(portal)) setSettingsOpen(false)
  }
  const closeFromEscape = (event: KeyboardEvent): void => {
    if (event.key === 'Escape') setSettingsOpen(false)
  }
  const onResize = (): void => positionFloatingUi()
  document.addEventListener('pointerdown', closeFromOutside, true)
  document.addEventListener('keydown', closeFromEscape, true)
  window.addEventListener('resize', onResize)
  ensureHost()
  renderSettings()
  loadOnboardingState()

  return {
    applySettings(next: RepeatReminderUiSettings): void {
      const durationChanged = promptDurationSeconds !== next.promptDurationSeconds
      enabled = next.enabled
      promptDurationSeconds = next.promptDurationSeconds
      promptScalePercent = next.promptScalePercent
      queueLimit = next.queueLimit
      threshold = next.threshold
      promptList.style.setProperty('--bcp-repeat-prompt-scale', String(promptScalePercent / 100))
      launcher.classList.toggle('is-visible', enabled)
      current = current.slice(0, queueLimit)
      if (!enabled) {
        onboardingOpen = false
        setSettingsOpen(false)
        current = []
        deadlines.clear()
        leavingIds.clear()
      } else if (durationChanged) {
        const deadline = Date.now() + promptDurationSeconds * 1_000
        for (const suggestion of current) deadlines.set(suggestion.id, deadline)
      }
      renderSettings()
      renderPrompts()
      positionFloatingUi()
    },
    destroy(): void {
      destroyed = true
      stopCountdown()
      document.removeEventListener('pointerdown', closeFromOutside, true)
      document.removeEventListener('keydown', closeFromEscape, true)
      document.removeEventListener('pointermove', onDragMove, true)
      document.removeEventListener('pointerup', onDragEnd, true)
      window.removeEventListener('resize', onResize)
      portal.remove()
    },
    ensureHost,
    reset(): void {
      snoozed.clear()
      deadlines.clear()
      leavingIds.clear()
      current = []
      onboardingOpen = false
      setSettingsOpen(false)
      renderPrompts()
    },
    setSuggestions(suggestions: RepeatReminderSuggestion[]): void {
      ensureHost()
      if (!enabled) {
        current = []
        deadlines.clear()
        leavingIds.clear()
        renderPrompts()
        return
      }
      const now = Date.now()
      current = suggestions
        .filter((suggestion) => (snoozed.get(suggestion.id) || 0) <= now)
        .slice(0, queueLimit)
      const currentIds = new Set(current.map((suggestion) => suggestion.id))
      for (const id of leavingIds) {
        if (!currentIds.has(id)) leavingIds.delete(id)
      }
      for (const id of deadlines.keys()) {
        if (!currentIds.has(id)) deadlines.delete(id)
      }
      for (const suggestion of current) {
        if (!deadlines.has(suggestion.id))
          deadlines.set(suggestion.id, now + promptDurationSeconds * 1_000)
      }
      renderPrompts()
      maybeShowOnboarding()
    },
  }
}
