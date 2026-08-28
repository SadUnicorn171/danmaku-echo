import type { DanmakuDescriptor } from '../../core/types'
import type { RepeatReminderObservation } from './types'

export interface RepeatReminderCollector {
  destroy(): void
  scan(): void
  setEnabled(enabled: boolean): void
}

interface CollectorOptions {
  describe(element: Element, source: DanmakuDescriptor['source']): DanmakuDescriptor | null
  enabled(): boolean
  messageSelectors: readonly string[]
  observation(observation: RepeatReminderObservation): void
  overlaySelectors: readonly string[]
  rootSelectors?: readonly string[]
}

const MAX_QUEUE = 1_000
const MAX_SCAN_RESULTS = 240

function matchesAny(element: Element, selectors: readonly string[]): boolean {
  return selectors.some((selector) => { try { return element.matches(selector) } catch { return false } })
}

function candidateElements(node: Node, selectors: readonly string[]): Element[] {
  if (!(node instanceof Element) || !selectors.length) return []
  const found: Element[] = matchesAny(node, selectors) ? [node] : []
  try { found.push(...Array.from(node.querySelectorAll(selectors.join(',')))) } catch {
    selectors.forEach((selector) => { try { found.push(...Array.from(node.querySelectorAll(selector))) } catch { /* Defensive selector. */ } })
  }
  return Array.from(new Set(found))
}

export function createRepeatReminderCollector(options: CollectorOptions): RepeatReminderCollector {
  const observers = new Map<Node, MutationObserver>()
  const queued = new Map<Element, DanmakuDescriptor['source']>()
  const signatures = new WeakMap<Element, string>()
  const rootSelectors = (options.rootSelectors || []).filter(Boolean)
  let flushTimer: ReturnType<typeof setTimeout> | undefined
  let rootTimer: ReturnType<typeof setInterval> | undefined
  let enabled = options.enabled()
  let destroyed = false

  function emit(element: Element, source: DanmakuDescriptor['source']): void {
    if (!enabled || destroyed || !element.isConnected || element.closest('[data-bcp-repeat-reminder-owned]')) return
    const descriptor = options.describe(element, source)
    if (!descriptor || !descriptor.text) return
    const signature = JSON.stringify([
      descriptor.messageId || '', descriptor.senderId || '', descriptor.senderName || '',
      descriptor.text, descriptor.resourceIds,
      descriptor.parts.map((part) => [part.type, part.resourceId, part.resourceUrl, part.text]),
    ])
    if (signatures.get(element) === signature) return
    signatures.set(element, signature)
    options.observation({
      messageId: descriptor.messageId,
      observedAt: Date.now(),
      parts: descriptor.parts,
      resourceIds: descriptor.resourceIds,
      senderId: descriptor.senderId,
      senderName: descriptor.senderName,
      source,
      text: descriptor.text,
    })
  }

  function flush(): void {
    flushTimer = undefined
    if (!enabled || destroyed) { queued.clear(); return }
    Array.from(queued.entries()).slice(0, 200).forEach(([element, source]) => {
      queued.delete(element)
      emit(element, source)
    })
    if (queued.size) flushTimer = setTimeout(flush, 16)
  }

  function queue(element: Element, source: DanmakuDescriptor['source']): void {
    if (!enabled || destroyed || queued.size >= MAX_QUEUE) return
    if (element.closest('[data-bcp-one-owned],[data-bcp-repeat-reminder-owned]')) return
    queued.set(element, source)
    if (!flushTimer) flushTimer = setTimeout(flush, 40)
  }

  function discoverRoots(root: ParentNode): void {
    let elements: Element[] = []
    try { elements = Array.from(root.querySelectorAll('*')).slice(0, 4_000) } catch { return }
    elements.forEach((element) => { if (element.shadowRoot && observers.size < 40) observe(element.shadowRoot) })
  }

  function queueNode(node: Node): void {
    if (!(node instanceof Element)) return
    candidateElements(node, options.messageSelectors).forEach((element) => queue(element, 'chat'))
    candidateElements(node, options.overlaySelectors).forEach((element) => queue(element, 'video'))
    if (!rootSelectors.length && node.shadowRoot && observers.size < 40) {
      observe(node.shadowRoot)
      scanRoot(node.shadowRoot)
    }
  }

  function nearestCandidate(node: Node): void {
    const element = node instanceof Element ? node : node.parentElement
    if (!element) return
    for (const group of [
      { selectors: options.messageSelectors, source: 'chat' as const },
      { selectors: options.overlaySelectors, source: 'video' as const },
    ]) {
      for (const selector of group.selectors) {
        try {
          const candidate = element.closest(selector)
          if (candidate) { queue(candidate, group.source); return }
        } catch { /* Defensive selector. */ }
      }
    }
  }

  function observe(root: Node): void {
    if (observers.has(root)) return
    const observer = new MutationObserver((mutations) => {
      if (!enabled) return
      mutations.forEach((mutation) => {
        if (mutation.type === 'characterData' || mutation.type === 'childList') nearestCandidate(mutation.target)
        mutation.addedNodes.forEach(queueNode)
      })
    })
    observer.observe(root, { characterData: true, childList: true, subtree: true })
    observers.set(root, observer)
  }

  function scanRoot(root: ParentNode): void {
    for (const group of [
      { selectors: options.messageSelectors, source: 'chat' as const },
      { selectors: options.overlaySelectors, source: 'video' as const },
    ]) {
      if (!group.selectors.length) continue
      let elements: Element[] = []
      try { elements = Array.from(root.querySelectorAll(group.selectors.join(','))) } catch {
        group.selectors.forEach((selector) => { try { elements.push(...Array.from(root.querySelectorAll(selector))) } catch { /* Defensive selector. */ } })
      }
      elements.slice(-MAX_SCAN_RESULTS).forEach((element) => queue(element, group.source))
    }
  }

  function scopedRoots(): Element[] {
    if (!document.documentElement || !rootSelectors.length) return []
    const candidates = candidateElements(document.documentElement, rootSelectors)
    return candidates.filter(
      (candidate) => !candidates.some(
        (other) => other !== candidate && other.contains(candidate),
      ),
    )
  }

  function syncScopedRoots(): void {
    if (!enabled || destroyed || !rootSelectors.length) return
    const nextRoots = new Set(scopedRoots())
    for (const [root, observer] of observers) {
      if (!(root instanceof Element) || nextRoots.has(root)) continue
      observer.disconnect()
      observers.delete(root)
    }
    for (const root of nextRoots) {
      if (observers.has(root)) continue
      observe(root)
      scanRoot(root)
    }
  }

  function startRootTimer(): void {
    if (!rootSelectors.length || rootTimer) return
    rootTimer = setInterval(syncScopedRoots, 1_000)
  }

  function stopRootTimer(): void {
    if (rootTimer) clearInterval(rootTimer)
    rootTimer = undefined
  }

  function scan(): void {
    if (!enabled || destroyed || !document.documentElement) return
    if (rootSelectors.length) {
      syncScopedRoots()
      observers.forEach((_observer, root) => {
        if (root instanceof Element) scanRoot(root)
      })
      return
    }
    scanRoot(document)
    discoverRoots(document)
    observers.forEach((_observer, root) => { if (root instanceof ShadowRoot) scanRoot(root) })
  }

  function start(): void {
    if (!document.documentElement || destroyed) return
    if (rootSelectors.length) {
      syncScopedRoots()
      startRootTimer()
    } else {
      observe(document.documentElement)
      scan()
    }
  }

  const runtime: RepeatReminderCollector = {
    destroy(): void {
      destroyed = true
      if (flushTimer) clearTimeout(flushTimer)
      stopRootTimer()
      queued.clear()
      observers.forEach((observer) => observer.disconnect())
      observers.clear()
    },
    scan,
    setEnabled(value): void {
      enabled = value
      if (enabled) start()
      else {
        if (flushTimer) clearTimeout(flushTimer)
        flushTimer = undefined
        stopRootTimer()
        queued.clear()
        observers.forEach((observer) => observer.disconnect())
        observers.clear()
      }
    },
  }
  if (document.documentElement) start()
  else document.addEventListener('DOMContentLoaded', start, { once: true })
  return runtime
}
