import { normalizeSenderName } from '../../core/reply'
import {
  SenderCorrelationCache,
  senderMessageKey,
  type SenderCorrelationHints,
} from './sender-correlation'

export interface SenderIndexObservation extends SenderCorrelationHints {
  messages: unknown | readonly unknown[]
  node?: Node
  sender: unknown
}

export interface SenderIndexCandidate extends SenderCorrelationHints {
  directSender?: unknown
  messages: unknown | readonly unknown[]
  refresh?: boolean
}

export interface SenderIndexRuntimeOptions {
  isRelevant(mutation: MutationRecord): boolean
  minScanInterval?: number
  observations(): Iterable<SenderIndexObservation>
  observationsFromRemovedNode?(node: Node): Iterable<SenderIndexObservation>
  observerInit?: MutationObserverInit
  onMutations?(mutations: readonly MutationRecord[], relevant: boolean): void
  root: Node
}

export class SenderIndex {
  private readonly cache: SenderCorrelationCache
  private lastScanAt = 0
  private nodeSignatures = new WeakMap<Node, string>()
  private observer: MutationObserver | null = null
  private runtime: SenderIndexRuntimeOptions | null = null
  private scanTimer: ReturnType<typeof setTimeout> | null = null

  constructor(ttl?: number, limit?: number) {
    this.cache = new SenderCorrelationCache(ttl, limit)
  }

  remember(observation: SenderIndexObservation): string
  remember(
    messages: unknown | readonly unknown[],
    senderValue: unknown,
    hints?: SenderCorrelationHints & { node?: Node },
  ): string
  remember(
    observationOrMessages: SenderIndexObservation | unknown | readonly unknown[],
    senderValue?: unknown,
    hints: SenderCorrelationHints & { node?: Node } = {},
  ): string {
    const observation: SenderIndexObservation =
      arguments.length > 1
        ? { ...hints, messages: observationOrMessages, sender: senderValue }
        : (observationOrMessages as SenderIndexObservation)
    const normalizedSender = normalizeSenderName(observation.sender)
    const values = Array.isArray(observation.messages)
      ? observation.messages
      : [observation.messages]
    const signature = [
      normalizedSender,
      ...(observation.ids ?? []).map(String),
      ...values.map(senderMessageKey),
    ].join('|')
    if (!normalizedSender || !signature.replaceAll('|', '')) return ''
    if (observation.node && this.nodeSignatures.get(observation.node) === signature) {
      return normalizedSender
    }
    if (observation.node) this.nodeSignatures.set(observation.node, signature)
    return this.cache.remember(observation.messages, normalizedSender, observation)
  }

  scan(observations: Iterable<SenderIndexObservation>): number {
    let remembered = 0
    for (const observation of observations) {
      if (this.remember(observation)) remembered += 1
    }
    return remembered
  }

  start(options: SenderIndexRuntimeOptions): void {
    if (this.observer) return
    this.runtime = options
    this.observer = new MutationObserver((mutations) => {
      for (const mutation of mutations) {
        for (const node of mutation.removedNodes) {
          const observations = options.observationsFromRemovedNode?.(node)
          if (observations) this.scan(observations)
          this.forgetNode(node)
        }
      }
      const relevant = mutations.some(options.isRelevant)
      if (relevant) this.scheduleRefresh(40)
      options.onMutations?.(mutations, relevant)
    })
    this.observer.observe(
      options.root,
      options.observerInit ?? { characterData: true, childList: true, subtree: true },
    )
    this.scheduleRefresh(0)
  }

  refresh(): number {
    if (!this.runtime) return 0
    if (this.scanTimer) {
      clearTimeout(this.scanTimer)
      this.scanTimer = null
    }
    this.lastScanAt = Date.now()
    return this.scan(this.runtime.observations())
  }

  scheduleRefresh(delay = 0): void {
    if (!this.runtime || this.scanTimer) return
    const minimum = Math.max(0, this.runtime.minScanInterval ?? 240)
    const elapsed = Date.now() - this.lastScanAt
    const wait = Math.max(0, Number(delay) || 0, minimum - elapsed)
    this.scanTimer = setTimeout(() => this.refresh(), wait)
  }

  resolve(candidate: SenderIndexCandidate): string
  resolve(
    messages: unknown | readonly unknown[],
    hints?: SenderCorrelationHints & { directSender?: unknown },
  ): string
  resolve(
    candidateOrMessages: SenderIndexCandidate | unknown | readonly unknown[],
    hints: SenderCorrelationHints & { directSender?: unknown } = {},
  ): string {
    const candidate: SenderIndexCandidate =
      arguments.length > 1
        ? { ...hints, messages: candidateOrMessages }
        : (candidateOrMessages as SenderIndexCandidate)
    if (candidate.refresh) this.refresh()
    const direct = normalizeSenderName(candidate.directSender)
    if (direct) {
      this.remember({ ...candidate, sender: direct })
      return direct
    }
    return this.cache.resolve(candidate.messages, candidate)
  }

  forgetNode(node: Node): void {
    this.nodeSignatures.delete(node)
    if (node instanceof Element) {
      node.querySelectorAll('*').forEach((descendant) => this.nodeSignatures.delete(descendant))
    }
  }

  prune(now = Date.now()): void {
    this.cache.prune(now)
  }

  clear(): void {
    this.cache.clear()
    this.nodeSignatures = new WeakMap()
  }

  destroy(): void {
    if (this.scanTimer) clearTimeout(this.scanTimer)
    this.scanTimer = null
    this.observer?.disconnect()
    this.observer = null
    this.runtime = null
    this.lastScanAt = 0
    this.clear()
  }

  get active(): boolean {
    return Boolean(this.observer)
  }

  get scheduled(): boolean {
    return Boolean(this.scanTimer)
  }

  get size(): number {
    return this.cache.size
  }
}
