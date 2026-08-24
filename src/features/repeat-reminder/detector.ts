import {
  DEFAULT_REPEAT_REMINDER_THRESHOLD,
  normalizeRepeatReminderThreshold,
} from '../../core/repeat-reminder-settings'
import type { RepeatReminderObservation, RepeatReminderSuggestion } from './types'
import {
  areRepeatReminderTextsSimilar,
  canonicalRepeatReminderText,
  normalizeRepeatReminderText,
  repeatReminderSimilarity,
  repeatReminderSimilarityBuckets,
} from './similarity'

export const REPEAT_REMINDER_WINDOW = 60_000

const CROSS_SOURCE_WINDOW = 3_000
const MESSAGE_ID_TTL = 10 * 60_000

interface FingerprintRecord {
  at: number
  matched: boolean
  sender: string
  source: RepeatReminderObservation['source']
}

interface RepeatGroup {
  count: number
  latestAt: number
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
  private entries: Array<{ at: number; key: string; sender: string; text: string }> = []
  private fingerprints = new Map<string, FingerprintRecord[]>()
  private messageIds = new Map<string, number>()
  private clusters = new Map<string, SimilarityCluster>()
  private clusterIndex = new Map<string, Set<string>>()
  private keyClusters = new Map<string, string>()
  private lastSuggestedRepresentative = new Map<string, string>()
  private threshold: number

  constructor(threshold = DEFAULT_REPEAT_REMINDER_THRESHOLD) {
    this.threshold = normalizeRepeatReminderThreshold(threshold)
  }

  clear(): void {
    this.entries = []
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

  ingest(observation: RepeatReminderObservation, now = Date.now()): boolean {
    this.prune(now)
    const key = plainTextKey(observation)
    if (!key) return false
    const messageId = String(observation.messageId || '').trim()
    if (messageId) {
      const previous = this.messageIds.get(messageId)
      if (previous !== undefined && now - previous <= MESSAGE_ID_TTL) return false
      this.messageIds.set(messageId, observation.observedAt)
    }

    const sender = senderKey(observation)
    const records = (this.fingerprints.get(key) || [])
      .filter((record) => now - record.at <= CROSS_SOURCE_WINDOW)
    const mirrored = records.find((record) => (
      !record.matched
      && record.source !== observation.source
      && senderCompatible(record.sender, sender)
    ))
    if (mirrored) {
      mirrored.matched = true
      this.fingerprints.set(key, records)
      return false
    }
    records.push({ at: observation.observedAt, matched: false, sender, source: observation.source })
    this.fingerprints.set(key, records)
    this.entries.push({ at: observation.observedAt, key, sender, text: observation.text.trim() })
    return true
  }

  suggestion(now = Date.now()): RepeatReminderSuggestion | null {
    const groups = this.groups(now)
    for (const key of groups.keys()) this.resolveCluster(key, now)
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
    const groups = new Map<string, RepeatGroup>()
    this.entries.forEach((entry) => {
      const group = groups.get(entry.key) || {
        count: 0,
        latestAt: 0,
        senders: new Set<string>(),
        text: entry.text,
      }
      group.count += 1
      if (entry.at >= group.latestAt) {
        group.latestAt = entry.at
        group.text = entry.text
      }
      if (entry.sender) group.senders.add(entry.sender)
      groups.set(entry.key, group)
    })
    return groups
  }

  private resolveCluster(key: string, now: number): SimilarityCluster {
    const existingId = this.keyClusters.get(key)
    if (existingId) {
      const existing = this.clusters.get(existingId)!
      existing.latestAt = now
      return existing
    }
    let best: { cluster: SimilarityCluster; score: number } | null = null
    const buckets = repeatReminderSimilarityBuckets(key)
    const candidateIds = new Set<string>()
    for (const bucket of buckets) {
      for (const id of this.clusterIndex.get(bucket) || []) candidateIds.add(id)
    }
    for (const id of candidateIds) {
      const cluster = this.clusters.get(id)
      if (!cluster) continue
      if (!areRepeatReminderTextsSimilar(key, cluster.anchor)) continue
      const score = repeatReminderSimilarity(key, cluster.anchor)
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
    this.keyClusters.set(key, cluster.id)
    return cluster
  }

  private clusterQualified(cluster: SimilarityCluster, groups: Map<string, RepeatGroup>): boolean {
    return Array.from(cluster.keys).some((key) => (groups.get(key)?.count || 0) >= this.threshold)
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
    this.entries = this.entries.filter((entry) => entry.at >= now - REPEAT_REMINDER_WINDOW)
    this.fingerprints.forEach((records, key) => {
      const recent = records.filter((record) => now - record.at <= CROSS_SOURCE_WINDOW)
      if (recent.length) this.fingerprints.set(key, recent)
      else this.fingerprints.delete(key)
    })
    this.messageIds.forEach((at, id) => {
      if (now - at > MESSAGE_ID_TTL) this.messageIds.delete(id)
    })
    this.clusters.forEach((cluster, id) => {
      if (now - cluster.latestAt <= MESSAGE_ID_TTL) return
      this.clusters.delete(id)
      this.lastSuggestedRepresentative.delete(id)
      for (const key of cluster.keys) this.keyClusters.delete(key)
      for (const bucket of cluster.buckets) {
        const ids = this.clusterIndex.get(bucket)
        ids?.delete(id)
        if (!ids?.size) this.clusterIndex.delete(bucket)
      }
    })
  }
}
