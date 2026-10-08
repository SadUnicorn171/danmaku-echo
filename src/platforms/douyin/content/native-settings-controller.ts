import { detectPlatform } from '../../../core/shared'
import type { DouyinNativeSettings, ExtensionSettings } from '../../../core/types'

type Key = keyof DouyinNativeSettings
type Panel = 'danmaku-setting-icon' | 'gift-setting'
const ANCHORS = '[data-e2e="danmaku-setting-icon"], [data-e2e="gift-setting"]'
const SWITCH = '[role="switch"], input[type="checkbox"], ._h3OuAw5'
const RULES: { key: Key; panel: Panel; label?: string; selector?: string; checked: boolean }[] = [
  { key: 'hideGiftMessages', panel: 'danmaku-setting-icon', label: '送礼信息', checked: false },
  { key: 'hideLuckyBagCommands', panel: 'danmaku-setting-icon', label: '福袋口令', checked: false },
  {
    key: 'blockGiftEffects',
    panel: 'gift-setting',
    selector: '[data-e2e="effect-switch"]',
    checked: true,
  },
]

/** Prefer semantic state; class fallback is limited to the supplied native switch structure. */
function checked(control: HTMLElement): boolean | null {
  if (control instanceof HTMLInputElement && control.type === 'checkbox') return control.checked
  const aria = control.getAttribute('aria-checked')
  if (aria === 'true' || aria === 'false') return aria === 'true'
  const state = control.getAttribute('data-state')
  if (state === 'checked' || state === 'unchecked') return state === 'checked'
  const thumb = control.querySelector(':scope > .FCG9Aotc')
  if (!control.classList.contains('_h3OuAw5') || !thumb) return null
  const active = control.classList.contains('G9q7tTop')
  return active === thumb.classList.contains('frP5WL3d') ? active : null
}

function findControl(root: HTMLElement, rule: (typeof RULES)[number]): HTMLElement | null {
  if (rule.selector) {
    const wrapper = root.querySelector<HTMLElement>(rule.selector)
    return wrapper?.matches(SWITCH) ? wrapper : wrapper?.querySelector<HTMLElement>(SWITCH) || null
  }
  // Never search chat text or unrelated player controls for these labels.
  for (const label of root.querySelectorAll('span')) {
    if (label.textContent?.trim() !== rule.label) continue
    let row = label.parentElement
    for (let depth = 0; row && row !== root && depth < 3; depth++, row = row.parentElement) {
      const controls = row.querySelectorAll<HTMLElement>(SWITCH)
      if (controls.length === 1) return controls[0]!
      if (controls.length > 1) break
    }
  }
  return null
}

export function createDouyinNativeSettingsController(options: {
  document: Document
  href(): string
  settings(): ExtensionSettings
  onUnavailable?(key: Key): void
}) {
  const doc = options.document
  let running = false
  let discovery: MutationObserver | undefined
  let scheduled = false
  let generation = 0
  let signature = ''
  let opened: { anchor: HTMLElement; timer: ReturnType<typeof setTimeout> } | undefined
  let hovered = new WeakSet<HTMLElement>()
  let attempted = new WeakSet<HTMLElement>()
  const attempts = new Map<Key, number>()
  const reported = new Set<Key>()
  const roots = new Map<
    HTMLElement,
    { anchor: HTMLElement; panel: Panel; observer: MutationObserver }
  >()

  function active(): boolean {
    const settings = options.settings()
    const url = new URL(options.href())
    return (
      running &&
      settings.enabled &&
      settings.platforms.douyin &&
      detectPlatform(url.hostname, url.pathname) === 'douyin' &&
      Object.values(settings.douyinNativeSettings).some(Boolean)
    )
  }
  function report(key: Key): void {
    if (reported.has(key)) return
    reported.add(key)
    options.onUnavailable?.(key)
  }
  function hover(anchor: HTMLElement, enter: boolean): void {
    const relatedTarget = doc.body
    for (const type of enter ? ['mouseover', 'mouseenter'] : ['mouseout', 'mouseleave']) {
      anchor.dispatchEvent(
        new MouseEvent(type, {
          bubbles: type === 'mouseover' || type === 'mouseout',
          relatedTarget,
        }),
      )
    }
  }
  function closeOpened(): void {
    if (!opened) return
    const { anchor, timer } = opened
    opened = undefined
    clearTimeout(timer)
    // Do not close a panel the user's real pointer has entered in the meantime.
    if (anchor.isConnected && !anchor.parentElement?.matches(':hover')) hover(anchor, false)
  }
  function schedule(): void {
    if (scheduled || !active()) return
    scheduled = true
    const version = generation
    queueMicrotask(() => {
      if (version !== generation) return
      scheduled = false
      if (active()) reconcile()
    })
  }
  function reconcile(): void {
    const prefs = options.settings().douyinNativeSettings
    for (const [root, entry] of roots) {
      if (!root.isConnected || !entry.anchor.isConnected) {
        entry.observer.disconnect()
        roots.delete(root)
        continue
      }
      const rules = RULES.filter((rule) => rule.panel === entry.panel && prefs[rule.key])
      let missing = false
      let settled = true
      for (const rule of rules) {
        const control = findControl(root, rule)
        if (!control) {
          missing = true
          settled = false
          continue
        }
        const state = checked(control)
        if (state === rule.checked) {
          attempts.delete(rule.key)
          continue
        }
        settled = false
        if (state === null || control.closest('[disabled], [aria-disabled="true"]')) {
          report(rule.key)
          continue
        }
        if (attempted.has(control) || (attempts.get(rule.key) || 0) >= 3) {
          report(rule.key)
          continue
        }
        attempted.add(control)
        attempts.set(rule.key, (attempts.get(rule.key) || 0) + 1)
        control.click()
        // Verify the resulting DOM on the next turn; never flip the same node blindly.
        schedule()
      }
      if (opened?.anchor === entry.anchor && settled) closeOpened()
      if (missing && !opened && !hovered.has(entry.anchor)) {
        hovered.add(entry.anchor)
        // This timeout only closes our temporary hover. Applying settings is mutation-driven.
        const timer = setTimeout(() => {
          if (opened?.anchor !== entry.anchor) return
          for (const rule of rules) if (!findControl(root, rule)) report(rule.key)
          closeOpened()
          schedule()
        }, 1200)
        opened = { anchor: entry.anchor, timer }
        hover(entry.anchor, true)
        break // Lazy panels can be mutually exclusive; open one at a time.
      }
    }
  }
  function discover(node: ParentNode): void {
    let added = false
    const anchors = [
      ...(node instanceof HTMLElement && node.matches(ANCHORS) ? [node] : []),
      ...node.querySelectorAll<HTMLElement>(ANCHORS),
    ]
    for (const anchor of anchors) {
      const root = anchor.parentElement
      if (
        !root ||
        root === doc.body ||
        root === doc.documentElement ||
        roots.has(root) ||
        roots.size >= 8
      )
        continue
      const observer = new MutationObserver(schedule)
      observer.observe(root, {
        childList: true,
        subtree: true,
        attributes: true,
        attributeFilter: ['class', 'aria-checked', 'data-state', 'disabled', 'aria-disabled'],
      })
      roots.set(root, { anchor, panel: anchor.dataset.e2e as Panel, observer })
      added = true
    }
    if (added) schedule()
  }
  function disconnect(): void {
    generation++
    scheduled = false
    discovery?.disconnect()
    discovery = undefined
    for (const entry of roots.values()) entry.observer.disconnect()
    roots.clear()
    closeOpened()
  }
  function refresh(): void {
    disconnect()
    hovered = new WeakSet()
    attempted = new WeakSet()
    attempts.clear()
    reported.clear()
    if (!active()) return
    discover(doc)
    discovery = new MutationObserver((records) => {
      // Only inspect newly added subtrees for native setting anchors. No document polling.
      for (const [root, entry] of roots)
        if (!root.isConnected || !entry.anchor.isConnected) {
          entry.observer.disconnect()
          roots.delete(root)
        }
      for (const record of records)
        for (const node of record.addedNodes) {
          if (node instanceof HTMLElement) discover(node)
        }
    })
    discovery.observe(doc.documentElement, { childList: true, subtree: true })
  }
  return {
    start(): void {
      if (!running) {
        running = true
        refresh()
      }
    },
    destroy(): void {
      running = false
      disconnect()
    },
    routeChanged: refresh,
    applySettings(): void {
      const settings = options.settings()
      const next = JSON.stringify([
        settings.enabled,
        settings.platforms.douyin,
        settings.douyinNativeSettings,
      ])
      if (signature === next) return
      signature = next
      refresh()
    },
  }
}
