'use strict'

const fs = require('node:fs')
const path = require('node:path')

const { CONTRACT_TEST_PATTERN, discoverContractTests } = require('./contract-files.cjs')

const projectRoot = path.resolve(__dirname, '..', '..')
const testsRoot = path.join(projectRoot, 'tests')
const browserRoot = path.join(testsRoot, 'browser')
const fixturesRoot = path.join(testsRoot, 'fixtures')
const packageJson = JSON.parse(fs.readFileSync(path.join(projectRoot, 'package.json'), 'utf8'))
const vitestConfig = fs.readFileSync(path.join(projectRoot, 'vitest.config.ts'), 'utf8')

const rootFiles = fs
  .readdirSync(testsRoot, { withFileTypes: true })
  .filter((entry) => entry.isFile())
  .map((entry) => entry.name)

if (rootFiles.length > 0) {
  throw new Error(`Tests must be classified into subdirectories: ${rootFiles.join(', ')}`)
}

const allowedDirectories = new Set(['browser', 'contracts', 'fixtures'])
const unexpectedDirectories = fs
  .readdirSync(testsRoot, { withFileTypes: true })
  .filter((entry) => entry.isDirectory() && !allowedDirectories.has(entry.name))
  .map((entry) => entry.name)

if (unexpectedDirectories.length > 0) {
  throw new Error(`Unexpected test directories: ${unexpectedDirectories.join(', ')}`)
}

for (const directory of [browserRoot, fixturesRoot]) {
  if (!fs.existsSync(directory) || !fs.statSync(directory).isDirectory()) {
    throw new Error(`Missing required test directory: ${path.relative(projectRoot, directory)}`)
  }
}

const contractTests = discoverContractTests()
if (contractTests.length === 0 || contractTests.some((file) => !CONTRACT_TEST_PATTERN.test(file))) {
  throw new Error('Contract test discovery is empty or includes an invalid filename')
}

const scripts = packageJson.scripts ?? {}
if (scripts['test:regression'] !== 'node tests/contracts/run-contract-tests.cjs') {
  throw new Error('test:regression must use the automatic contract test runner')
}
if (scripts['test:browser'] !== 'node tests/browser/run-browser-e2e.cjs') {
  throw new Error('test:browser must remain isolated under tests/browser')
}
if (!String(scripts.check).includes('test:regression') || String(scripts.check).includes('test:browser')) {
  throw new Error('npm run check must include contract tests and exclude browser E2E')
}
if (!/exclude:\s*\[[^\]]*['"]tests\/\*\*['"]/.test(vitestConfig)) {
  throw new Error('Vitest must exclude tests/** so contract tests are not run twice')
}

console.log(`Test layout validation passed (${contractTests.length} contract files discovered)`)
