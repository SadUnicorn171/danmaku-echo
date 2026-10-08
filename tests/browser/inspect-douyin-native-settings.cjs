'use strict'

module.exports = async function inspectDouyinNativeSettings({ evaluateValue, isolatedContextId }) {
  if (!isolatedContextId) throw new Error('Douyin extension isolated context is missing')
  const assertionFailures = []
  const samples = []
  const fixture = 'window.__nativeSettingsFixture'
  const waitFor = async (expression) => {
    for (let attempt = 0; attempt < 80; attempt++) {
      if (await evaluateValue(expression)) return
      await new Promise((resolve) => setTimeout(resolve, 50))
    }
    throw new Error(`Native settings fixture timed out: ${expression}`)
  }
  const patch = async (changes) => {
    const result = await evaluateValue(
      `chrome.runtime.sendMessage({ type: 'danmaku-echo.settings-patch', changes: ${JSON.stringify(changes)} })`,
      isolatedContextId,
    )
    if (!result?.ok) throw new Error('Native settings patch was not saved')
  }
  const keys = ['hideGiftMessages', 'hideLuckyBagCommands', 'blockGiftEffects']
  const preferences = (value) => keys.map((key) => ({ path: ['douyinNativeSettings', key], value }))
  const state = `JSON.stringify(${fixture}.read())`
  const original = JSON.stringify({
    gift: true,
    lucky: true,
    danmaku: true,
    effect: false,
    audio: true,
    shortcut: true,
  })
  const filtered = JSON.stringify({
    gift: false,
    lucky: false,
    danmaku: true,
    effect: true,
    audio: true,
    shortcut: true,
  })
  const snapshot = async (name, expected, clicks) => {
    const actual = await evaluateValue(
      `({ state: ${fixture}.read(), clicks: ${fixture}.clicks.slice(), enters: ${fixture}.enters, leaves: ${fixture}.leaves })`,
    )
    samples.push({ name, ...actual })
    if (JSON.stringify(actual.state) !== expected || actual.clicks.length !== clicks)
      assertionFailures.push(name)
    if (actual.clicks.some((key) => !['gift', 'lucky', 'effect'].includes(key)))
      assertionFailures.push(`${name}:unrelated-switch-clicked`)
  }
  // Waiting for two animation frames ensures observer/UI work has run in negative checks.
  const drain = () =>
    evaluateValue(
      'new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve(true))))',
    )
  await waitFor(`Boolean(${fixture})`)
  await snapshot('default-compatible', original, 0)
  await patch(preferences(true))
  await waitFor(`${state} === ${JSON.stringify(filtered)}`)
  await snapshot('three-native-controls', filtered, 3)
  await evaluateValue(
    `(() => { for (let i = 0; i < 30; i++) document.body.append(document.createElement('aside')); return true })()`,
  )
  await drain()
  await snapshot('unrelated-mutations-no-extra-clicks', filtered, 3)
  await evaluateValue(`(${fixture}.reset(true), true)`)
  await waitFor(`${state} === ${JSON.stringify(filtered)} && ${fixture}.leaves === 2`)
  await snapshot('lazy-replacement-and-hover-cleanup', filtered, 6)
  await patch(preferences(false))
  await drain()
  await snapshot('disabling-does-not-invert-native-state', filtered, 6)
  await evaluateValue(`(${fixture}.reset(), true)`)
  await drain()
  await snapshot('disabled-new-controls-untouched', original, 6)
  await patch([{ path: ['douyinNativeSettings', 'blockGiftEffects'], value: true }])
  const effectOnly = JSON.stringify({
    gift: true,
    lucky: true,
    danmaku: true,
    effect: true,
    audio: true,
    shortcut: true,
  })
  await waitFor(`${state} === ${JSON.stringify(effectOnly)}`)
  await snapshot('independent-effect-setting', effectOnly, 7)
  await patch([{ path: ['enabled'], value: false }])
  await drain()
  await evaluateValue(`(${fixture}.reset(), true)`)
  await drain()
  await snapshot('global-disabled', original, 7)
  await patch([{ path: ['enabled'], value: true }, ...preferences(true)])
  await waitFor(`${state} === ${JSON.stringify(filtered)}`)
  await snapshot('global-reenabled', filtered, 10)
  await evaluateValue(
    `(() => { history.pushState({}, '', '/200' + location.search); ${fixture}.reset(true); return true })()`,
  )
  await waitFor(`${state} === ${JSON.stringify(filtered)}`)
  await snapshot('room-route-and-player-replaced', filtered, 13)
  await patch([{ path: ['platforms', 'douyin'], value: false }])
  await drain()
  await evaluateValue(`(${fixture}.reset(), true)`)
  await drain()
  await snapshot('platform-disabled', original, 13)
  return { assertionFailures, samples }
}
