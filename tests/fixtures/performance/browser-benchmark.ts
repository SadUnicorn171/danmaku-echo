import { createRepeatReminderCollector as baseline } from './collector'
import { createRepeatReminderCollector as current } from '../../../src/features/repeat-reminder/collector'
import { measureLogs } from './log-benchmark'
import { captureSendFailureEvidence as captureBaseline } from './send-failure-evidence'
import { captureSendFailureEvidence as captureCurrent } from '../../../src/core/send-failure-evidence'
import { measureRenderer } from './renderer-benchmark'
import { measureSoak } from './soak-benchmark'
import { measureUi } from './ui-benchmark'

const wait = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms))
const percentile = (values: number[], fraction: number) => [...values].sort((a, b) => a - b)[Math.max(0, Math.ceil(values.length * fraction) - 1)] || 0

/** Local fixture only. No platform messages or live-account interactions. */
export async function run(options: { logs?: boolean; renderer?: boolean; soak?: boolean; ui?: boolean } = {}) {
  const results: unknown[] = []
  const assertionFailures: string[] = []
  if (options.ui) return { measuredAt: new Date().toISOString(), userAgent: navigator.userAgent, ...await measureUi() }
  if (options.soak) return { measuredAt: new Date().toISOString(), userAgent: navigator.userAgent, ...await measureSoak() }
  if (options.renderer) return { measuredAt: new Date().toISOString(), userAgent: navigator.userAgent, ...await measureRenderer() }
  if (options.logs) {
    const logs = await measureLogs()
    return { measuredAt: new Date().toISOString(), userAgent: navigator.userAgent, ...logs }
  }
  for (const nodeCount of [1_500, 30_000]) {
    const host = document.createElement('section')
    host.className = 'performance-root'
    host.innerHTML = '<div class="performance-message">performance text</div>'.repeat(nodeCount)
    document.body.append(host)
    for (const [name, capture] of [['baseline', captureBaseline], ['current', captureCurrent]] as const) {
      const durations: number[] = []
      for (let sample = 0; sample < 30; sample++) {
        const started = performance.now()
        const evidence = capture('performance-attempt', Date.now(), document)
        durations.push(performance.now() - started)
        if (evidence.page.fragments.flatMap((fragment) => fragment.nodes).length > 500) assertionFailures.push(`${name}: unbounded page evidence`)
      }
      results.push({ kind: 'failure-capture', implementation: name, nodeCount, p50Ms: percentile(durations, .5), p95Ms: percentile(durations, .95), maxMs: Math.max(...durations) })
    }
    for (let run = 0; run < 3; run++) {
      for (const [name, create] of run % 2 ? [['current', current], ['baseline', baseline]] as const : [['baseline', baseline], ['current', current]] as const) {
        let emitted = 0
        const collector = create({
          enabled: () => true, messageSelectors: ['.performance-message'], overlaySelectors: [],
          describe: (element, source) => ({ text: element.textContent || '', parts: [{ type: 'text', text: element.textContent || '' }], resourceIds: [], platform: 'huya', source }),
          observation: () => emitted++,
        })
        try {
          const durations: number[] = []
          // Initial scan is warm-up; measure subsequent scans with identical DOM.
          for (let sample = 0; sample < 30; sample++) {
            const started = performance.now()
            collector.scan()
            durations.push(performance.now() - started)
            await wait(0)
          }
          const deadline = performance.now() + 3000
          while (emitted < 240 && performance.now() < deadline) await wait(20)
          results.push({ kind: 'collector-scan', implementation: name, run: run + 1, nodeCount, emitted, p50Ms: percentile(durations, .5), p95Ms: percentile(durations, .95), maxMs: Math.max(...durations) })
          if (emitted !== 240) assertionFailures.push(`${name}-${nodeCount}-${run}: expected 240 distinct nodes, received ${emitted}`)
        } finally { collector.destroy() }
      }
    }
    host.remove()
  }
  return { measuredAt: new Date().toISOString(), userAgent: navigator.userAgent, results, assertionFailures }
}
