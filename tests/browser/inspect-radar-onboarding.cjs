'use strict'

const { mkdirSync, writeFileSync } = require('node:fs')
const path = require('node:path')

// Only the local fixture runner calls this, using an isolated extension profile.
module.exports = async function inspectRadarOnboarding({ send, evaluateValue: evaluateInContext, artifactDirectory, isolatedContextId }) {
  if (!isolatedContextId) throw new Error('Radar extension context is missing')
  // DOM checks use the current MAIN world, including after a full page reload.
  const evaluateValue = (expression, contextId = null) => evaluateInContext(expression, contextId)
  const assertionFailures = []
  const samples = []
  const root = `(document.querySelector('[data-bcp-repeat-reminder-owned]')?.shadowRoot)`
  const waitFor = async (expression, contextId) => {
    for (let i = 0; i < 80; i++) {
      if (await evaluateValue(expression, contextId)) return
      await new Promise(resolve => setTimeout(resolve, 50))
    }
    const state = await evaluateValue(`({ focus: ${root}?.activeElement?.outerHTML, expanded: ${root}?.querySelector('details')?.open })`)
    throw new Error(`Radar onboarding timed out: ${expression}; ${JSON.stringify(state)}`)
  }
  const settle = () => evaluateValue('new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve(true))))')
  const key = async (key, shift = false) => {
    const options = { key, code: key, windowsVirtualKeyCode: key === 'Tab' ? 9 : key === 'Escape' ? 27 : 13, modifiers: shift ? 8 : 0 }
    await send('Input.dispatchKeyEvent', { type: 'keyDown', ...options, ...(key === 'Enter' ? { text: '\r' } : {}) })
    await send('Input.dispatchKeyEvent', { type: 'keyUp', ...options })
  }
  const capture = async (name) => {
    await settle()
    const sample = await evaluateValue(`(() => {
      const root = ${root};
      const body = root.querySelector('.onboarding-body');
      const scroll = root.querySelector('.onboarding-scroll');
      const card = body.getBoundingClientRect();
      const actions = root.querySelector('.onboarding-actions').getBoundingClientRect();
      const buttons = Array.from(root.querySelectorAll('.onboarding-actions button'));
      return {
        insideViewport: card.left >= 0 && card.top >= 0 && card.right <= innerWidth && card.bottom <= innerHeight,
        actionsVisible: actions.top >= card.top && actions.bottom <= card.bottom && buttons.every(button => {
          const r = button.getBoundingClientRect();
          return r.top >= actions.top && r.bottom <= actions.bottom && r.left >= card.left && r.right <= card.right;
        }),
        noHorizontalOverflow: scroll.scrollWidth <= scroll.clientWidth,
        scrollable: scroll.scrollHeight > scroll.clientHeight,
        scrollTop: scroll.scrollTop,
        settingsCount: root.querySelectorAll('.onboarding-setting-list li').length,
        expanded: root.querySelector('details').open,
        autoPlusOneOff: !root.querySelector('.onboarding-auto-plus-one input').checked,
        bodyShadow: getComputedStyle(body).boxShadow,
        width: card.width, height: card.height,
      };
    })()`)
    samples.push({ name, ...sample })
    if (!sample.insideViewport || !sample.actionsVisible || !sample.noHorizontalOverflow
      || sample.settingsCount !== 7 || !sample.autoPlusOneOff || sample.bodyShadow !== 'none') {
      assertionFailures.push(`${name}: layout, actions, seven settings, or default opt-in`)
    }
    if (artifactDirectory) {
      mkdirSync(artifactDirectory, { recursive: true })
      const screenshot = await send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false })
      writeFileSync(path.join(artifactDirectory, `radar-${name}.png`), Buffer.from(screenshot.data, 'base64'))
    }
    return sample
  }

  await waitFor(`Boolean(${root}?.querySelector('.onboarding.is-visible'))`)
  await evaluateValue(`Promise.all(${root}.querySelector('.onboarding-card').getAnimations().map(animation => animation.finished)).then(() => true)`)
  const initialFocus = await evaluateValue(`${root}.activeElement?.classList.contains('onboarding-acknowledge')`)
  if (!initialFocus) assertionFailures.push('initial confirmation focus')
  await key('Tab')
  if (!await evaluateValue(`${root}.activeElement?.matches('input[role="switch"]')`)) assertionFailures.push('Tab wraps to opt-in switch')
  await key('Tab')
  if (!await evaluateValue(`${root}.activeElement?.matches('summary')`)) assertionFailures.push('Tab reaches settings disclosure')
  await key('Enter')
  await waitFor(`${root}.querySelector('details').open`)
  await key('Tab')
  if (!await evaluateValue(`${root}.activeElement?.classList.contains('onboarding-open-settings')`)) assertionFailures.push('Tab leaves expanded settings for settings action')
  await key('Tab')
  await key('Tab')
  await key('Tab', true)
  if (!await evaluateValue(`${root}.activeElement?.classList.contains('onboarding-acknowledge')`)) assertionFailures.push('reverse Tab wraps to confirmation')

  for (const [name, width, height] of [['desktop', 1280, 800], ['compact', 390, 640], ['short', 640, 300], ['small', 320, 240]]) {
    await send('Emulation.setDeviceMetricsOverride', { width, height, deviceScaleFactor: 1, mobile: false })
    await evaluateValue(`${root}.querySelector('details').open = false`)
    await settle()
    await evaluateValue(`${root}.querySelector('.onboarding-scroll').scrollTop = 0`)
    await capture(name)
    await evaluateValue(`(${root}.querySelector('summary').click(), true)`)
    await waitFor(`${root}.querySelector('details').open`)
    await capture(`${name}-expanded`)
    await evaluateValue(`(() => { const scroll = ${root}.querySelector('.onboarding-scroll'); scroll.scrollTop = scroll.scrollHeight; return true })()`)
    const scrolled = await capture(`${name}-scrolled`)
    if (scrolled.scrollable && scrolled.scrollTop <= 0) assertionFailures.push(`${name}: content scroll is unreachable`)
  }

  await send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-reduced-motion', value: 'reduce' }] })
  const reduced = await evaluateValue(`(() => {
    const root = ${root};
    return getComputedStyle(root.querySelector('.onboarding-card')).animationName === 'none'
      && getComputedStyle(root.querySelector('.onboarding-auto-plus-one input'), '::after').transitionDuration === '0s';
  })()`)
  if (!reduced) assertionFailures.push('reduced motion disables entrance and spring')

  await evaluateValue(`(${root}.querySelector('.onboarding-auto-plus-one input').click(), true)`)
  await waitFor(`chrome.storage.sync.get('repeatReminder').then(result => result.repeatReminder?.autoPlusOne === true)`, isolatedContextId)
  await evaluateValue(`(${root}.querySelector('.onboarding-auto-plus-one input').click(), true)`)
  await waitFor(`chrome.storage.sync.get('repeatReminder').then(result => result.repeatReminder?.autoPlusOne === false)`, isolatedContextId)
  await key('Escape')
  await waitFor(`!${root}.querySelector('.onboarding.is-visible')`)
  await waitFor(`chrome.storage.local.get('danmakuEchoRepeatReminderOnboardingV1').then(result => result.danmakuEchoRepeatReminderOnboardingV1 === true)`, isolatedContextId)
  if (!await evaluateValue(`${root}.activeElement?.classList.contains('launcher')`)) assertionFailures.push('Escape restores launcher focus')
  const timeOrigin = await evaluateValue('performance.timeOrigin')
  await send('Page.reload')
  await waitFor(`performance.timeOrigin !== ${timeOrigin} && Boolean(${root}?.querySelector('.launcher.is-visible'))`)
  await settle()
  if (await evaluateValue(`Boolean(${root}?.querySelector('.onboarding.is-visible'))`)) assertionFailures.push('acknowledged introduction reappeared after reload')
  return { samples, reducedMotion: reduced, assertionFailures }
}
