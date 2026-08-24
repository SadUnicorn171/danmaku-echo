import type { DanmakuDescriptor, ExtensionSettings, PlatformId } from '../../core/types'
import { createRepeatReminderCollector, type RepeatReminderCollector } from './collector'
import { RepeatReminderDetector } from './detector'
import {
  acknowledgeRepeatReminderOnboarding,
  hasAcknowledgedRepeatReminderOnboarding,
} from './onboarding'
import { RepeatReminderSelection } from './selection'
import type { RepeatReminderObservation } from './types'
import { createRepeatReminderUi } from './ui'

interface RepeatReminderRuntimeOptions {
  describe?(element: Element, source: DanmakuDescriptor['source']): DanmakuDescriptor | null
  initialSettings: ExtensionSettings
  messageSelectors?: readonly string[]
  overlaySelectors?: readonly string[]
  platform: PlatformId
  plusOne(text: string): boolean | void | Promise<boolean | void>
  roomKey(): string
}

export interface RepeatReminderRuntime {
  applySettings(settings: ExtensionSettings): void
  destroy(): void
  ingest(observation: RepeatReminderObservation): void
  scan(): void
}

export function createRepeatReminderRuntime(
  options: RepeatReminderRuntimeOptions,
): RepeatReminderRuntime {
  let settings = options.initialSettings
  let roomKey = options.roomKey()
  let wasEnabled = false
  const detector = new RepeatReminderDetector(settings.repeatReminder.threshold)
  const selection = new RepeatReminderSelection(settings.repeatReminder.queueLimit)
  const ui = createRepeatReminderUi({
    onboardingStorage: {
      acknowledge: acknowledgeRepeatReminderOnboarding,
      isAcknowledged: hasAcknowledgedRepeatReminderOnboarding,
    },
    dismiss: (suggestion) => selection.dismiss(suggestion),
    openSettings: () => {
      try {
        void globalThis.chrome?.runtime?.openOptionsPage?.()
      } catch {
        /* Extension page unavailable. */
      }
    },
    plusOne: (suggestion) => {
      selection.dismiss(suggestion)
      void options.plusOne(suggestion.text)
    },
  })

  function enabled(): boolean {
    return Boolean(
      settings.enabled &&
      settings.platforms[options.platform] &&
      settings.actions.plusOne &&
      settings.repeatReminder.enabled,
    )
  }

  function ownsPrompt(): boolean {
    try {
      return window.top === window || Boolean(document.fullscreenElement)
    } catch {
      return Boolean(document.fullscreenElement)
    }
  }

  function syncUi(): void {
    const nextEnabled = enabled()
    if (wasEnabled && !nextEnabled) {
      detector.clear()
      selection.reset()
      ui.reset()
    }
    wasEnabled = nextEnabled
    const visible = nextEnabled && ownsPrompt()
    ui.applySettings({
      enabled: visible,
      promptDurationSeconds: settings.repeatReminder.promptDurationSeconds,
      promptScalePercent: settings.repeatReminder.promptScalePercent,
      queueLimit: settings.repeatReminder.queueLimit,
      threshold: settings.repeatReminder.threshold,
    })
    ui.setSuggestions(visible ? selection.current() : [])
  }

  function checkRoom(): void {
    const next = options.roomKey()
    if (next === roomKey) return
    roomKey = next
    detector.clear()
    selection.reset()
    ui.reset()
    collector?.scan()
  }

  function ingest(observation: RepeatReminderObservation): void {
    checkRoom()
    if (!enabled()) return
    if (!detector.ingest(observation, Date.now())) return
    const triggered = detector.triggeredSuggestion(observation, Date.now())
    if (!triggered) return
    const selected = selection.replace(triggered)
    if (!selected) return
    ui.setSuggestions(ownsPrompt() ? selection.current() : [])
  }

  let collector: RepeatReminderCollector | null = null
  if (options.describe && options.messageSelectors && options.overlaySelectors) {
    collector = createRepeatReminderCollector({
      describe: options.describe,
      enabled,
      messageSelectors: options.messageSelectors,
      observation: ingest,
      overlaySelectors: options.overlaySelectors,
    })
  }

  const onFullscreenChange = (): void => {
    ui.ensureHost()
    syncUi()
  }
  document.addEventListener('fullscreenchange', onFullscreenChange, true)
  document.addEventListener('webkitfullscreenchange', onFullscreenChange, true)
  const routeTimer = setInterval(checkRoom, 1_000)
  syncUi()

  return {
    applySettings(next): void {
      settings = next
      detector.setThreshold(settings.repeatReminder.threshold)
      selection.setLimit(settings.repeatReminder.queueLimit)
      collector?.setEnabled(enabled())
      syncUi()
    },
    destroy(): void {
      clearInterval(routeTimer)
      collector?.destroy()
      ui.destroy()
      document.removeEventListener('fullscreenchange', onFullscreenChange, true)
      document.removeEventListener('webkitfullscreenchange', onFullscreenChange, true)
    },
    ingest,
    scan(): void {
      collector?.scan()
    },
  }
}
