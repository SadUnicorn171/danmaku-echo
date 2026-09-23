'use strict'
const fs = require('node:fs')
const path = require('node:path')
const { spawnSync } = require('node:child_process')
const root = path.resolve(__dirname, '..')
const output = path.join(root, 'test-results/performance/startup-comparison')
const browserArtifacts = path.join(root, 'test-results/performance/startup-browser')
fs.mkdirSync(output, { recursive: true })
const results = []
for (const browser of ['chrome', 'edge']) for (const platform of ['bilibili', 'douyu', 'huya', 'douyin']) for (let run = 0; run < 3; run++) {
  for (const implementation of run % 2 ? ['current', 'baseline'] : ['baseline', 'current']) {
    const extension = implementation === 'baseline' ? 'test-results/performance/baseline-extension' : 'build/extension'
    const name = `${browser}-${platform}-${implementation}-${run + 1}`
    const execution = spawnSync(process.execPath, [path.join(root, 'tests/browser/run-browser-e2e.cjs'), `--browser=${browser}`, `--scenario=${platform}-startup`, `--extension-path=${extension}`, `--artifact-root=${browserArtifacts}`], { cwd: root, encoding: 'utf8', timeout: 180_000 })
    fs.writeFileSync(path.join(output, `${name}.log`), (execution.stdout || '') + (execution.stderr || ''))
    const summary = JSON.parse(fs.readFileSync(path.join(browserArtifacts, 'summary.json'), 'utf8'))
    const item = summary.find((item) => item.browser === browser && item.scenario === `${platform}-startup`)
    if (execution.error || execution.status !== 0 || !item?.passed) throw new Error(`Startup scenario failed: ${name}; see its log`)
    const reportPath = path.join(browserArtifacts, `${browser}/${browser}-${platform}-startup-attempt-${item.attempt}.json`)
    const report = JSON.parse(fs.readFileSync(reportPath, 'utf8'))
    fs.copyFileSync(reportPath, path.join(output, `${name}.json`))
    results.push({ browser, platform, implementation, run: run + 1, attempt: item.attempt, ...report.startupPerformance })
    fs.writeFileSync(path.join(output, 'results.json'), JSON.stringify(results, null, 2) + '\n')
    process.stdout.write(`${name}: ${report.startupPerformance.firstPortalAtMs.toFixed(1)}ms\n`)
  }
}
