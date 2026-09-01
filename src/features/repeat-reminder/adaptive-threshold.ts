import {
  MAX_REPEAT_REMINDER_THRESHOLD,
  MIN_REPEAT_REMINDER_THRESHOLD,
  normalizeRepeatReminderThreshold,
} from '../../core/repeat-reminder-settings'
import type { PlatformId } from '../../core/types'
import type { LiveAudienceMetric } from './live-audience'
import type { DanmakuTrafficSnapshot } from './traffic-flow'

export function platformRepeatReminderBaseThreshold(
  platform: PlatformId,
  configuredThreshold: unknown,
): number {
  const configured = normalizeRepeatReminderThreshold(configuredThreshold)
  const offset = platform === 'huya' || platform === 'douyu' ? 2 : 0
  return Math.min(MAX_REPEAT_REMINDER_THRESHOLD, configured + offset)
}

export function audienceThresholdMultiplier(viewers: number): number {
  if (viewers <= 500) return 0.8
  if (viewers <= 3_000) return 1
  if (viewers <= 5_000) return 1.2
  if (viewers <= 10_000) return 1.35
  if (viewers <= 20_000) return 1.5
  if (viewers <= 50_000) return 1.7
  if (viewers <= 100_000) return 1.9
  return 2.2
}

export function guestThresholdMultiplier(guests: number): number {
  if (guests <= 100) return 1
  if (guests <= 500) return 1.4
  if (guests <= 2_000) return 1.8
  return 2.2
}

export function trafficThresholdMultiplier(messagesPerMinute: number): number {
  if (messagesPerMinute <= 30) return 0.8
  if (messagesPerMinute <= 120) return 1
  if (messagesPerMinute <= 300) return 1.25
  if (messagesPerMinute <= 700) return 1.5
  if (messagesPerMinute <= 1_500) return 1.8
  if (messagesPerMinute <= 3_000) return 2.2
  return 2.6
}

export function trafficRepeatReminderThreshold(
  platform: PlatformId,
  configuredThreshold: unknown,
  traffic: DanmakuTrafficSnapshot,
): number {
  const base = platformRepeatReminderBaseThreshold(platform, configuredThreshold)
  const multiplier = traffic.ready ? trafficThresholdMultiplier(traffic.rate) : 1
  return Math.min(
    MAX_REPEAT_REMINDER_THRESHOLD,
    Math.max(MIN_REPEAT_REMINDER_THRESHOLD, Math.round(base * multiplier)),
  )
}

export function adaptiveRepeatReminderThreshold(
  platform: PlatformId,
  configuredThreshold: unknown,
  audience: LiveAudienceMetric | null,
): number {
  const base = platformRepeatReminderBaseThreshold(platform, configuredThreshold)
  const matchesPlatform = audience?.platform === platform
  const multiplier = matchesPlatform
    && audience.kind === 'guests'
    && (platform === 'huya' || platform === 'douyu')
    ? guestThresholdMultiplier(audience.value)
    : matchesPlatform
        && audience.kind === 'viewers'
        && platform !== 'huya'
        && platform !== 'douyu'
      ? audienceThresholdMultiplier(audience.value)
      : 1
  return Math.min(
    MAX_REPEAT_REMINDER_THRESHOLD,
    Math.max(MIN_REPEAT_REMINDER_THRESHOLD, Math.round(base * multiplier)),
  )
}
