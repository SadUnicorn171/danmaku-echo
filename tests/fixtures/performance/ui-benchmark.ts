import { createRepeatReminderUi } from '../../../src/features/repeat-reminder/ui'
import { DanmakuTrafficMeter } from '../../../src/features/repeat-reminder/traffic-flow'

const wait = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms))
const p95 = (values: number[]) => [...values].sort((a, b) => a - b)[Math.ceil(values.length * .95) - 1] || 0

export async function measureUi() {
  const results: unknown[] = []
  const assertionFailures: string[] = []
  for (const count of [1_000, 10_000]) {
    const now = 1_800_000_000_000
    const meter = new DanmakuTrafficMeter(now)
    for (let index = 0; index < count; index++) {
      const text = String.fromCodePoint(0x4e00 + index)
      meter.ingest({ text, source: 'chat', resourceIds: [], parts: [{ type: 'text', text }], observedAt: now + index * 5, senderId: `sender-${index % 300}` }, now + index * 5)
    }
    const durations: number[] = []
    for (let sample = 0; sample < 60; sample++) {
      const start = performance.now()
      const snapshot = meter.snapshot(now + count * 5)
      const duration = performance.now() - start
      if (sample >= 10) durations.push(duration)
      if (snapshot.messageCount !== count) assertionFailures.push('traffic sample count changed')
    }
    results.push({ kind: 'traffic-snapshot', count, samples: durations.length, p95Ms: p95(durations), maxMs: Math.max(...durations) })
  }
  const ui = createRepeatReminderUi({ dismiss() {}, openSettings() {}, plusOne() { assertionFailures.push('unexpected send') } })
  ui.applySettings({ enabled: true, promptDurationSeconds: 6, promptScalePercent: 100, queueLimit: 3, threshold: 5 })
  ui.setSuggestions(Array.from({ length: 3 }, (_, index) => ({ id: `performance-ui-${index}`, text: `性能提示${index}`, count: 5, senders: 5, threshold: 5, windowMs: 60_000 })))
  const shadow = document.querySelector('[data-bcp-repeat-reminder-owned]')?.shadowRoot
  let mutations = 0
  const observer = new MutationObserver((records) => { mutations += records.length })
  const buttons = shadow?.querySelectorAll('[data-plus-one-id]') || []
  for (const button of buttons) observer.observe(button, { childList: true, characterData: true, subtree: true })
  try {
    if (buttons.length !== 3) assertionFailures.push('missing countdown controls')
    const started = performance.now()
    await wait(4_000)
    mutations += observer.takeRecords().length
    results.push({ kind: 'countdown', durationMs: performance.now() - started, mutations, labels: Array.from(buttons, (button) => button.textContent) })
    observer.disconnect()
    await wait(3_000)
    if (shadow?.querySelectorAll('.prompt').length) assertionFailures.push('countdown did not expire')
  } finally { observer.disconnect(); ui.destroy() }
  return { results, assertionFailures }
}
