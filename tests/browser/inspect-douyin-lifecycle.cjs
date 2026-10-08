'use strict'

module.exports = async function inspectDouyinLifecycle({
  send,
  evaluateValue,
  isolatedContextId,
  spa,
}) {
  if (!isolatedContextId) throw new Error('Douyin extension isolated context missing')
  const assertionFailures = []
  const samples = []
  const f = 'window.__douyinLifecycle'
  const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms))
  const waitFor = async (expression, timeout = 1200, context) => {
    const until = Date.now() + timeout
    do {
      if (await evaluateValue(expression, context)) return true
      await delay(25)
    } while (Date.now() < until)
    return false
  }
  const sample = async (name) => {
    const result = await evaluateValue(`${f}.sample()`)
    samples.push({ name, ...result })
    return result
  }
  const ready = `${f}.sample().layerVisible && ${f}.sample().tracks.length === 3`
  if (spa) {
    const untouched = await evaluateValue(
      `!document.querySelector('.bcp-douyin-dom-layer') && !document.querySelector('[data-bcp-repeat-reminder-owned]')`,
    )
    if (!untouched) assertionFailures.push('non-live-page-ui')
    await evaluateValue(`(${f}.enter('100'), ${f}.spawn('spa-first', true), true)`)
    if (!(await waitFor(ready, 4500))) assertionFailures.push('spa-cached-postmessage-first-entry')
    await sample('spa-first-entry')
  } else {
    await evaluateValue(`(${f}.spawn('early', true), true)`)
    if (!(await waitFor(ready))) assertionFailures.push('first-transfer-before-mount')
    await sample('first-transfer-before-mount')
  }
  if (!(await waitFor('Boolean(globalThis.__danmakuEchoDouyinLoaded)', 4500, isolatedContextId))) {
    assertionFailures.push('content-not-loaded')
  }
  await evaluateValue(`(${f}.spawn('moving'), ${f}.heartbeatBlocked = true, true)`)
  if (!(await waitFor(ready))) assertionFailures.push('normal-instance-not-ready')
  const before = await sample('before-detach')
  // No new barrage or settings heartbeat may rescue a stopped animation loop.
  await evaluateValue(`new Promise(resolve => {
    const node = ${f}.canvas;
    node.remove();
    requestAnimationFrame(() => requestAnimationFrame(() => {
      document.querySelector('#host').append(node); resolve(true);
    }));
  })`)
  await delay(180)
  const after = await sample('after-detach')
  if (
    !after.layerVisible ||
    after.tracks.length !== 3 ||
    !after.tracks.every((x, i) => x < before.tracks[i] - 1)
  ) {
    assertionFailures.push('animation-did-not-resume-without-heartbeat')
  }
  await evaluateValue(`(${f}.enter('200'), ${f}.spawn('room-two'), true)`)
  if (!(await waitFor(ready))) assertionFailures.push('second-room-not-ready')
  await delay(650) // Deliberately cross the route maintenance tick.
  const second = await sample('after-route-maintenance')
  if (!second.layerVisible || second.tracks.length !== 3)
    assertionFailures.push('new-room-cleared-by-route-poll')
  await evaluateValue(`(() => {
    ${f}.heartbeatBlocked = false;
    dispatchEvent(new PageTransitionEvent('pagehide', { persisted: true }));
    dispatchEvent(new PageTransitionEvent('pageshow', { persisted: true }));
    return true;
  })()`)
  await delay(100)
  await evaluateValue(`(${f}.spawn('bfcache-return'), true)`)
  if (!(await waitFor(ready))) assertionFailures.push('bfcache-cached-sender-not-restored')
  await sample('bfcache-return')
  const fullscreen = await send('Runtime.evaluate', {
    expression: 'document.querySelector("#player").requestFullscreen().then(() => true)',
    awaitPromise: true,
    returnByValue: true,
    userGesture: true,
  })
  if (
    fullscreen.exceptionDetails ||
    !(await waitFor(
      `${ready} && document.fullscreenElement?.contains(document.querySelector('.bcp-douyin-dom-layer'))`,
    ))
  ) {
    assertionFailures.push('fullscreen-resume')
  }
  await sample('fullscreen')
  await evaluateValue('document.exitFullscreen().then(() => true)')
  if (!(await waitFor(ready))) assertionFailures.push('fullscreen-exit')
  const disabled = await evaluateValue(
    `chrome.runtime.sendMessage({ type: 'danmaku-echo.settings-patch', changes: [{ path: ['enabled'], value: false }] })`,
    isolatedContextId,
  )
  if (
    !disabled?.ok ||
    !(await waitFor(`!${f}.sample().canvasHidden && !${f}.sample().layerVisible`))
  ) {
    assertionFailures.push('native-canvas-not-restored-on-disable')
  }
  await sample('disabled')
  return { assertionFailures, samples }
}
