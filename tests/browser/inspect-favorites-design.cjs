'use strict'

const { mkdirSync, writeFileSync } = require('node:fs')
const path = require('node:path')

// Called only by the local fixture runner, using its temporary extension profile.
module.exports = async function inspectFavoritesDesign({ send, evaluateValue, artifactDirectory }) {
  const failures = []
  const samples = []
  const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms))
  const root = `document.querySelector('.bcp-favorites-host')?.shadowRoot`
  const key = (type, value = 'q') => send('Input.dispatchKeyEvent', {
    type, key: value, code: value === 'q' ? 'KeyQ' : 'Escape',
    modifiers: value === 'q' ? 1 : 0,
    windowsVirtualKeyCode: value === 'q' ? 81 : 27,
  })
  const mouse = (x, y) => send('Input.dispatchMouseEvent', { type: 'mouseMoved', x, y })
  const waitFor = async (expression) => {
    for (let attempt = 0; attempt < 60; attempt += 1) {
      if (await evaluateValue(expression)) return
      await delay(50)
    }
    throw new Error(`Favorites design fixture timed out: ${expression}`)
  }
  const read = () => evaluateValue(`(() => {
    const root = ${root};
    const center = root?.querySelector('.bcp-favorites-radial-center');
    if (!center) return null;
    const style = getComputedStyle(center);
    const rect = center.getBoundingClientRect();
    const face = center.querySelector('.bcp-favorites-radial-bot-eyes');
    return {
      classes: center.className,
      x: rect.x + rect.width / 2, y: rect.y + rect.height / 2,
      gazeX: style.getPropertyValue('--bcp-favorites-gaze-x').trim(),
      gazeY: style.getPropertyValue('--bcp-favorites-gaze-y').trim(),
      faceTransform: getComputedStyle(face).transform,
      background: style.backgroundImage,
      runningAnimations: center.getAnimations({ subtree: true }).length,
      options: Array.from(root.querySelectorAll('.bcp-favorites-radial-item')).map(item => {
        const r = item.getBoundingClientRect();
        return { kind: item.classList.contains('is-favorite') ? 'favorite' : item.classList.contains('is-other') ? 'other' : 'more',
          x: r.x + r.width / 2, y: r.y + r.height / 2,
          visible: r.left >= 0 && r.top >= 0 && r.right <= innerWidth && r.bottom <= innerHeight };
      })
    };
  })()`)
  const snapshot = async (name) => {
    // Let the authored 200ms entrance/reaction finish, not a product synchronization delay.
    await delay(230)
    const sample = await read()
    samples.push({ name, ...sample })
    if (artifactDirectory) {
      mkdirSync(artifactDirectory, { recursive: true })
      const screenshot = await send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false })
      writeFileSync(path.join(artifactDirectory, `favorites-${name}.png`), Buffer.from(screenshot.data, 'base64'))
    }
    return sample
  }
  const open = async () => {
    await mouse(320, 300)
    await key('keyDown')
    await waitFor(`Boolean(${root}?.querySelector('.bcp-favorites-radial'))`)
  }
  const cancel = async () => {
    await key('keyDown', 'Escape')
    await key('keyUp', 'Escape')
    await key('keyUp')
    await waitFor(`!${root}?.querySelector('.bcp-favorites-radial')`)
  }

  await send('Emulation.setDeviceMetricsOverride', { width: 1000, height: 720, deviceScaleFactor: 1, mobile: false })
  const onboardingAppearance = await evaluateValue(`(() => {
    const shadow = document.querySelector('[data-bcp-repeat-reminder-owned]')?.shadowRoot;
    const launcher = shadow?.querySelector('.launcher');
    const acknowledge = shadow?.querySelector('.onboarding-acknowledge');
    return {
      visible: shadow?.querySelector('.onboarding')?.classList.contains('is-visible'),
      launcherShadow: launcher && getComputedStyle(launcher).boxShadow,
      buttonShadow: acknowledge && getComputedStyle(acknowledge).boxShadow,
      focused: shadow?.activeElement === acknowledge,
      focusStyle: acknowledge && getComputedStyle(acknowledge).outlineStyle,
      focusDecoration: acknowledge && getComputedStyle(acknowledge).textDecorationLine,
    };
  })()`)
  if (!onboardingAppearance.visible || onboardingAppearance.launcherShadow !== 'none'
      || onboardingAppearance.buttonShadow !== 'none' || !onboardingAppearance.focused
      || onboardingAppearance.focusStyle !== 'none' || onboardingAppearance.focusDecoration !== 'underline') {
    failures.push('onboarding uses flat controls and a text focus indicator without an outline')
  }
  if (artifactDirectory) {
    mkdirSync(artifactDirectory, { recursive: true })
    const screenshot = await send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false })
    writeFileSync(path.join(artifactDirectory, 'radar-onboarding.png'), Buffer.from(screenshot.data, 'base64'))
  }

  const onboardingLayouts = []
  for (const [name, width, height] of [['desktop', 1000, 720], ['compact', 390, 640]]) {
    await send('Emulation.setDeviceMetricsOverride', { width, height, deviceScaleFactor: 1, mobile: false })
    await evaluateValue('new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))')
    const layout = await evaluateValue(`(() => {
      const shadow = document.querySelector('[data-bcp-repeat-reminder-owned]').shadowRoot;
      const body = shadow.querySelector('.onboarding-body');
      const card = body.getBoundingClientRect();
      const actions = shadow.querySelector('.onboarding-actions').getBoundingClientRect();
      return {
        insideViewport: card.left >= 0 && card.top >= 0 && card.right <= innerWidth && card.bottom <= innerHeight,
        actionsVisible: actions.top >= card.top && actions.bottom <= card.bottom,
        noHorizontalOverflow: body.scrollWidth <= body.clientWidth,
        settingsCount: shadow.querySelectorAll('.onboarding-setting-list li').length,
        autoPlusOneOff: !shadow.querySelector('.onboarding-auto-plus-one input').checked,
        bodyShadow: getComputedStyle(body).boxShadow,
      };
    })()`)
    onboardingLayouts.push({ name, ...layout })
    if (!layout.insideViewport || !layout.actionsVisible || !layout.noHorizontalOverflow
        || layout.settingsCount !== 7 || !layout.autoPlusOneOff || layout.bodyShadow !== 'none') {
      failures.push(`onboarding ${name} keeps content and actions accessible without shadows`)
    }
    if (artifactDirectory) {
      const capture = async (suffix) => {
        const screenshot = await send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false })
        writeFileSync(path.join(artifactDirectory, `radar-onboarding-${name}${suffix}.png`), Buffer.from(screenshot.data, 'base64'))
      }
      await capture('')
      await evaluateValue(`(() => {
        const body = document.querySelector('[data-bcp-repeat-reminder-owned]').shadowRoot.querySelector('.onboarding-body');
        body.scrollTop = body.scrollHeight;
        return true;
      })()`)
      await capture('-scrolled')
      await evaluateValue(`document.querySelector('[data-bcp-repeat-reminder-owned]').shadowRoot.querySelector('.onboarding-body').scrollTop = 0`)
    }
  }
  await send('Emulation.setDeviceMetricsOverride', { width: 1000, height: 720, deviceScaleFactor: 1, mobile: false })

  await evaluateValue(`(async () => {
    document.querySelector('[data-bcp-repeat-reminder-owned]')?.shadowRoot
      ?.querySelector('.onboarding-acknowledge')?.click();
    const runtime = globalThis.__danmakuEchoFavoritesRuntime;
    if (!runtime) throw new Error('Favorites runtime unavailable');
    for (const text of ['这波操作漂亮', '一起加油', '前方高能', '好耶', '精彩', '来了来了']) {
      await runtime.favoriteText(text);
    }
    return true;
  })()`)
  await waitFor(`!document.querySelector('.bcp-one-toast.is-visible')`)
  await send('Emulation.setDeviceMetricsOverride', { width: 1000, height: 720, deviceScaleFactor: 1, mobile: false })
  await open()
  const idle = await snapshot('idle')
  if (idle.options.length !== 8) failures.push('six favorites and two navigation options')
  for (const kind of ['favorite', 'other', 'more']) {
    const option = idle.options.find((item) => item.kind === kind)
    await mouse(option.x, option.y)
    await waitFor(`Boolean(${root}?.querySelector('.bcp-favorites-radial-center.is-${kind}'))`)
    await snapshot(kind)
  }
  await mouse(idle.x, idle.y)
  await delay(150)
  const centered = await read()
  if (!centered.classes.includes('is-idle')) failures.push('center cancels selection')
  await cancel()
  if (await evaluateValue(`Boolean(document.querySelector('.bcp-favorites-host')?.dataset.bcpFavoritesLastSend)`)) failures.push('cancel must not send')

  await evaluateValue(`(() => {
    const host = document.querySelector('.bcp-favorites-host');
    host.style.setProperty('--bcp-action-start', '#cc6600');
    host.style.setProperty('--bcp-action-end', '#a34e00');
    return true;
  })()`)
  await open()
  const themed = await read()
  if (!themed.background.includes('rgb(204, 102, 0)') || !themed.background.includes('rgb(163, 78, 0)')) failures.push('custom palette must be inherited')
  await cancel()
  await evaluateValue(`(() => {
    const host = document.querySelector('.bcp-favorites-host');
    host.style.removeProperty('--bcp-action-start');
    host.style.removeProperty('--bcp-action-end');
    return true;
  })()`)

  // Exercise actual Alt+Q release navigation; no messages are sent.
  await open()
  const more = (await read()).options.find((item) => item.kind === 'more')
  await mouse(more.x, more.y)
  await key('keyUp')
  await waitFor(`Boolean(${root}?.querySelector('.bcp-favorites-panel'))`)
  await cancel()

  await send('Emulation.setDeviceMetricsOverride', { width: 420, height: 640, deviceScaleFactor: 1, mobile: false })
  await send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-reduced-motion', value: 'reduce' }] })
  await open()
  const compact = await snapshot('compact-reduced')
  if (compact.options.some((item) => !item.visible)) failures.push('compact wheel options clipped')
  await mouse(compact.options[0].x, compact.options[0].y)
  const reduced = await snapshot('selected-reduced')
  if (reduced.runningAnimations !== 0) failures.push('reduced motion must disable animations')
  await cancel()
  await send('Emulation.setEmulatedMedia', { features: [] })
  await send('Emulation.clearDeviceMetricsOverride')
  return { samples, onboardingAppearance, onboardingLayouts, assertionFailures: failures }
}
