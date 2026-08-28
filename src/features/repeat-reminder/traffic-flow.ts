import { normalizeRepeatReminderText } from './similarity'
import type { RepeatReminderObservation } from './types'

export const DANMAKU_TRAFFIC_WINDOW_MS = 60_000
export const DANMAKU_TRAFFIC_BURST_WINDOW_MS = 10_000
export const DANMAKU_TRAFFIC_WARMUP_MS = 20_000
export const DANMAKU_TRAFFIC_MIN_MESSAGES = 15

const CROSS_SOURCE_WINDOW_MS = 3_000
const MAX_SENDER_MESSAGES_PER_MINUTE = 12
const MAX_SAMPLES = 10_000

export type DanmakuTrafficLevel =
  | 'quiet'
  | 'low'
  | 'normal'
  | 'active'
  | 'high'
  | 'very-high'
  | 'extreme'

export interface DanmakuTrafficSnapshot {
  burstRate: number
  level: DanmakuTrafficLevel
  messageCount: number
  rate: number
  ready: boolean
  senderCoverage: number
  stableRate: number
}

interface TrafficSample {
  at: number
  sender: string
  textKey: string
}

interface FingerprintRecord {
  at: number
  matched: boolean
  sender: string
  source: RepeatReminderObservation['source']
}

function clamp(value: number, minimum: number, maximum: number): number {
  return Math.min(maximum, Math.max(minimum, value))
}

function senderKey(observation: RepeatReminderObservation): string {
  const id = normalizeRepeatReminderText(observation.senderId)
  if (id) return `id:${id}`
  const name = normalizeRepeatReminderText(observation.senderName)
  return name ? `name:${name}` : ''
}

function trafficTextKey(observation: RepeatReminderObservation): string {
  const text = normalizeRepeatReminderText(observation.text)
  const resources = observation.resourceIds
    .map((resource) => normalizeRepeatReminderText(resource))
    .filter(Boolean)
    .sort()
    .join(',')
  return `${text}|${resources}`
}

function trafficLevel(rate: number): DanmakuTrafficLevel {
  if (rate <= 30) return 'quiet'
  if (rate <= 120) return 'low'
  if (rate <= 300) return 'normal'
  if (rate <= 700) return 'active'
  if (rate <= 1_500) return 'high'
  if (rate <= 3_000) return 'very-high'
  return 'extreme'
}

function senderCompatible(first: string, second: string): boolean {
  return !first || !second || first === second
}

export class DanmakuTrafficMeter {
  private fingerprints = new Map<string, FingerprintRecord[]>()
  private messageIds = new Map<string, number>()
  private samples: TrafficSample[] = []
  private startedAt: number

  constructor(now = Date.now()) {
    this.startedAt = now
  }

  ingest(observation: RepeatReminderObservation, now = Date.now()): boolean {
    const textKey = trafficTextKey(observation)
    if (textKey === '|') return false
    const sender = senderKey(observation)
    const messageId = String(observation.messageId || '').trim()
    if (messageId) {
      const previous = this.messageIds.get(messageId)
      if (previous !== undefined && now - previous <= DANMAKU_TRAFFIC_WINDOW_MS) return false
      this.messageIds.set(messageId, now)
    }

    const records = (this.fingerprints.get(textKey) || [])
      .filter((record) => now - record.at <= CROSS_SOURCE_WINDOW_MS)
    const mirrored = records.find(
      (record) => !record.matched
        && record.source !== observation.source
        && senderCompatible(record.sender, sender),
    )
    if (mirrored) {
      mirrored.matched = true
      this.fingerprints.set(textKey, records)
      return false
    }
    records.push({ at: now, matched: false, sender, source: observation.source })
    this.fingerprints.set(textKey, records)
    this.samples.push({ at: now, sender, textKey })
    if (this.samples.length > MAX_SAMPLES) {
      this.samples.splice(0, this.samples.length - MAX_SAMPLES)
    }
    return true
  }

  forgetText(value: unknown): void {
    const key = normalizeRepeatReminderText(value)
    if (!key) return
    this.samples = this.samples.filter((sample) => !sample.textKey.startsWith(`${key}|`))
  }

  reset(now = Date.now()): void {
    this.fingerprints.clear()
    this.messageIds.clear()
    this.samples = []
    this.startedAt = now
  }

  snapshot(now = Date.now()): DanmakuTrafficSnapshot {
    this.prune(now)
    const messageCount = this.samples.length
    const identified = this.samples.filter((sample) => sample.sender).length
    const senderCoverage = messageCount ? identified / messageCount : 0
    const senderCounts = new Map<string, number>()
    let cappedCount = 0
    for (const sample of this.samples) {
      if (!sample.sender) {
        cappedCount += 1
        continue
      }
      const count = senderCounts.get(sample.sender) || 0
      senderCounts.set(sample.sender, count + 1)
      if (count < MAX_SENDER_MESSAGES_PER_MINUTE) cappedCount += 1
    }
    const stableRate = senderCoverage >= 0.6
      ? messageCount * 0.7 + cappedCount * 0.3
      : messageCount
    const burstCount = this.samples.filter(
      (sample) => sample.at >= now - DANMAKU_TRAFFIC_BURST_WINDOW_MS,
    ).length
    const burstRate = burstCount * (DANMAKU_TRAFFIC_WINDOW_MS / DANMAKU_TRAFFIC_BURST_WINDOW_MS)
    const boundedBurst = stableRate > 0
      ? clamp(burstRate, stableRate * 0.5, stableRate * 2)
      : 0
    const rate = Math.round(stableRate * 0.7 + boundedBurst * 0.3)
    return {
      burstRate: Math.round(burstRate),
      level: trafficLevel(rate),
      messageCount,
      rate,
      ready: now - this.startedAt >= DANMAKU_TRAFFIC_WARMUP_MS
        && messageCount >= DANMAKU_TRAFFIC_MIN_MESSAGES,
      senderCoverage,
      stableRate: Math.round(stableRate),
    }
  }

  private prune(now: number): void {
    const earliest = now - DANMAKU_TRAFFIC_WINDOW_MS
    this.samples = this.samples.filter((sample) => sample.at >= earliest)
    this.messageIds.forEach((at, id) => {
      if (at < earliest) this.messageIds.delete(id)
    })
    this.fingerprints.forEach((records, key) => {
      const recent = records.filter((record) => now - record.at <= CROSS_SOURCE_WINDOW_MS)
      if (recent.length) this.fingerprints.set(key, recent)
      else this.fingerprints.delete(key)
    })
  }
}
