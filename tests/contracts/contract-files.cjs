'use strict'

const fs = require('node:fs')
const path = require('node:path')

const CONTRACT_TEST_PATTERN = /\.test\.(?:cjs|mjs|js)$/

function walk(directory) {
  return fs.readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const target = path.join(directory, entry.name)
    return entry.isDirectory() ? walk(target) : [target]
  })
}

function discoverContractTests(directory = __dirname) {
  return walk(directory)
    .filter((file) => CONTRACT_TEST_PATTERN.test(file))
    .sort((left, right) => left.localeCompare(right, 'en'))
}

module.exports = {
  CONTRACT_TEST_PATTERN,
  discoverContractTests,
}
