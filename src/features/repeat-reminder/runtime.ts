import type { DanmakuDescriptor, ExtensionSettings, PlatformId } from '../../core/types'
import { repeatReminderPlatformSettings } from '../../core/repeat-reminder-settings'
import { createRepeatReminderCollector, type RepeatReminderCollector } from './collector'
import { RepeatReminderDetector } from './detector'
import {
  adaptiveRepeatReminderThreshold,
  trafficRepeatReminderThreshold,
} from './adaptive-threshold'
import {
  LIVE_AUDIENCE_FRAME_READ,
  LIVE_AUDIENCE_FRAME_REPORT,
  LIVE_AUDIENCE_FRAME_STALE_MS,
  type LiveAudienceFrameResponse,
} from './audience-api'
import {
  isAdaptiveAudienceMetric,
  readLiveAudienceMetric,
} from './live-audience'
import type { LiveAudienceMetric } from './live-audience'
import {
  acknowledgeRepeatReminderOnboarding,
  hasAcknowledgedRepeatReminderOnboarding,
} from './onboarding'
import { RepeatReminderSelection } from './selection'
import { DanmakuTrafficMeter, type DanmakuTrafficSnapshot } from './traffic-flow'
import type { RepeatReminderObservation, RepeatReminderSuggestion } from './types'
import { createRepeatReminderUi } from './ui'

const AUDIENCE_THRESHOLD_GRACE_MS = 30_000
const TRAFFIC_THRESHOLD_EVALUATION_MS = 5_000
const TRAFFIC_THRESHOLD_RISE_CONFIRMATIONS = 2
const TRAFFIC_THRESHOLD_FALL_CONFIRMATIONS = 6
const AUTOMATIC_PLUS_ONE_GAP_MS = 1_100

interface RepeatReminderRuntimeOptions {
  describe?(element: Element, source: DanmakuDescriptor['source']): DanmakuDescriptor | null
  initialSettings: ExtensionSettings
  messageSelectors?: readonly string[]
  overlaySelectors?: readonly string[]
  platform: PlatformId
  plusOne(text: string): boolean | void | Promise<boolean | void>
  rootSelectors?: readonly string[]
  roomKey(): string
}

export interface RepeatReminderRuntime {
  applySettings(settings: ExtensionSettings): void
  destroy(): void
  ingest(observation: RepeatReminderObservation): void
  scan(): void
  suppressText(text: string): void
}

export function createRepeatReminderRuntime(
  options: RepeatReminderRuntimeOptions,
): RepeatReminderRuntime {
  let settings = options.initialSettings
  let roomKey = options.roomKey()
  let wasEnabled = false
  let audienceSignature = ''
  let frameAudience: LiveAudienceMetric | null = null
  let frameRequestPending = false
  let nextFrameRequestAt = 0
  let reportedFrameAudienceAt = 0
  let reportedFrameAudienceSignature = ''
  let smoothedAudience: number | null = null
  let smoothedAudienceSampleKey = ''
  let lastAudienceSeenAt = 0
  let nextTrafficThresholdEvaluationAt = 0
  let trafficRiseConfirmations = 0
  let trafficRiseTarget = 0
  let trafficFallConfirmations = 0
  let trafficFallTarget = 0
  let destroyed = false
  let automaticPlusOneChain = Promise.resolve()
  let lastAutomaticPlusOneAt = Number.NEGATIVE_INFINITY
  let effectiveThreshold = initialEffectiveThreshold()
  const detector = new RepeatReminderDetector(effectiveThreshold)
  const trafficMeter = new DanmakuTrafficMeter()
  const selection = new RepeatReminderSelection(platformSettings().queueLimit)

  function forgetSuggestionText(text: string): void {
    trafficMeter.forgetText(text)
    const removedIds = new Set(detector.forgetText(text))
    for (const suggestion of selection.current()) {
      if (removedIds.has(suggestion.id)) selection.dismiss(suggestion)
    }
  }

  const ui = createRepeatReminderUi({
    automaticPlusOne: queueAutomaticPlusOne,
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
    refresh: refreshSuggestions,
    setAutoPlusOne: updateAutoPlusOne,
  })

  function queueAutomaticPlusOne(suggestion: RepeatReminderSuggestion): void {
    selection.dismiss(suggestion)
    const text = suggestion.text
    automaticPlusOneChain = automaticPlusOneChain
      .catch(() => undefined)
      .then(async () => {
        if (destroyed || !enabled() || !settings.repeatReminder.autoPlusOne) return
        const wait = Math.max(0, lastAutomaticPlusOneAt + AUTOMATIC_PLUS_ONE_GAP_MS - Date.now())
        if (wait > 0) await new Promise((resolve) => setTimeout(resolve, wait))
        if (destroyed || !enabled() || !settings.repeatReminder.autoPlusOne) return
        try {
          await options.plusOne(text)
        } catch {
          // Platform senders already surface their own failure feedback.
        } finally {
          lastAutomaticPlusOneAt = Date.now()
        }
      })
  }

  function updateAutoPlusOne(next: boolean): void {
    if (settings.repeatReminder.autoPlusOne === next) return
    settings = {
      ...settings,
      repeatReminder: { ...settings.repeatReminder, autoPlusOne: next },
    }
    syncUi()
    try {
      void globalThis.chrome?.storage?.sync?.set({ repeatReminder: settings.repeatReminder })
    } catch {
      /* Keep the in-page choice active when sync storage is unavailable. */
    }
  }

  function refreshSuggestions(): void {
    ui.setSuggestions(ownsPrompt() ? selection.current() : [])
  }

  function enabled(): boolean {
    return Boolean(
      settings.enabled &&
      settings.platforms[options.platform] &&
      (settings.actions.plusOne || settings.repeatReminder.autoPlusOne) &&
      settings.repeatReminder.enabled,
    )
  }

  function automaticMode(): boolean {
    return settings.repeatReminder.mode === 'auto'
  }

  function platformSettings() {
    return repeatReminderPlatformSettings(settings.repeatReminder, options.platform)
  }

  function initialEffectiveThreshold(): number {
    const selected = platformSettings()
    return automaticMode()
      ? adaptiveRepeatReminderThreshold(options.platform, selected.threshold, null)
      : selected.threshold
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
      trafficMeter.reset()
      lastAudienceSeenAt = 0
      smoothedAudience = null
      smoothedAudienceSampleKey = ''
      resetTrafficThresholdHysteresis()
      setEffectiveThreshold(initialEffectiveThreshold())
      selection.reset()
      ui.reset()
    }
    wasEnabled = nextEnabled
    const visible = nextEnabled && ownsPrompt()
    const selected = platformSettings()
    ui.applySettings({
      autoPlusOne: settings.repeatReminder.autoPlusOne,
      enabled: visible,
      mode: settings.repeatReminder.mode,
      promptDurationSeconds: selected.promptDurationSeconds,
      promptScalePercent: selected.promptScalePercent,
      queueLimit: selected.queueLimit,
      threshold: effectiveThreshold,
    })
    ui.setSuggestions(visible ? selection.current() : [])
    syncAudience()
  }

  function syncAudience(): void {
    const now = Date.now()
    const isOwner = ownsPrompt()
    if (!automaticMode()) {
      audienceSignature = ''
      frameAudience = null
      ui.setAudience(null)
      ui.setTraffic(null)
      resetTrafficThresholdHysteresis()
      setEffectiveThreshold(platformSettings().threshold)
      return
    }
    if (enabled() && isOwner) {
      void requestFrameAudience(now)
    } else if (enabled()) {
      reportFrameAudience(now)
    }
    const frameFresh = frameAudience
      && now - (frameAudience.sampledAt || 0) <= LIVE_AUDIENCE_FRAME_STALE_MS
    const rawMetric = enabled() && isOwner
      ? frameFresh
        ? frameAudience
        : readLiveAudienceMetric(options.platform)
      : null
    const metric = isAdaptiveAudienceMetric(rawMetric) ? rawMetric : null
    const traffic = trafficMeter.snapshot(now)
    const signature = metric
      ? `${metric.platform}:${metric.kind}:${metric.source || ''}:${metric.value}:${metric.rawText}`
      : ''
    if (signature !== audienceSignature) {
      audienceSignature = signature
      ui.setAudience(metric)
    }
    ui.setTraffic(metric ? null : traffic)
    if (metric) {
      lastAudienceSeenAt = now
      resetTrafficThresholdHysteresis()
      const thresholdMetric = smoothedThresholdMetric(metric)
      setEffectiveThreshold(adaptiveRepeatReminderThreshold(
        options.platform,
        platformSettings().threshold,
        thresholdMetric,
      ))
      return
    }
    if (lastAudienceSeenAt && now - lastAudienceSeenAt <= AUDIENCE_THRESHOLD_GRACE_MS) return
    syncTrafficThreshold(traffic, now)
  }

  function setEffectiveThreshold(next: number): void {
    if (next === effectiveThreshold) return
    effectiveThreshold = next
    detector.setThreshold(effectiveThreshold)
    ui.setThreshold(effectiveThreshold)
  }

  function resetTrafficThresholdHysteresis(): void {
    nextTrafficThresholdEvaluationAt = 0
    trafficRiseConfirmations = 0
    trafficRiseTarget = 0
    trafficFallConfirmations = 0
    trafficFallTarget = 0
  }

  function syncTrafficThreshold(traffic: DanmakuTrafficSnapshot, now: number): void {
    if (now < nextTrafficThresholdEvaluationAt) return
    nextTrafficThresholdEvaluationAt = now + TRAFFIC_THRESHOLD_EVALUATION_MS
    const target = trafficRepeatReminderThreshold(
      options.platform,
      platformSettings().threshold,
      traffic,
    )
    if (target === effectiveThreshold) {
      trafficRiseConfirmations = 0
      trafficFallConfirmations = 0
      return
    }
    if (target > effectiveThreshold) {
      trafficFallConfirmations = 0
      trafficFallTarget = 0
      if (trafficRiseTarget !== target) {
        trafficRiseTarget = target
        trafficRiseConfirmations = 1
      } else {
        trafficRiseConfirmations += 1
      }
      if (trafficRiseConfirmations < TRAFFIC_THRESHOLD_RISE_CONFIRMATIONS) return
      trafficRiseConfirmations = 0
      setEffectiveThreshold(Math.min(target, effectiveThreshold + 2))
      return
    }
    trafficRiseConfirmations = 0
    trafficRiseTarget = 0
    if (trafficFallTarget !== target) {
      trafficFallTarget = target
      trafficFallConfirmations = 1
    } else {
      trafficFallConfirmations += 1
    }
    if (trafficFallConfirmations < TRAFFIC_THRESHOLD_FALL_CONFIRMATIONS) return
    trafficFallConfirmations = 0
    setEffectiveThreshold(Math.max(target, effectiveThreshold - 1))
  }

  function smoothedThresholdMetric(metric: LiveAudienceMetric | null): LiveAudienceMetric | null {
    if (!isAdaptiveAudienceMetric(metric)) return null
    const sampleKey = `${metric.platform}:${metric.kind}:${metric.value}:${metric.sampledAt || Date.now()}`
    if (sampleKey !== smoothedAudienceSampleKey) {
      smoothedAudienceSampleKey = sampleKey
      smoothedAudience = smoothedAudience === null
        ? metric.value
        : Math.round(smoothedAudience * 0.8 + metric.value * 0.2)
    }
    return { ...metric, value: smoothedAudience ?? metric.value }
  }

  function reportFrameAudience(now: number): void {
    if (options.platform !== 'bilibili') return
    const sendMessage = globalThis.chrome?.runtime?.sendMessage
    if (!sendMessage) return
    const metric = readLiveAudienceMetric('bilibili')
    if (!metric) return
    const signature = `${metric.value}:${metric.rawText}`
    if (signature === reportedFrameAudienceSignature
      && now - reportedFrameAudienceAt < 2_000) return
    reportedFrameAudienceSignature = signature
    reportedFrameAudienceAt = now
    void sendMessage({
      metric,
      platform: 'bilibili',
      type: LIVE_AUDIENCE_FRAME_REPORT,
    }).catch(() => undefined)
  }

  async function requestFrameAudience(now: number): Promise<void> {
    const sendMessage = globalThis.chrome?.runtime?.sendMessage
    if (options.platform !== 'bilibili' || !sendMessage
      || frameRequestPending || now < nextFrameRequestAt) return
    frameRequestPending = true
    nextFrameRequestAt = now + 1_000
    try {
      const response = await sendMessage({
        platform: 'bilibili',
        type: LIVE_AUDIENCE_FRAME_READ,
      }) as LiveAudienceFrameResponse | undefined
      if (destroyed) return
      frameAudience = response?.ok && response.metric ? response.metric : null
      syncAudience()
    } catch {
      if (!destroyed) frameAudience = null
    } finally {
      frameRequestPending = false
    }
  }

  function checkRoom(syncWhenUnchanged = true): void {
    const next = options.roomKey()
    if (next === roomKey) {
      if (syncWhenUnchanged) syncAudience()
      return
    }
    const now = Date.now()
    roomKey = next
    audienceSignature = ''
    frameAudience = null
    nextFrameRequestAt = 0
    reportedFrameAudienceAt = 0
    reportedFrameAudienceSignature = ''
    smoothedAudience = null
    smoothedAudienceSampleKey = ''
    lastAudienceSeenAt = 0
    trafficMeter.reset(now)
    resetTrafficThresholdHysteresis()
    detector.clear()
    selection.reset()
    ui.reset()
    setEffectiveThreshold(initialEffectiveThreshold())
    collector?.scan()
    syncAudience()
  }

  function ingest(observation: RepeatReminderObservation): void {
    checkRoom(false)
    if (!enabled()) return
    const now = Date.now()
    if (automaticMode()) trafficMeter.ingest(observation, now)
    if (!detector.ingest(observation, now)) return
    const triggered = detector.triggeredSuggestion(observation, now)
    if (!triggered) return
    const selected = selection.replace(triggered)
    if (!selected) return
    if (settings.repeatReminder.autoPlusOne) {
      ui.plusOneAutomatically(selected)
      return
    }
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
      rootSelectors: options.rootSelectors,
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
      const previous = platformSettings()
      const previousMode = settings.repeatReminder.mode
      settings = next
      const selected = platformSettings()
      if (previousMode !== settings.repeatReminder.mode
        || previous.threshold !== selected.threshold) {
        resetTrafficThresholdHysteresis()
        setEffectiveThreshold(initialEffectiveThreshold())
      }
      selection.setLimit(selected.queueLimit)
      collector?.setEnabled(enabled())
      syncUi()
    },
    destroy(): void {
      destroyed = true
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
    suppressText(text): void {
      forgetSuggestionText(text)
      ui.setSuggestions(ownsPrompt() ? selection.current() : [])
    },
  }
}
