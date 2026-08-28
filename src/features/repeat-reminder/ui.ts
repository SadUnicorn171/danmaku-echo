import { REPEAT_REMINDER_HIT_REGIONS_ATTRIBUTE } from './pointer-guard'
import {
  formatLiveAudienceMetric,
  type LiveAudienceMetric,
} from './live-audience'
import type { DanmakuTrafficLevel, DanmakuTrafficSnapshot } from './traffic-flow'
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
  mode?: 'auto' | 'manual'
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

const ONBOARDING_BELL_ICON = `
  <svg viewBox="0 0 24 24" aria-hidden="true">
    <path d="M18 8a6 6 0 0 0-12 0c0 7-3 7-3 9h18c0-2-3-2-3-9"></path>
    <path d="M10 21h4"></path>
  </svg>
`

const ONBOARDING_LIST_ICON = `
  <svg viewBox="0 0 24 24" aria-hidden="true">
    <path d="M10 6h11M10 12h11M10 18h11"></path>
    <path d="M4 6h1v4M4 10h2M6 18H4c0-1 2-1.5 2-3a2 2 0 0 0-4 0"></path>
  </svg>
`

const ONBOARDING_SETTINGS_ICON = `
  <svg viewBox="0 0 24 24" aria-hidden="true">
    <path d="M4 7h10M18 7h2M4 17h2M10 17h10M14 4v6M6 14v6"></path>
  </svg>
`

const ONBOARDING_CHECK_ICON = `
  <svg viewBox="0 0 24 24" aria-hidden="true">
    <circle cx="12" cy="12" r="9"></circle>
    <path d="m8 12 2.5 2.5L16 9"></path>
  </svg>
`

const ONBOARDING_MOVE_ICON = `
  <svg viewBox="0 0 24 24" aria-hidden="true">
    <path d="M12 2v20M2 12h20M9 5l3-3 3 3M9 19l3 3 3-3M5 9l-3 3 3 3M19 9l3 3-3 3"></path>
  </svg>
`

const LAUNCHER_SIZE = 46
const PROMPT_ENTER_DURATION_MS = 220
const PROMPT_EXIT_DURATION_MS = 160
const PROMPT_MOVE_DURATION_MS = 260
const PROMPT_MOTION_EASING = 'cubic-bezier(0.22, 1, 0.36, 1)'
const VIEWPORT_GAP = 12
const ONBOARDING_GAP = 18
const ONBOARDING_MAX_WIDTH = 460
const REPEAT_REMINDER_OWNER_ATTRIBUTE = 'data-bcp-repeat-reminder-owner'
const REPEAT_REMINDER_OWNER_TOKEN_ATTRIBUTE = 'data-bcp-repeat-reminder-owner-token'
const REPEAT_REMINDER_PORTAL_SELECTOR = '[data-bcp-repeat-reminder-owned]'
const NUMBER_FORMATTER = new Intl.NumberFormat('zh-CN', { maximumFractionDigits: 0 })

const TRAFFIC_LEVEL_LABELS: Record<DanmakuTrafficLevel, string> = {
  active: '活跃',
  extreme: '极高流量',
  high: '高流量',
  low: '较低',
  normal: '正常',
  quiet: '安静',
  'very-high': '超高流量',
}

function repeatReminderOwnerToken(): string {
  try {
    return crypto.randomUUID()
  } catch {
    return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`
  }
}

export function createRepeatReminderUi(options: RepeatReminderUiOptions) {
  const ownerToken = repeatReminderOwnerToken()
  const portal = document.createElement('div')
  portal.dataset.bcpRepeatReminderOwned = 'true'
  portal.setAttribute(REPEAT_REMINDER_OWNER_TOKEN_ATTRIBUTE, ownerToken)
  portal.style.setProperty('all', 'initial', 'important')
  portal.style.setProperty('position', 'fixed', 'important')
  portal.style.setProperty('inset', '0', 'important')
  portal.style.setProperty('pointer-events', 'none', 'important')
  portal.style.setProperty('z-index', '2147483647', 'important')
  const shadow = portal.attachShadow({ mode: 'open' })
  const style = document.createElement('style')
  style.textContent = `
    :host { all: initial; font-family: "Noto Sans SC", "Microsoft YaHei UI", "PingFang SC", system-ui, sans-serif; }
    *, *::before, *::after { box-sizing: border-box; }
    button { font-family: inherit; }
    .launcher { align-items: center; background: rgb(255 255 255 / 96%); border: 1px solid rgb(23 24 29 / 12%); border-radius: 14px; box-shadow: 0 10px 28px rgb(23 24 29 / 20%); color: #ff7a00; cursor: grab; display: none; height: 46px; justify-content: center; padding: 0; pointer-events: auto; position: fixed; touch-action: none; transition: border-color 140ms ease, box-shadow 140ms ease; user-select: none; width: 46px; }
    .launcher.is-visible { display: flex; }
    .launcher:hover, .launcher[aria-expanded="true"] { border-color: rgb(255 122 0 / 42%); box-shadow: 0 12px 32px rgb(23 24 29 / 25%); }
    .launcher.is-onboarding, .launcher.is-onboarding:hover { border-color: #ff7a00; box-shadow: 0 0 0 5px rgb(255 255 255 / 94%), 0 0 0 9px rgb(255 122 0 / 72%), 0 14px 34px rgb(17 18 22 / 28%); cursor: default; z-index: 12; }
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
    .setting-value.is-audience { align-items: center; flex-direction: row; grid-column: 1 / -1; justify-content: space-between; min-height: 42px; }
    .setting-value small { color: #8b8f9c; font-size: 10px; }
    .setting-value strong { color: #ff7a00; font: 650 12px/17px ui-monospace, Consolas, monospace; }
    .setting-value.is-audience strong { color: #12a96b; font-size: 13px; text-align: right; }
    .open-settings { background: transparent; border: 0; border-top: 1px solid rgb(23 24 29 / 9%); color: #565a66; cursor: pointer; font-size: 11px; margin-top: 12px; padding: 10px 2px 0; text-align: left; width: 100%; }
    .open-settings:hover { color: #ff7a00; }
    .onboarding { background: rgb(17 18 22 / 28%); backdrop-filter: blur(3px); display: none; inset: 0; pointer-events: auto; position: fixed; z-index: 10; }
    .onboarding.is-visible { display: block; }
    .onboarding-card { animation: onboarding-enter 220ms cubic-bezier(0.22, 1, 0.36, 1); color: #1f2937; pointer-events: auto; position: fixed; width: min(460px, calc(100vw - 32px)); z-index: 1; }
    .onboarding-body { background: #fff; border: 1px solid #e5e7eb; border-radius: 16px; box-shadow: 0 12px 32px rgb(31 41 55 / 12%); display: flex; flex-direction: column; max-height: calc(100vh - 32px); overflow: auto; position: relative; z-index: 1; }
    .onboarding-accent { background: var(--bcp-selection, #f97316); border-radius: 999px; height: 4px; left: 50%; position: absolute; top: 8px; transform: translateX(-50%); width: 40px; }
    .onboarding-arrow { background: #fff; display: block; filter: drop-shadow(1px 1px 1px rgb(31 41 55 / 12%)); height: 16px; pointer-events: none; position: absolute; width: 16px; z-index: 2; }
    .onboarding-card[data-placement='left'] .onboarding-arrow { clip-path: polygon(0 0, 100% 50%, 0 100%); right: -15px; top: var(--bcp-onboarding-arrow-y, 24px); transform: translateY(-50%); }
    .onboarding-card[data-placement='right'] .onboarding-arrow { clip-path: polygon(100% 0, 0 50%, 100% 100%); left: -15px; top: var(--bcp-onboarding-arrow-y, 24px); transform: translateY(-50%); }
    .onboarding-card[data-placement='below'] .onboarding-arrow { clip-path: polygon(0 100%, 50% 0, 100% 100%); left: var(--bcp-onboarding-arrow-x, 24px); top: -15px; transform: translateX(-50%); }
    .onboarding-card[data-placement='above'] .onboarding-arrow { bottom: -15px; clip-path: polygon(0 0, 50% 100%, 100% 0); left: var(--bcp-onboarding-arrow-x, 24px); transform: translateX(-50%); }
    .onboarding-head { display: flex; flex-direction: column; gap: 6px; padding: 20px; }
    .onboarding-eyebrow { align-items: center; color: var(--bcp-selection, #f97316); display: flex; font-size: 12px; font-weight: 600; gap: 6px; letter-spacing: 1px; line-height: 18px; }
    .onboarding-eyebrow-icon { align-items: center; display: flex; flex: 0 0 14px; height: 14px; justify-content: center; }
    .onboarding-eyebrow-icon svg { fill: none; height: 14px; stroke: currentColor; stroke-linecap: round; stroke-linejoin: round; stroke-width: 1.75; width: 14px; }
    .onboarding-eyebrow-icon svg .is-filled { fill: currentColor; stroke: none; }
    .onboarding h2 { color: #1f2937; font-size: 20px; font-weight: 700; line-height: 28px; margin: 0; }
    .onboarding-description { color: #6b7280; font-size: 13px; line-height: 21px; margin: 0; }
    .onboarding-divider { background: #e5e7eb; flex: 0 0 1px; height: 1px; }
    .onboarding-content { display: flex; flex-direction: column; gap: 16px; padding: 20px; }
    .onboarding-features { display: flex; flex-direction: column; gap: 10px; }
    .onboarding-feature { align-items: flex-start; display: flex; gap: 10px; }
    .onboarding-feature-icon { align-items: center; background: #fff1e6; border-radius: 10px; color: var(--bcp-selection, #f97316); display: flex; flex: 0 0 32px; height: 32px; justify-content: center; }
    .onboarding-feature-icon svg, .onboarding-settings-title svg, .onboarding-note svg, .onboarding-setting-list svg { fill: none; stroke: currentColor; stroke-linecap: round; stroke-linejoin: round; }
    .onboarding-feature-icon svg { height: 16px; stroke-width: 1.8; width: 16px; }
    .onboarding-feature-copy { display: flex; flex-direction: column; gap: 2px; min-width: 0; }
    .onboarding-feature-copy strong { color: #1f2937; font-size: 13px; font-weight: 600; line-height: 19px; }
    .onboarding-feature-copy span { color: #6b7280; font-size: 12px; line-height: 18px; }
    .onboarding-settings { display: flex; flex-direction: column; gap: 10px; }
    .onboarding-settings-title { align-items: center; color: #1f2937; display: flex; font-size: 13px; font-weight: 600; gap: 6px; line-height: 19px; margin: 0; }
    .onboarding-settings-title svg { color: var(--bcp-selection, #f97316); height: 16px; stroke-width: 1.8; width: 16px; }
    .onboarding-setting-list { display: grid; gap: 10px 12px; grid-template-columns: repeat(2, minmax(0, 1fr)); list-style: none; margin: 0; padding: 0; }
    .onboarding-setting-list li { align-items: center; color: #6b7280; display: flex; font-size: 12px; gap: 6px; line-height: 18px; min-width: 0; }
    .onboarding-setting-list svg { color: var(--bcp-selection, #f97316); flex: 0 0 14px; height: 14px; stroke-width: 1.8; width: 14px; }
    .onboarding-note { align-items: flex-start; background: #fff1e6; border-radius: 10px; color: #6b7280; display: flex; font-size: 12px; gap: 10px; line-height: 18px; padding: 12px; }
    .onboarding-note svg { color: var(--bcp-selection, #f97316); flex: 0 0 16px; height: 16px; margin-top: 1px; stroke-width: 1.8; width: 16px; }
    .onboarding-actions { display: flex; gap: 12px; justify-content: flex-end; padding: 16px 20px 20px; }
    .onboarding-actions button { border-radius: 10px; cursor: pointer; font-size: 14px; font-weight: 600; height: 44px; padding: 0 16px; }
    .onboarding-open-settings { background: #fff; border: 1px solid #e5e7eb; color: #1f2937; width: 112px; }
    .onboarding-open-settings:hover { border-color: rgb(249 115 22 / 45%); color: #c4510d; }
    .onboarding-acknowledge { background: var(--bcp-selection, #f97316); border: 1px solid var(--bcp-selection, #f97316); color: #fff; width: 104px; }
    .onboarding-acknowledge:hover { filter: brightness(0.95); }
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
      .onboarding-head, .onboarding-content { padding-left: 16px; padding-right: 16px; }
      .onboarding-setting-list { grid-template-columns: 1fr; }
      .onboarding-actions { flex-direction: column-reverse; padding: 14px 16px 16px; }
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
      <span class="setting-value is-audience"><small data-audience-label>直播间人数</small><strong data-value="audience">识别中…</strong></span>
      <span class="setting-value"><small>触发次数</small><strong data-value="threshold">6 次</strong></span>
      <span class="setting-value"><small>提示停留</small><strong data-value="duration">10 秒</strong></span>
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
      data-placement="left"
      role="dialog"
      aria-modal="true"
      aria-labelledby="bcp-repeat-onboarding-title"
      aria-describedby="bcp-repeat-onboarding-description"
    >
      <span class="onboarding-arrow" aria-hidden="true"></span>
      <div class="onboarding-body">
        <span class="onboarding-accent" aria-hidden="true"></span>
        <header class="onboarding-head">
          <span class="onboarding-eyebrow">
            <span class="onboarding-eyebrow-icon">${RADAR_ICON}</span>
            <span>这里是弹幕雷达</span>
          </span>
          <h2 id="bcp-repeat-onboarding-title">认识弹幕雷达</h2>
          <p id="bcp-repeat-onboarding-description" class="onboarding-description">
            箭头指向的按钮就是弹幕雷达。它会观察最近一分钟内重复出现的文字弹幕，达到设定次数后生成 +1 提示队列。
          </p>
        </header>
        <span class="onboarding-divider" aria-hidden="true"></span>
        <div class="onboarding-content">
          <div class="onboarding-features">
            <div class="onboarding-feature">
              <span class="onboarding-feature-icon">${ONBOARDING_BELL_ICON}</span>
              <span class="onboarding-feature-copy">
                <strong>只提醒，不自动发送</strong>
                <span>只有用户点击 +1 后，插件才会发送对应弹幕。</span>
              </span>
            </div>
            <div class="onboarding-feature">
              <span class="onboarding-feature-icon">${ONBOARDING_LIST_ICON}</span>
              <span class="onboarding-feature-copy">
                <strong>高频内容进入队列</strong>
                <span>每条提示独立倒计时，用户可以选择 +1 或暂不处理。</span>
              </span>
            </div>
          </div>
          <section class="onboarding-settings" aria-labelledby="bcp-repeat-onboarding-settings-title">
            <h3 id="bcp-repeat-onboarding-settings-title" class="onboarding-settings-title">
              ${ONBOARDING_SETTINGS_ICON}
              <span>可调整设置</span>
            </h3>
            <ul class="onboarding-setting-list">
              <li>${ONBOARDING_CHECK_ICON}<span>开启或关闭弹幕雷达</span></li>
              <li>${ONBOARDING_CHECK_ICON}<span>自动或手动档位</span></li>
              <li>${ONBOARDING_CHECK_ICON}<span>四个平台的独立触发次数</span></li>
              <li>${ONBOARDING_CHECK_ICON}<span>提示停留时间</span></li>
              <li>${ONBOARDING_CHECK_ICON}<span>队列上限</span></li>
              <li>${ONBOARDING_CHECK_ICON}<span>提示框大小</span></li>
            </ul>
          </section>
          <div class="onboarding-note">
            ${ONBOARDING_MOVE_ICON}
            <span>以后可以点击雷达按钮查看当前设置，也可以拖动它调整位置。</span>
          </div>
        </div>
        <footer class="onboarding-actions">
          <button type="button" class="onboarding-open-settings">进入设置</button>
          <button type="button" class="onboarding-acknowledge">知道了</button>
        </footer>
      </div>
    </section>
  `
  const onboardingCard = onboarding.querySelector<HTMLElement>('.onboarding-card')!
  const onboardingBody = onboarding.querySelector<HTMLElement>('.onboarding-body')!
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
  let audience: LiveAudienceMetric | null = null
  let traffic: DanmakuTrafficSnapshot | null = null
  let mode: 'auto' | 'manual' = 'auto'
  let promptDurationSeconds = 10
  let promptScalePercent = 100
  let queueLimit = 3
  let threshold = 5
  let launcherX = Math.max(VIEWPORT_GAP, window.innerWidth - LAUNCHER_SIZE - 18)
  let launcherY = 18
  let countdownTimer: ReturnType<typeof setInterval> | undefined
  let destroyed = false
  let ownershipClaimed = false
  let ownershipLost = false
  let ownershipObserver: MutationObserver | undefined
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

  function positionOnboarding(): void {
    if (!onboardingOpen) return
    const viewportWidth = Math.max(0, window.innerWidth)
    const viewportHeight = Math.max(0, window.innerHeight)
    const fallbackWidth = Math.min(ONBOARDING_MAX_WIDTH, Math.max(240, viewportWidth - 32))
    onboardingBody.style.maxHeight = `${Math.max(220, viewportHeight - 32)}px`
    const rect = onboardingCard.getBoundingClientRect()
    const cardWidth = rect.width || fallbackWidth
    const cardHeight = rect.height || Math.min(440, Math.max(220, viewportHeight - 32))
    const launcherCenterX = launcherX + LAUNCHER_SIZE / 2
    const launcherCenterY = launcherY + LAUNCHER_SIZE / 2
    const spaceLeft = launcherX - VIEWPORT_GAP
    const spaceRight = viewportWidth - launcherX - LAUNCHER_SIZE - VIEWPORT_GAP
    const spaceBelow = viewportHeight - launcherY - LAUNCHER_SIZE - VIEWPORT_GAP
    let left = VIEWPORT_GAP
    let top = VIEWPORT_GAP
    let placement: 'above' | 'below' | 'left' | 'right'

    if (spaceLeft >= cardWidth + ONBOARDING_GAP) {
      placement = 'left'
      left = launcherX - cardWidth - ONBOARDING_GAP
      top = clamp(
        launcherCenterY - cardHeight / 2,
        VIEWPORT_GAP,
        viewportHeight - cardHeight - VIEWPORT_GAP,
      )
    } else if (spaceRight >= cardWidth + ONBOARDING_GAP) {
      placement = 'right'
      left = launcherX + LAUNCHER_SIZE + ONBOARDING_GAP
      top = clamp(
        launcherCenterY - cardHeight / 2,
        VIEWPORT_GAP,
        viewportHeight - cardHeight - VIEWPORT_GAP,
      )
    } else if (spaceBelow >= 220 || spaceBelow >= launcherY) {
      placement = 'below'
      left = clamp(
        launcherCenterX - cardWidth / 2,
        VIEWPORT_GAP,
        viewportWidth - cardWidth - VIEWPORT_GAP,
      )
      top = launcherY + LAUNCHER_SIZE + ONBOARDING_GAP
      onboardingBody.style.maxHeight = `${Math.max(180, viewportHeight - top - VIEWPORT_GAP)}px`
    } else {
      placement = 'above'
      left = clamp(
        launcherCenterX - cardWidth / 2,
        VIEWPORT_GAP,
        viewportWidth - cardWidth - VIEWPORT_GAP,
      )
      onboardingBody.style.maxHeight = `${Math.max(180, launcherY - ONBOARDING_GAP - VIEWPORT_GAP)}px`
      const availableHeight = Math.min(cardHeight, launcherY - ONBOARDING_GAP - VIEWPORT_GAP)
      top = Math.max(VIEWPORT_GAP, launcherY - ONBOARDING_GAP - availableHeight)
    }

    onboardingCard.dataset.placement = placement
    onboardingCard.style.left = `${Math.round(left)}px`
    onboardingCard.style.top = `${Math.round(top)}px`
    if (placement === 'left' || placement === 'right') {
      onboardingCard.style.removeProperty('--bcp-onboarding-arrow-x')
      onboardingCard.style.setProperty(
        '--bcp-onboarding-arrow-y',
        `${Math.round(clamp(launcherCenterY - top, 20, Math.max(20, cardHeight - 20)))}px`,
      )
    } else {
      onboardingCard.style.removeProperty('--bcp-onboarding-arrow-y')
      onboardingCard.style.setProperty(
        '--bcp-onboarding-arrow-x',
        `${Math.round(clamp(launcherCenterX - left, 20, Math.max(20, cardWidth - 20)))}px`,
      )
    }
  }

  function positionFloatingUi(): void {
    if (destroyed || ownershipLost) return
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
    positionOnboarding()
    publishHitRegions()
  }

  function ownsDocumentUi(): boolean {
    return document.documentElement?.getAttribute(REPEAT_REMINDER_OWNER_ATTRIBUTE) === ownerToken
  }

  function removeCompetingPortals(): void {
    if (!ownsDocumentUi()) return
    document.querySelectorAll(REPEAT_REMINDER_PORTAL_SELECTOR).forEach((candidate) => {
      if (candidate !== portal) candidate.remove()
    })
  }

  function loseOwnership(): void {
    if (ownershipLost) return
    ownershipLost = true
    stopCountdown()
    ownershipObserver?.disconnect()
    ownershipObserver = undefined
    portal.remove()
  }

  function claimOwnership(): boolean {
    const root = document.documentElement
    if (!root || destroyed || ownershipLost) return false
    if (!ownershipClaimed) {
      ownershipClaimed = true
      root.setAttribute(REPEAT_REMINDER_OWNER_ATTRIBUTE, ownerToken)
      ownershipObserver = new MutationObserver(() => {
        if (!ownsDocumentUi()) {
          loseOwnership()
          return
        }
        removeCompetingPortals()
      })
      ownershipObserver.observe(root, { childList: true, subtree: true })
    }
    if (!ownsDocumentUi()) {
      loseOwnership()
      return false
    }
    removeCompetingPortals()
    return true
  }

  function ensureHost(): void {
    if (!claimOwnership()) return
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
    launcher.classList.toggle('is-onboarding', onboardingOpen)
    positionOnboarding()
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
      if (destroyed || ownershipLost || onboardingOpen) return
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
        if (destroyed || ownershipLost) return
        onboardingLoaded = true
        onboardingAcknowledged = acknowledged
        maybeShowOnboarding()
        updateVisibility()
        ensureCountdown()
      },
      () => {
        if (destroyed || ownershipLost) return
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

  function renderAudience(): void {
    const label = settingsPanel.querySelector<HTMLElement>('[data-audience-label]')
    const value = settingsPanel.querySelector<HTMLElement>('[data-value="audience"]')
    if (mode === 'manual') {
      if (label) label.textContent = '雷达档位'
      if (value) {
        value.textContent = '手动'
        value.title = '当前平台使用扩展主页中单独保存的雷达参数'
      }
      return
    }
    if (label) label.textContent = audience?.label || (traffic ? '弹幕流量' : '直播间人数')
    if (value) {
      if (audience) {
        value.textContent = formatLiveAudienceMetric(audience)
        value.title = audience.kind === 'guests'
          ? '平台页面公开的直播间贵宾数，仅用于调整雷达阈值'
          : '平台页面公开的实时观众人数'
      } else if (traffic) {
        value.textContent = traffic.ready
          ? `约 ${NUMBER_FORMATTER.format(traffic.rate)} 条/分`
          : `分析中… ${traffic.messageCount}/15`
        value.title = traffic.ready
          ? `无法获取人数，当前按弹幕流量调节；等级：${TRAFFIC_LEVEL_LABELS[traffic.level]}`
          : '无法获取人数，积累至少 20 秒且 15 条有效弹幕后启用流量调节'
      } else {
        value.textContent = formatLiveAudienceMetric(null)
        value.title = '等待平台观众、贵宾数或弹幕流量样本出现'
      }
    }
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
  renderAudience()
  loadOnboardingState()

  return {
    applySettings(next: RepeatReminderUiSettings): void {
      if (destroyed || ownershipLost) return
      const durationChanged = promptDurationSeconds !== next.promptDurationSeconds
      enabled = next.enabled
      mode = next.mode === 'manual' ? 'manual' : 'auto'
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
      renderAudience()
      renderPrompts()
      positionFloatingUi()
    },
    destroy(): void {
      if (destroyed) return
      destroyed = true
      stopCountdown()
      ownershipObserver?.disconnect()
      ownershipObserver = undefined
      if (ownsDocumentUi()) {
        document.documentElement?.removeAttribute(REPEAT_REMINDER_OWNER_ATTRIBUTE)
      }
      document.removeEventListener('pointerdown', closeFromOutside, true)
      document.removeEventListener('keydown', closeFromEscape, true)
      document.removeEventListener('pointermove', onDragMove, true)
      document.removeEventListener('pointerup', onDragEnd, true)
      window.removeEventListener('resize', onResize)
      portal.remove()
    },
    ensureHost,
    reset(): void {
      if (destroyed || ownershipLost) return
      snoozed.clear()
      deadlines.clear()
      leavingIds.clear()
      current = []
      audience = null
      traffic = null
      onboardingOpen = false
      setSettingsOpen(false)
      renderAudience()
      renderPrompts()
    },
    setAudience(next: LiveAudienceMetric | null): void {
      if (destroyed || ownershipLost) return
      audience = next
      renderAudience()
    },
    setTraffic(next: DanmakuTrafficSnapshot | null): void {
      if (destroyed || ownershipLost) return
      traffic = next
      renderAudience()
    },
    setThreshold(next: number): void {
      if (destroyed || ownershipLost) return
      threshold = next
      renderSettings()
    },
    setSuggestions(suggestions: RepeatReminderSuggestion[]): void {
      ensureHost()
      if (destroyed || ownershipLost) return
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
