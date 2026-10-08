const { test } = require('node:test')
const assert = require('node:assert/strict')
const { requiredResultFailures } = require('../browser/required-result.cjs')
const probe = { isolated: { runtimeId: 'test' }, main: { url: 'http://live.douyin.com:1234/', readyState: 'complete' } }
test('a missing fixture or skipped assertions cannot pass a browser scenario', () => {
  const scenario = { platform: 'douyin', query: 'platform=douyin' }
  assert.ok(requiredResultFailures(scenario, {}).includes('missing-required-result:douyinDomRegression'))
  assert.ok(requiredResultFailures(scenario, { extensionProbe: probe, douyinDomRegression: { ready: false } }).includes('douyin-fixture-not-ready'))
  assert.deepEqual(requiredResultFailures(scenario, { extensionProbe: probe, douyinDomRegression: { ready: true, assertionFailures: [] } }), [])
  assert.ok(requiredResultFailures({ kind: 'settings' }, { assertionFailures: [] }).includes('send-statistics-not-verified'))
  assert.ok(requiredResultFailures({ platform: 'douyin', query: 'nativesettings=1' }, { assertionFailures: [], extensionProbe: probe }).includes('missing-required-result:douyinNativeSettings'))
})
