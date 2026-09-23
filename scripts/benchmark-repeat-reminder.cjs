'use strict'

// Local CPU benchmark. Virtual message timestamps do not imply real browser FPS.
const fs = require('node:fs')
const path = require('node:path')
const os = require('node:os')
const { createJiti } = require('jiti')
const { performance } = require('node:perf_hooks')

const root = path.resolve(__dirname, '..')
const jiti = createJiti(__filename)
const option = (name, fallback) => process.argv.find((arg) => arg.startsWith(`--${name}=`))?.split('=')[1] ?? fallback
const percentile = (values, ratio) => [...values].sort((a, b) => a - b)[Math.max(0, Math.ceil(values.length * ratio) - 1)] || 0

async function main() {
  const mode = option('mode', 'compare')
  const runs = Number(option('runs', '3'))
  const count = Number(option('count', '3000'))
  const seconds = Number(option('seconds', '120'))
  if (!['baseline', 'current', 'compare'].includes(mode) || ![runs, count, seconds].every((v) => Number.isInteger(v) && v > 0)) throw new Error('Invalid benchmark options')
  const modules = {
    baseline: await jiti.import(path.join(root, 'tests/fixtures/performance/detector.ts')),
    current: await jiti.import(path.join(root, 'src/features/repeat-reminder/detector.ts')),
  }
  const names = mode === 'compare' ? ['baseline', 'current'] : [mode]
  const result = { measuredAt: new Date().toISOString(), node: process.version, cpu: os.cpus()[0]?.model, os: `${os.platform()} ${os.release()}`, revision: option('revision', 'working-tree; see build/source manifest'), count, seconds, runs, results: [] }
  for (const kind of ['unique', 'repeat', 'prefix']) {
    // The prefix case deliberately has 400 distinct protected-number variants.
    const rows = Array.from({ length: count }, (_, index) => {
      const text = kind === 'repeat' ? '这波操作太帅了' : kind === 'prefix' ? `相同前缀流量弹幕${index % 400}` : String.fromCodePoint(0x4e00 + index % 20_000)
      return { text, parts: [{ type: 'text', text }], resourceIds: [], senderId: `sender-${index % 300}`, source: 'chat', messageId: `message-${index}`, observedAt: 1_800_000_000_000 + index * seconds * 1000 / count }
    })
    for (const name of names) {
      const warm = new modules[name].RepeatReminderDetector(8)
      for (const row of rows.slice(0, 200)) { warm.ingest(row, row.observedAt); warm.triggeredSuggestion(row, row.observedAt) }
    }
    for (let run = 0; run < runs; run++) {
      for (const name of run % 2 ? [...names].reverse() : names) {
        global.gc?.()
        const detector = new modules[name].RepeatReminderDetector(8)
        const durations = []
        let suggestions = 0
        const started = performance.now()
        for (const row of rows) {
          const before = performance.now()
          if (detector.ingest(row, row.observedAt) && detector.triggeredSuggestion(row, row.observedAt)) suggestions++
          durations.push(performance.now() - before)
        }
        const elapsedMs = performance.now() - started
        result.results.push({ kind, implementation: name, run: run + 1, elapsedMs, p50Ms: percentile(durations, .5), p95Ms: percentile(durations, .95), maxMs: Math.max(...durations), suggestions })
        process.stderr.write(`${kind} ${name} #${run + 1}: ${elapsedMs.toFixed(1)}ms\n`)
      }
    }
  }
  const output = option('output', '')
  if (output) { fs.mkdirSync(path.dirname(output), { recursive: true }); fs.writeFileSync(output, JSON.stringify(result, null, 2) + '\n') }
  else process.stdout.write(JSON.stringify(result, null, 2) + '\n')
}
main().catch((error) => { console.error(error); process.exitCode = 1 })
