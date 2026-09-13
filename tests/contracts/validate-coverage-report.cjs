'use strict'

const fs = require('node:fs')
const path = require('node:path')

const projectRoot = path.resolve(__dirname, '..', '..')
const reportPath = path.join(projectRoot, 'test-results', 'coverage', 'coverage-summary.json')

if (!fs.existsSync(reportPath)) {
  throw new Error('Coverage summary is missing; run Vitest coverage before this validation')
}

const report = JSON.parse(fs.readFileSync(reportPath, 'utf8'))
const normalizedEntries = new Map(
  Object.entries(report)
    .filter(([file]) => file !== 'total')
    .map(([file, summary]) => [path.relative(projectRoot, file).replaceAll('\\', '/'), summary]),
)

const requiredFiles = [
  'src/core/rich-asset-identity.ts',
  'src/features/repeat-reminder/collector.ts',
  'src/platforms/live/rich-message.ts',
  'src/platforms/live/send-coordinator.ts',
  'src/platforms/live/hover-selection-controller.ts',
  'src/platforms/live/repeat-reminder-adapter.ts',
  'src/platforms/douyin/protocol.ts',
  'src/platforms/douyin/content/radar-collector.ts',
  'src/platforms/douyin/page/track-motion.ts',
]

for (const file of requiredFiles) {
  const summary = normalizedEntries.get(file)
  if (!summary || summary.lines.total === 0) {
    throw new Error(`Required coverage domain is missing executable lines: ${file}`)
  }
}

for (const prefix of ['src/core/', 'src/features/', 'src/platforms/']) {
  if (![...normalizedEntries.keys()].some((file) => file.startsWith(prefix))) {
    throw new Error(`Coverage report is missing domain: ${prefix}`)
  }
}

if (normalizedEntries.size < 100) {
  throw new Error(
    `Coverage scope unexpectedly shrank to ${normalizedEntries.size} files; expected at least 100`,
  )
}

if ([...normalizedEntries.keys()].some((file) => file.startsWith('src/entries/'))) {
  throw new Error('Runtime entries must use startup contracts instead of DOM-loop coverage targets')
}

console.log(`Coverage scope validation passed (${normalizedEntries.size} source files)`)
