import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'
import vm from 'node:vm'
import { resolve } from 'node:path'
import { build } from 'vite'

const root = resolve(import.meta.dirname, '..')
const buildResult = await build({
  configFile: false,
  logLevel: 'silent',
  publicDir: false,
  root,
  build: {
    emptyOutDir: false,
    lib: {
      entry: resolve(root, 'src', 'platforms', 'live', 'action-visibility.ts'),
      fileName: () => 'live-action-visibility.js',
      formats: ['iife'],
      name: 'DanmakuEchoLiveActionVisibility',
    },
    minify: false,
    outDir: resolve(root, 'build', 'test-artifacts'),
    sourcemap: false,
    target: 'chrome110',
    write: false,
  },
})
const output = Array.isArray(buildResult) ? buildResult[0] : buildResult
const source = output.output.find((entry) => entry.type === 'chunk')?.code
if (!source) throw new Error('Could not build live action visibility test module')
const context = {}
context.globalThis = context
vm.runInNewContext(source, context, { filename: 'live-action-visibility.js' })
const { shouldHideNativeDanmakuCapsule, visibleActionsForSurface } =
  context.DanmakuEchoLiveActionVisibility
const sharedContentStyles = readFileSync(
  resolve(root, 'src', 'assets', 'styles', 'content.css'),
  'utf8',
)
const sharedContentSource = readFileSync(resolve(root, 'src', 'entries', 'content.ts'), 'utf8')
const douyuNativeCapsuleSource = readFileSync(
  resolve(root, 'src', 'platforms', 'douyu', 'native-capsule.ts'),
  'utf8',
)
const douyinContentStyles = readFileSync(
  resolve(root, 'src', 'assets', 'styles', 'douyin-content.css'),
  'utf8',
)
const douyinPageHook = readFileSync(resolve(root, 'src', 'entries', 'douyin-page-hook.ts'), 'utf8')
const popupSource = readFileSync(resolve(root, 'src', 'App.vue'), 'utf8')

const settings = {
  actions: { copy: false, plusOne: true, reply: true, favorite: true },
  sideChatCapsule: { huya: false, bilibili: false, douyu: false },
}

test('hides the complete side-chat capsule by default', () => {
  assert.deepEqual(
    { ...visibleActionsForSurface(settings, 'huya', 'chat') },
    { copy: false, plusOne: false, reply: false, favorite: false },
  )
  assert.deepEqual(
    { ...visibleActionsForSurface(settings, 'bilibili', 'chat') },
    { copy: false, plusOne: false, reply: false, favorite: false },
  )
  assert.deepEqual(
    { ...visibleActionsForSurface(settings, 'douyu', 'chat') },
    { copy: false, plusOne: false, reply: false, favorite: false },
  )
})

test('keeps Douyu side-chat nodes out of the overlay fallback paths', () => {
  assert.match(
    sharedContentSource,
    /platformId === ['"]douyu['"] && closestMatching\(element, config\.chatRoots\)/,
  )
  assert.match(
    sharedContentSource,
    /if \(overlay && isOverlayMessageElement\(overlay\)\) \{\s*return \{ element: overlay, kind: ['"]overlay['"] \}/,
  )
  assert.match(
    sharedContentSource,
    /exact &&[\s\S]{0,100}isOverlayMessageElement\(exact\) &&[\s\S]{0,100}pointInsideOverlayViewport\(exact, x, y\)[\s\S]{0,40}return exact/,
  )
})

test('enables each platform side-chat capsule independently', () => {
  const enabled = {
    ...settings,
    sideChatCapsule: { huya: true, bilibili: false, douyu: true },
  }
  assert.deepEqual(
    { ...visibleActionsForSurface(enabled, 'huya', 'chat') },
    { copy: false, plusOne: true, reply: true, favorite: true },
  )
  assert.deepEqual(
    { ...visibleActionsForSurface(enabled, 'bilibili', 'chat') },
    { copy: false, plusOne: false, reply: false, favorite: false },
  )
  assert.deepEqual(
    { ...visibleActionsForSurface(enabled, 'douyu', 'chat') },
    { copy: false, plusOne: true, reply: true, favorite: true },
  )
})

test('uses the existing global action choices inside an enabled capsule', () => {
  const customized = {
    actions: { copy: false, plusOne: false, reply: true, favorite: false },
    sideChatCapsule: { huya: true, bilibili: true, douyu: true },
  }
  assert.deepEqual(
    { ...visibleActionsForSurface(customized, 'bilibili', 'chat') },
    { copy: false, plusOne: false, reply: true, favorite: false },
  )
})

test('supports a copy-only capsule and keeps copy off by default', () => {
  assert.equal(visibleActionsForSurface(settings, 'huya', 'overlay').copy, false)
  const copyOnly = {
    actions: { copy: true, plusOne: false, reply: false, favorite: false },
    sideChatCapsule: { huya: true, bilibili: true, douyu: true },
  }
  assert.deepEqual(
    { ...visibleActionsForSurface(copyOnly, 'douyu', 'chat') },
    { copy: true, plusOne: false, reply: false, favorite: false },
  )
})

test('keeps video-overlay plus-one controlled by the existing global action', () => {
  assert.equal(visibleActionsForSurface(settings, 'huya', 'overlay').plusOne, true)
  assert.equal(visibleActionsForSurface(settings, 'bilibili', 'overlay').plusOne, true)
  assert.equal(visibleActionsForSurface(settings, 'douyu', 'overlay').plusOne, true)
  assert.equal(
    visibleActionsForSurface(
      {
        ...settings,
        actions: { ...settings.actions, plusOne: false },
      },
      'huya',
      'overlay',
    ).plusOne,
    false,
  )
})

test('keeps the Douyu native danmaku capsule off by default and independently switchable', () => {
  const enabled = {
    enabled: true,
    nativeDanmakuCapsule: { douyu: false },
    platforms: { huya: true, bilibili: true, douyin: true, douyu: true },
  }
  assert.equal(shouldHideNativeDanmakuCapsule(enabled, 'douyu'), true)
  assert.equal(shouldHideNativeDanmakuCapsule(enabled, 'huya'), false)
  assert.equal(shouldHideNativeDanmakuCapsule({ ...enabled, enabled: false }, 'douyu'), false)
  assert.equal(
    shouldHideNativeDanmakuCapsule(
      {
        ...enabled,
        platforms: { ...enabled.platforms, douyu: false },
      },
      'douyu',
    ),
    false,
  )
  assert.equal(
    shouldHideNativeDanmakuCapsule(
      {
        ...enabled,
        nativeDanmakuCapsule: { douyu: true },
      },
      'douyu',
    ),
    false,
  )
  assert.match(popupSource, /id="native-danmaku-capsule-douyu"/)
  assert.match(popupSource, /v-model="settings\.nativeDanmakuCapsule\.douyu"/)
})

test('targets only Douyu native video-danmaku capsule controls', () => {
  assert.match(
    sharedContentStyles,
    /\[class\*='danmuItem-'\][\s\S]{0,160}\[class\*='interactive-element-'\]/,
  )
  assert.match(
    sharedContentStyles,
    /\[class\*='danmuItem-'\][\s\S]{0,220}\[class\*='reply-button-'\]/,
  )
  assert.match(
    sharedContentStyles,
    /\[class\*='danmuItem-'\][\s\S]{0,280}\[class\*='action-button-'\]/,
  )
  assert.match(
    sharedContentStyles,
    /:not\(\[class\*='danmuItem-'\]\):has\(> \[class\*='interactive-element-'\]\):has\([\s\S]{0,80}> \[class\*='reply-button-'\]/,
  )
  assert.match(sharedContentStyles, /data-bcp-douyu-native-action-hidden/)
  assert.match(
    sharedContentStyles,
    /\[class\*='danmuItem-'\][\s\S]{0,80}\[class\*='afterpic-'\][\s\S]{0,80}visibility:\s*hidden/,
  )
  assert.doesNotMatch(sharedContentStyles, /afterpic-[^}]*display:\s*none/s)
  assert.doesNotMatch(sharedContentStyles, /afterDiv-/)
  assert.doesNotMatch(sharedContentStyles, /bcp-douyu-hover-joined/)
  assert.match(
    sharedContentStyles,
    /\):not\(\[data-bcp-one-owned\]\)[\s\S]{0,100}visibility:\s*hidden/,
  )
  assert.match(
    sharedContentStyles,
    /data-bcp-douyu-native-capsule-hidden='true'\] \[class\*='btnscontainerrect-'\]/,
  )
  assert.match(sharedContentStyles, /\[class\*='btnscontainerrect-'\]::before/)
  assert.match(sharedContentSource, /findDouyuNativeDanmakuCapsuleTargets/)
  assert.match(douyuNativeCapsuleSource, /DOUYU_NATIVE_DANMAKU_CAPSULE_DECORATION_SELECTORS/)
  assert.match(
    douyuNativeCapsuleSource,
    /DOUYU_NATIVE_DANMAKU_CAPSULE_DETACHED_DECORATION_SELECTORS/,
  )
  assert.match(
    sharedContentSource,
    /platformId === ['"]douyu['"] \? DOUYU_NATIVE_DANMAKU_CAPSULE_DECORATION_SELECTORS : \[\]/,
  )
  assert.match(sharedContentSource, /queryAllDeep\(DOUYU_NATIVE_DANMAKU_ACTION_SELECTORS\)/)
  assert.match(
    sharedContentSource,
    /queryAllDeep\(DOUYU_NATIVE_DANMAKU_CAPSULE_DETACHED_DECORATION_SELECTORS\)/,
  )
  assert.match(sharedContentSource, /mutationContainsDouyuNativeDanmakuCapsule/)
  assert.match(sharedContentSource, /scanDouyuNativeDanmakuCapsules\(\)/)
  assert.match(sharedContentSource, /douyuNativeCapsuleVisibility\.hide\(activeTargets\)/)
  assert.doesNotMatch(sharedContentSource, /scheduleDouyuNativeDanmakuCapsuleScan/)
  assert.match(douyuNativeCapsuleSource, /element\.hidden = true/)
  assert.match(douyuNativeCapsuleSource, /if \(target\.closest\(DANMAKU_ITEM_SELECTOR\)\) continue/)
  assert.match(douyuNativeCapsuleSource, /setProperty\(property, expected, ['"]important['"]\)/)
  assert.match(douyuNativeCapsuleSource, /showAll\(\): void/)
  assert.doesNotMatch(sharedContentStyles, /ChatBarrageCollect[\s\S]*?display:\s*none/)
})

test('gives every enabled action an equal width on every capsule', () => {
  for (const [styles, selector] of [
    [sharedContentStyles, '.bcp-one-action'],
    [douyinContentStyles, '.bcp-douyin-dom-action-item'],
    [douyinContentStyles, '.bcp-douyin-action-item'],
  ]) {
    const escapedSelector = selector.replaceAll('.', '\\.')
    const block = styles.match(new RegExp(`${escapedSelector}\\s*\\{[\\s\\S]*?\\}`))
    assert.ok(block, `${selector} styles should exist`)
    assert.match(block[0], /flex:\s*0 0 var\(--bcp-capsule-item-width,\s*56px\)/)
    assert.match(block[0], /min-width:\s*var\(--bcp-capsule-item-width,\s*56px\)/)
    assert.match(block[0], /width:\s*var\(--bcp-capsule-item-width,\s*56px\)/)
  }
  assert.match(
    douyinPageHook,
    /DOM_ACTION_ITEM_WIDTHS[\s\S]*?plusOne:\s*56,[\s\S]*?reply:\s*56,[\s\S]*?favorite:\s*56,[\s\S]*?copy:\s*56/,
  )
})

test('keeps the Douyu overlay capsule in the shared fixed portal', () => {
  assert.doesNotMatch(sharedContentSource, /appendChild\(state\.actionBar\)/)
  assert.doesNotMatch(sharedContentSource, /bcpDouyuHoverJoined/)
  assert.match(
    sharedContentSource,
    /const bridge = ensureOverlayHoverBridge\(bridgeHost, ['"]fixed['"]\)/,
  )
})

test('confines moving overlay hover and controls to the visible player viewport', () => {
  assert.match(sharedContentSource, /function overlayViewportRect\(candidate\)/)
  assert.match(
    sharedContentSource,
    /pointElements\.some\(\(element\) => closestMatching\(element, config\.chatRoots\)\)/,
  )
  assert.match(
    sharedContentSource,
    /pointInsideRect\(rect, x, y\) && pointInsideOverlayViewport\(candidate, x, y\)/,
  )
  assert.match(sharedContentSource, /snapshot\.style\.setProperty\(\s*['"]clip-path['"]/)
  assert.match(sharedContentSource, /Object\.values\(clip\)\.some\(\(value\) => value > 0\)/)
  assert.match(sharedContentSource, /snapshot\.dataset\.bcpOneEdgeClipped = ['"]true['"]/)
  assert.match(
    sharedContentStyles,
    /\.bcp-one-frozen\.bcp-one-target\[data-bcp-one-edge-clipped='true'\]\s*\{[\s\S]*?box-shadow:\s*inset 0 0 0 1px[\s\S]*?outline:\s*none/,
  )
  assert.doesNotMatch(
    sharedContentStyles,
    /\.bcp-one-frozen\.bcp-one-target\s*\{[\s\S]*?box-shadow:/,
  )
  assert.match(
    sharedContentSource,
    /const actionViewport =[\s\S]{0,240}overlayViewportRect\(state\.candidate\)/,
  )
  assert.match(
    sharedContentSource,
    /!pointInsideOverlayViewport\(state\.candidate, pointer\.x, pointer\.y\)[\s\S]{0,80}clearSelection\(\)/,
  )
  assert.match(sharedContentSource, /function pointerCoordinates\(event\)/)
  assert.match(sharedContentSource, /!event\.isTrusted && x === 0 && y === 0/)
})

test('keeps every capsule divider on the same scalable width variable', () => {
  for (const [styles, selector] of [
    [sharedContentStyles, '.bcp-one-action-divider'],
    [douyinContentStyles, '.bcp-douyin-dom-action-divider'],
    [douyinContentStyles, '.bcp-douyin-action-divider'],
  ]) {
    const escapedSelector = selector.replaceAll('.', '\\.')
    const block = styles.match(new RegExp(`${escapedSelector}\\s*\\{[\\s\\S]*?\\}`))
    assert.ok(block, `${selector} styles should exist`)
    assert.match(block[0], /flex:\s*0 0 var\(--bcp-capsule-divider-width,\s*2px\)/)
    assert.match(block[0], /min-width:\s*var\(--bcp-capsule-divider-width,\s*2px\)/)
    assert.match(block[0], /max-width:\s*var\(--bcp-capsule-divider-width,\s*2px\)/)
    assert.match(block[0], /width:\s*var\(--bcp-capsule-divider-width,\s*2px\)/)
  }
  assert.match(douyinPageHook, /DOM_ACTION_DIVIDER_WIDTH\s*=\s*2/)
  assert.match(
    douyinPageHook,
    /rendererSnapToDevicePixel\(DOM_ACTION_ITEM_WIDTHS\[key\]\)/,
  )
  assert.match(
    douyinPageHook,
    /rendererSnapToDevicePixel\(DOM_ACTION_DIVIDER_WIDTH\)/,
  )
})
