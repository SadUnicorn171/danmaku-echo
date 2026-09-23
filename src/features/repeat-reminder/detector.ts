import {
  DEFAULT_REPEAT_REMINDER_THRESHOLD,
  normalizeRepeatReminderThreshold,
} from '../../core/repeat-reminder-settings'
import { ExpirationQueue } from './expiration-queue'
import type { RepeatReminderObservation, RepeatReminderSuggestion } from './types'
import {
  comparePreparedRepeatReminderTexts,
  canonicalRepeatReminderText,
  normalizeRepeatReminderText,
  prepareRepeatReminderText,
  type PreparedRepeatReminderText,
  repeatReminderSimilarityBuckets,
} from './similarity'

export const REPEAT_REMINDER_WINDOW = 60_000

const CROSS_SOURCE_WINDOW = 3_000
const MESSAGE_ID_TTL = 10 * 60_000

interface FingerprintRecord {
  key: string
  at: number
  matched: boolean
  sender: string
  source: RepeatReminderObservation['source']
}

interface WindowEntry {
  at: number
  key: string
  sender: string
  text: string
  sequence: number
}

interface RepeatGroup {
  entries: Set<WindowEntry>
  senderCounts: Map<string, number>
  count: number
  latestAt: number
  recognizedSenderCount: number
  senders: Set<string>
  text: string
}

interface SimilarityCluster {
  anchor: string
  buckets: string[]
  id: string
  keys: Set<string>
  latestAt: number
}

function hashValue(value: string): string {
  let hash = 2166136261
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index)
    hash = Math.imul(hash, 16777619)
  }
  return (hash >>> 0).toString(36)
}

function senderKey(observation: RepeatReminderObservation): string {
  const id = normalizeRepeatReminderText(observation.senderId)
  if (id) return `id:${id}`
  const name = normalizeRepeatReminderText(observation.senderName)
  return name ? `name:${name}` : ''
}

function senderCompatible(first: string, second: string): boolean {
  return !first || !second || first === second
}

function plainTextKey(observation: RepeatReminderObservation): string {
  if (!observation.text.trim() || observation.parts.some((part) => part.type !== 'text')) return ''
  return normalizeRepeatReminderText(observation.text)
}

export class RepeatReminderDetector {
  private groupIndex = new Map<string, RepeatGroup>()
  private entryExpiry = new ExpirationQueue<WindowEntry>()
  private fingerprintExpiry = new ExpirationQueue<FingerprintRecord>()
  private messageIdExpiry = new ExpirationQueue<string>()
  private clusterExpiry = new ExpirationQueue<string>()
  private sequence = 0
  private fingerprints = new Map<string, Set<FingerprintRecord>>()
  private messageIds = new Map<string, number>()
  private clusters = new Map<string, SimilarityCluster>()
  private clusterIndex = new Map<string, Set<string>>()
  private keyClusters = new Map<string, string>()
  private lastSuggestedRepresentative = new Map<string, string>()
  private profiles = new Map<string, PreparedRepeatReminderText>()
  private threshold: number

  constructor(threshold = DEFAULT_REPEAT_REMINDER_THRESHOLD) {
    this.threshold = normalizeRepeatReminderThreshold(threshold)
  }

  clear(): void {
    this.profiles.clear()
    this.groupIndex.clear()
    this.entryExpiry.clear()
    this.fingerprintExpiry.clear()
    this.messageIdExpiry.clear()
    this.clusterExpiry.clear()
    this.sequence = 0
    this.fingerprints.clear()
    this.messageIds.clear()
    this.clusters.clear()
    this.clusterIndex.clear()
    this.keyClusters.clear()
    this.lastSuggestedRepresentative.clear()
  }

  setThreshold(threshold: number): void {
    this.threshold = normalizeRepeatReminderThreshold(threshold)
  }

  forgetText(value: unknown): string[] {
    const key = normalizeRepeatReminderText(value)
    if (!key) return []
    this.profiles.delete(key)
    const group = this.groupIndex.get(key)
    group?.entries.forEach((entry) => this.entryExpiry.delete(entry))
    this.groupIndex.delete(key)
    this.fingerprints.get(key)?.forEach((record) => this.fingerprintExpiry.delete(record))
    this.fingerprints.delete(key)
    const clusterId = this.keyClusters.get(key)
    if (!clusterId) return []
    this.keyClusters.delete(key)
    const cluster = this.clusters.get(clusterId)
    if (!cluster) return [clusterId]
    cluster.keys.delete(key)
    this.lastSuggestedRepresentative.delete(clusterId)
    for (const bucket of cluster.buckets) {
      const ids = this.clusterIndex.get(bucket)
      ids?.delete(clusterId)
      if (!ids?.size) this.clusterIndex.delete(bucket)
    }
    if (!cluster.keys.size) {
      this.clusters.delete(clusterId)
      this.clusterExpiry.delete(clusterId)
      return [clusterId]
    }
    cluster.anchor = cluster.keys.values().next().value || ''
    cluster.buckets = repeatReminderSimilarityBuckets(cluster.anchor)
    for (const bucket of cluster.buckets) {
      const ids = this.clusterIndex.get(bucket) || new Set<string>()
      ids.add(clusterId)
      this.clusterIndex.set(bucket, ids)
    }
    return [clusterId]
  }

  ingest(observation: RepeatReminderObservation, now = Date.now()): boolean {
    this.prune(now)
    const key = plainTextKey(observation)
    if (!key) return false
    const messageId = String(observation.messageId || '').trim()
    if (messageId) {
      const previous = this.messageIds.get(messageId)
      if (previous !== undefined && now - previous <= MESSAGE_ID_TTL) return false
      this.messageIds.set(messageId, observation.observedAt)
      this.messageIdExpiry.set(messageId, observation.observedAt + MESSAGE_ID_TTL)
    }

    const sender = senderKey(observation)
    const records = this.fingerprints.get(key) || new Set<FingerprintRecord>()
    for (const record of records) {
      if (!record.matched && record.source !== observation.source && senderCompatible(record.sender, sender)) {
        record.matched = true
        return false
      }
    }
    const record = { key, at: observation.observedAt, matched: false, sender, source: observation.source }
    records.add(record)
    this.fingerprints.set(key, records)
    this.fingerprintExpiry.set(record, record.at + CROSS_SOURCE_WINDOW)
    const entry = { at: observation.observedAt, key, sender, text: observation.text.trim(), sequence: this.sequence++ }
    this.entryExpiry.set(entry, entry.at + REPEAT_REMINDER_WINDOW)
    const group = this.groupIndex.get(key) || {
      count: 0, latestAt: 0, recognizedSenderCount: 0, senders: new Set<string>(),
      senderCounts: new Map<string, number>(), entries: new Set<WindowEntry>(), text: entry.text,
    }
    group.entries.add(entry)
    group.count++
    if (entry.at >= group.latestAt) { group.latestAt = entry.at; group.text = entry.text }
    if (sender) {
      group.recognizedSenderCount++
      group.senders.add(sender)
      group.senderCounts.set(sender, (group.senderCounts.get(sender) || 0) + 1)
    }
    this.groupIndex.set(key, group)
    return true
  }

  suggestion(now = Date.now()): RepeatReminderSuggestion | null {
    const groups = this.groups(now)
    // Rebuilt groups used first surviving arrival order. Preserve it for tied clusters.
    const ordered = [...groups.entries()].sort(([, first], [, second]) =>
      first.entries.values().next().value!.sequence - second.entries.values().next().value!.sequence)
    for (const [key] of ordered) this.resolveCluster(key, now)
    const suggestions = Array.from(this.clusters.values())
      .map((cluster) => this.clusterSuggestion(cluster, groups))
      .filter((suggestion): suggestion is RepeatReminderSuggestion => Boolean(suggestion))
      .sort((first, second) => second.count - first.count || second.senders - first.senders)
    return suggestions[0] || null
  }

  triggeredSuggestion(observation: RepeatReminderObservation, now = Date.now()): RepeatReminderSuggestion | null {
    const key = plainTextKey(observation)
    if (!key) return null
    const groups = this.groups(now)
    const group = groups.get(key)
    if (!group) return null
    const cluster = this.resolveCluster(key, now)
    const representative = this.clusterRepresentative(cluster, groups)
    if (!representative || !this.clusterQualified(cluster, groups)) return null
    const previousRepresentative = this.lastSuggestedRepresentative.get(cluster.id)
    const shouldEmit = group.count === this.threshold
      || Boolean(previousRepresentative && representative[0] === key)
      || Boolean(previousRepresentative && previousRepresentative !== representative[0])
    if (!shouldEmit) return null
    this.lastSuggestedRepresentative.set(cluster.id, representative[0])
    return this.toSuggestion(cluster.id, representative[1])
  }

  private groups(now: number): Map<string, RepeatGroup> {
    this.prune(now)
    return this.groupIndex
  }

  private profile(key: string): PreparedRepeatReminderText {
    const cached = this.profiles.get(key)
    if (cached) return cached
    const profile = prepareRepeatReminderText(key)
    if (this.profiles.size >= 512) this.profiles.delete(this.profiles.keys().next().value!)
    this.profiles.set(key, profile)
    return profile
  }

  private resolveCluster(key: string, now: number): SimilarityCluster {
    const existingId = this.keyClusters.get(key)
    if (existingId) {
      const existing = this.clusters.get(existingId)!
      existing.latestAt = now
      this.clusterExpiry.set(existing.id, now + MESSAGE_ID_TTL)
      return existing
    }
    let best: { cluster: SimilarityCluster; score: number } | null = null
    const buckets = repeatReminderSimilarityBuckets(key)
    const candidateIds = new Set<string>()
    for (const bucket of buckets) {
      for (const id of this.clusterIndex.get(bucket) || []) candidateIds.add(id)
    }
    const profile = candidateIds.size ? this.profile(key) : null
    for (const id of candidateIds) {
      const cluster = this.clusters.get(id)
      if (!cluster) continue
      const { score, similar } = comparePreparedRepeatReminderTexts(profile!, this.profile(cluster.anchor))
      if (!similar) continue
      if (!best || score > best.score) best = { cluster, score }
    }
    const cluster = best?.cluster || (() => {
      const canonical = canonicalRepeatReminderText(key)
      const id = `repeat-${hashValue(canonical)}`
      const created = { anchor: key, buckets, id, keys: new Set<string>(), latestAt: now }
      this.clusters.set(id, created)
      for (const bucket of buckets) {
        const ids = this.clusterIndex.get(bucket) || new Set<string>()
        ids.add(id)
        this.clusterIndex.set(bucket, ids)
      }
      return created
    })()
    cluster.keys.add(key)
    cluster.latestAt = now
    this.clusterExpiry.set(cluster.id, now + MESSAGE_ID_TTL)
    this.keyClusters.set(key, cluster.id)
    return cluster
  }

  private clusterQualified(cluster: SimilarityCluster, groups: Map<string, RepeatGroup>): boolean {
    return Array.from(cluster.keys).some((key) => {
      const group = groups.get(key)
      if (!group || group.count < this.threshold) return false
      if (group.recognizedSenderCount / group.count < 0.6) return true
      const requiredSenders = Math.min(5, Math.max(2, Math.ceil(this.threshold * 0.2)))
      return group.senders.size >= requiredSenders
    })
  }

  private clusterRepresentative(
    cluster: SimilarityCluster,
    groups: Map<string, RepeatGroup>,
  ): [string, RepeatGroup] | null {
    return Array.from(cluster.keys)
      .map((key) => [key, groups.get(key)] as const)
      .filter((entry): entry is [string, RepeatGroup] => Boolean(entry[1]))
      .sort(([, first], [, second]) => (
        second.count - first.count
        || second.senders.size - first.senders.size
        || second.latestAt - first.latestAt
      ))[0] || null
  }

  private clusterSuggestion(
    cluster: SimilarityCluster,
    groups: Map<string, RepeatGroup>,
  ): RepeatReminderSuggestion | null {
    if (!this.clusterQualified(cluster, groups)) return null
    const representative = this.clusterRepresentative(cluster, groups)
    return representative ? this.toSuggestion(cluster.id, representative[1]) : null
  }

  private toSuggestion(id: string, group: RepeatGroup): RepeatReminderSuggestion {
    return {
      count: group.count,
      id,
      senders: group.senders.size,
      text: group.text,
      threshold: this.threshold,
      windowMs: REPEAT_REMINDER_WINDOW,
    }
  }

  private prune(now: number): void {
    let entry: WindowEntry | undefined
    while ((entry = this.entryExpiry.popBefore(now)) !== undefined) {
      const group = this.groupIndex.get(entry.key)!
      group.entries.delete(entry)
      group.count--
      if (!group.count) this.groupIndex.delete(entry.key)
      else if (entry.sender) {
        group.recognizedSenderCount--
        const count = group.senderCounts.get(entry.sender)! - 1
        if (count) group.senderCounts.set(entry.sender, count)
        else { group.senderCounts.delete(entry.sender); group.senders.delete(entry.sender) }
      }
    }
    let fingerprint: FingerprintRecord | undefined
    while ((fingerprint = this.fingerprintExpiry.popBefore(now)) !== undefined) {
      const records = this.fingerprints.get(fingerprint.key)!
      records.delete(fingerprint)
      if (!records.size) this.fingerprints.delete(fingerprint.key)
    }
    let id: string | undefined
    while ((id = this.messageIdExpiry.popBefore(now)) !== undefined) this.messageIds.delete(id)
    while ((id = this.clusterExpiry.popBefore(now)) !== undefined) {
      const cluster = this.clusters.get(id)!
      this.profiles.delete(cluster.anchor)
      this.clusters.delete(id)
      this.lastSuggestedRepresentative.delete(id)
      for (const key of cluster.keys) this.keyClusters.delete(key)
      for (const bucket of cluster.buckets) {
        const ids = this.clusterIndex.get(bucket)
        ids?.delete(id)
        if (!ids?.size) this.clusterIndex.delete(bucket)
      }
    }
  }
}
