'use strict'

function requiredResultFailures(scenario, result) {
  if (!result || typeof result !== 'object') return ['missing-scenario-result']
  const query = new URLSearchParams(scenario.query || '')
  const required = scenario.kind === 'settings' ? ['assertionFailures', 'sendStatistics']
    : query.has('lifecycle') ? ['assertionFailures', 'douyinLifecycle']
    : query.has('nativesettings') ? ['assertionFailures', 'douyinNativeSettings']
    : query.has('pageperf') ? ['assertionFailures', 'pagePerformance']
      : query.has('startupperf') ? ['assertionFailures', 'startupPerformance']
        : query.has('runtimeperf') ? ['assertionFailures', 'runtimePerformance']
          : query.has('favoritesdesign') ? ['assertionFailures', 'favoritesDesign']
            : query.has('autoscale') || query.has('preciselogs') ? ['assertionFailures']
              : scenario.platform === 'douyin' ? ['douyinDomRegression']
                : query.has('nativeemoji') ? ['nativeEmojiRegression']
                  : query.has('rich') ? ['bilibiliRichRegression'] : ['sideChatRegression']
  const failures = []
  for (const name of required) {
    if (!result[name] || (name === 'assertionFailures' && !Array.isArray(result[name]))) failures.push(`missing-required-result:${name}`)
    else if (name.endsWith('Regression') && !Array.isArray(result[name].assertionFailures)) failures.push(`missing-required-assertions:${name}`)
  }
  if (result.douyinDomRegression && result.douyinDomRegression.ready !== true) failures.push('douyin-fixture-not-ready')
  if (scenario.kind === 'settings' && result.sendStatistics?.passed !== true) failures.push('send-statistics-not-verified')
  if (scenario.kind !== 'settings' && scenario.pagePerformanceMode !== 'off') {
    const probe = result.extensionProbe
    if (!probe?.isolated?.runtimeId) failures.push('extension-not-injected')
    if (!probe?.main?.url || !['interactive', 'complete'].includes(probe.main.readyState)
      || probe.main.url.startsWith('chrome-error:')) failures.push('fixture-page-not-loaded')
    else if (scenario.host) {
      try {
        if (new URL(probe.main.url).hostname !== scenario.host) failures.push('fixture-host-mismatch')
      } catch { failures.push('invalid-fixture-url') }
    }
  }
  return failures
}
module.exports = { requiredResultFailures }
