'use strict'

const path = require('node:path')
const { spawnSync } = require('node:child_process')

const { discoverContractTests } = require('./contract-files.cjs')

const projectRoot = path.resolve(__dirname, '..', '..')
const testFiles = discoverContractTests()

if (testFiles.length === 0) {
  throw new Error('No contract tests were discovered in tests/contracts')
}

console.log(`Running ${testFiles.length} discovered contract test files`)

const result = spawnSync(process.execPath, ['--test', ...testFiles], {
  cwd: projectRoot,
  stdio: 'inherit',
})

if (result.error) {
  throw result.error
}

process.exitCode = result.status ?? 1
