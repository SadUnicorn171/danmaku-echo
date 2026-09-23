import { createRepeatReminderCollector } from '../../../src/features/repeat-reminder/collector'
import { RepeatReminderDetector } from '../../../src/features/repeat-reminder/detector'

/** Thirty real minutes of local DOM traffic; never invokes a platform sender. */
export async function measureSoak() {
  const assertionFailures: string[] = []
  const checkpoints: unknown[] = []
  const detector = new RepeatReminderDetector(8)
  let root = document.createElement('section')
  root.className = 'performance-soak-root'
  document.body.append(root)
  let emitted = 0
  const collector = createRepeatReminderCollector({
    enabled: () => true, rootSelectors: ['.performance-soak-root'],
    messageSelectors: ['.performance-soak-message'], overlaySelectors: [],
    describe(element, source) {
      const text = element.textContent || ''
      return { text, parts: [{ type: 'text', text }], source, platform: 'huya', resourceIds: [], senderId: (element as HTMLElement).dataset.sender }
    },
    observation(row) { emitted++; if (detector.ingest(row)) detector.triggeredSuggestion(row) },
  })
  const delay = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms))
  let produced = 0
  const append = (count: number) => {
    const fragment = document.createDocumentFragment()
    for (let index = 0; index < count; index++) {
      const row = document.createElement('div')
      row.className = 'performance-soak-message'
      row.textContent = String.fromCodePoint(0x4e00 + produced % 2_000)
      row.dataset.sender = String(produced++ % 300)
      fragment.append(row)
    }
    root.append(fragment)
  }
  let trafficTimer = 0
  try {
    for (let room = 0; room < 20; room++) {
      append(20)
      collector.scan()
      const deadline = performance.now() + 3_000
      while (emitted < produced && performance.now() < deadline) await delay(20)
      if (emitted !== produced) assertionFailures.push(`room-${room}: undelivered observations`)
      root.remove()
      root = document.createElement('section')
      root.className = 'performance-soak-root'
      document.body.append(root)
      detector.clear()
      collector.scan()
      if (collector.diagnostics().observerCount !== 1) assertionFailures.push(`room-${room}: stale observer`)
    }
    checkpoints.push({ phase: 'after-20-rooms', ...collector.diagnostics(), produced, emitted })
    const started = performance.now()
    let paused = false
    trafficTimer = window.setInterval(() => {
      if (paused) return
      append(10)
      while (root.children.length > 1_500) root.firstElementChild!.remove()
    }, 100)
    for (let minute = 1; minute <= 30; minute++) {
      await delay(Math.max(0, started + minute * 60_000 - performance.now()))
      if (minute === 10) { paused = true; collector.setEnabled(false) }
      if (minute === 15) { collector.setEnabled(true); paused = false }
      const state = collector.diagnostics()
      if (state.observerCount > 1 || state.queuedCount > 1_000) assertionFailures.push(`minute-${minute}: unbounded resources`)
      if (paused && (state.observerCount || state.rootDiscoveryScheduled || state.flushScheduled)) assertionFailures.push(`minute-${minute}: disabled resources remain`)
      checkpoints.push({ minute, elapsedMs: performance.now() - started, paused, ...state, produced, emitted, domNodes: root.children.length })
    }
  } finally {
    clearInterval(trafficTimer)
    collector.destroy()
    detector.clear()
    root.remove()
  }
  checkpoints.push({ phase: 'destroyed', ...collector.diagnostics(), produced, emitted })
  if (collector.diagnostics().observerCount || collector.diagnostics().queuedCount || collector.diagnostics().rootDiscoveryScheduled || collector.diagnostics().flushScheduled) assertionFailures.push('destroyed: resources remain')
  return { results: checkpoints, assertionFailures, scope: 'local collector/detector; 20 container replacements; 30 real minutes; 5 minutes explicitly disabled (not native page visibility)' }
}
