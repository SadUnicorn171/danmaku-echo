'use strict'

const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const test = require('node:test')

const contentSource = fs.readFileSync(
  path.join(__dirname, '..', 'src', 'entries', 'content.ts'),
  'utf8',
)
const inertSnapshotSource = fs.readFileSync(
  path.join(__dirname, '..', 'src', 'platforms', 'live', 'inert-snapshot.ts'),
  'utf8',
)
const contentOverlaySource = fs.readFileSync(
  path.join(__dirname, '..', 'src', 'components', 'live', 'ContentOverlay.vue'),
  'utf8',
)
const douyuNativeHoverSource = fs.readFileSync(
  path.join(__dirname, '..', 'src', 'platforms', 'douyu', 'native-hover.ts'),
  'utf8',
)
const douyuNativeMotionFallbackSource = fs.readFileSync(
  path.join(__dirname, '..', 'src', 'platforms', 'douyu', 'native-motion-fallback.ts'),
  'utf8',
)
const douyinContentSource = fs.readFileSync(
  path.join(__dirname, '..', 'src', 'entries', 'douyin-content.ts'),
  'utf8',
)
const douyinPageHookSource = fs.readFileSync(
  path.join(__dirname, '..', 'src', 'entries', 'douyin-page-hook.ts'),
  'utf8',
)
const repeatReminderCollectorSource = fs.readFileSync(
  path.join(__dirname, '..', 'src', 'features', 'repeat-reminder', 'collector.ts'),
  'utf8',
)
const freezeOverlaySource = contentSource.match(
  /function freezeOverlayCandidate\(candidate\) \{[\s\S]*?\n  \}/,
)

test('rejects media-bearing overlay candidates and builds inert frozen snapshots', () => {
  assert.match(contentSource, /from ['"]\.\.\/platforms\/live\/inert-snapshot['"]/)
  assert.ok(freezeOverlaySource, 'freezeOverlayCandidate should exist')
  assert.match(
    freezeOverlaySource[0],
    /createInertOverlaySnapshot\(candidate, \{[\s\S]*?skipSelector: INERT_SNAPSHOT_SKIP_SELECTOR/,
  )
  assert.match(
    freezeOverlaySource[0],
    /snapshot\.classList\.add\(["']bcp-one-frozen["'], ["']bcp-one-target["']\)/,
  )
  assert.doesNotMatch(freezeOverlaySource[0], /cloneNode/)
  assert.doesNotMatch(contentSource, /\.cloneNode\(/)
  assert.match(contentSource, /INERT_SNAPSHOT_SKIP_SELECTOR/)
  assert.match(contentSource, /const OVERLAY_SNAPSHOT_NODE_LIMIT = 48/)
  assert.match(freezeOverlaySource[0], /nodeLimit: OVERLAY_SNAPSHOT_NODE_LIMIT/)
  assert.match(inertSnapshotSource, /SNAPSHOT_DESCENDANT_STYLE_PROPERTIES/)
  assert.match(inertSnapshotSource, /copyPresentation\(child, inertChild, true\)/)
})

test('keeps Douyin repeat-reminder collection off whole-page hot paths', () => {
  const queueNodeSource = repeatReminderCollectorSource.match(
    /function queueNode\(node: Node\): void \{[\s\S]*?\n  \}/,
  )
  const ingestSource = douyinContentSource.match(
    /function ingestDouyinRendererRepeatReminderMessage\(data\) \{[\s\S]*?\n  \}/,
  )
  const ownChatObserverSource = douyinContentSource.match(
    /function startOwnChatObserver\(\) \{[\s\S]*?\n  \}/,
  )

  assert.ok(queueNodeSource, 'repeat-reminder queueNode should exist')
  assert.doesNotMatch(queueNodeSource[0], /discoverRoots\(node\)/)
  assert.ok(ingestSource, 'Douyin renderer reminder ingestion should exist')
  assert.match(ingestSource[0], /richPayloadFromRendererContent/)
  assert.doesNotMatch(ingestSource[0], /resolveRichPayloadWithRetry/)
  assert.match(douyinContentSource, /rootSelectors: CHAT_ROOT_SELECTORS/)
  assert.match(
    douyinContentSource,
    /repeatReminderEnabled: rendererEnabled && repeatReminderEnabled\(\)/,
  )
  assert.ok(ownChatObserverSource, 'scoped Douyin chat observer should exist')
  assert.match(ownChatObserverSource[0], /ownChatRoots\(\)/)
  assert.doesNotMatch(ownChatObserverSource[0], /observe\(document\.documentElement/)
  assert.match(
    douyinPageHookSource,
    /if \(rendererRepeatReminderEnabled\) \{[\s\S]*?type: "repeat-reminder-message"/,
  )
  assert.match(douyinPageHookSource, /douyinRepeatReminderExclusionReason/)
  assert.match(douyinPageHookSource, /excludedReason: repeatReminderExclusion/)
  assert.match(douyinContentSource, /rememberRepeatReminderSuppression\(resolvedText\)/)
  assert.match(douyinContentSource, /state\.repeatReminderRuntime\?\.suppressText\(text\)/)
})

test('suppresses Bilibili lottery entries across chat and video reminder sources', () => {
  assert.match(contentSource, /platforms\/bilibili\/repeat-reminder-filter/)
  assert.match(contentSource, /describe: describeRepeatReminderCandidate/)
  assert.match(
    contentSource,
    /function describeRepeatReminderCandidate[\s\S]*?bilibiliRepeatReminderExclusionReason[\s\S]*?rememberBilibiliRepeatReminderSuppression/,
  )
  assert.match(
    contentSource,
    /function rememberBilibiliRepeatReminderSuppression[\s\S]*?state\.repeatReminderRuntime\?\.suppressText\(text\)/,
  )
})

test("uses an ownership-scoped Douyu pause fallback after native resume", () => {
  const douyuFreezeBranch = freezeOverlaySource[0].match(
    /if \(platformId === ['"]douyu['"] && candidate instanceof HTMLElement\) \{[\s\S]*?\n    \}/,
  )
  assert.ok(douyuFreezeBranch, 'Douyu freeze branch should exist')
  assert.match(contentSource, /platforms\/douyu\/native-hover/)
  assert.match(contentSource, /platforms\/douyu\/native-motion-fallback/)
  assert.doesNotMatch(contentSource, /platforms\/douyu\/overlay-motion/)
  assert.match(
    douyuFreezeBranch[0],
    /if \(platformId === ['"]douyu['"] && candidate instanceof HTMLElement\) \{[\s\S]*?douyuNativeMotionFallback\?\.pause\(candidate\)[\s\S]*?state\.pausedAnimations = \[\][\s\S]*?return/,
  )
  assert.doesNotMatch(douyuFreezeBranch[0], /getAnimations|animation\.pause|animation\.play/)
  assert.doesNotMatch(douyuNativeHoverSource, /getAnimations|animation\.pause|animation\.play/)
  assert.match(douyuNativeMotionFallbackSource, /candidate\.getAnimations\(\)/)
  assert.match(douyuNativeMotionFallbackSource, /animation\.pause\(\)/)
  assert.match(douyuNativeMotionFallbackSource, /queueMicrotask\([\s\S]*?animation\.play\(\)/)
  assert.match(
    douyuNativeMotionFallbackSource,
    /current\.has\(animation\)[\s\S]*?animationTarget\(animation\) !== releasedCandidate/,
  )
  assert.doesNotMatch(douyuNativeMotionFallbackSource, /subtree:\s*true/)
  assert.match(
    contentSource,
    /douyuNativeHover\?\.release[\s\S]*?douyuNativeMotionFallback\?\.release\(douyuCandidate\)/,
  )
  assert.doesNotMatch(contentSource, /scheduleDouyuActionBar|verifyNativePause/)
  assert.doesNotMatch(contentSource, /appendChild\(state\.actionBar\)|bcpDouyuHoverJoined/)
  assert.match(contentSource, /!candidate\.contains\(nativeTarget\)[\s\S]*?isOwned\(nativeTarget\)/)
  assert.doesNotMatch(contentSource, /ensureEntered/)
  assert.match(
    contentOverlaySource,
    /\.bcp-one-hover-bridge \{[\s\S]*?pointer-events:\s*auto\s*!important/,
  )
  assert.match(
    contentSource,
    /isInsideSelectedHoverBody\(next\)[\s\S]*?douyuNativeHover\?\.hold\(event\.target\)[\s\S]*?stopImmediatePropagation/,
  )
  assert.match(
    contentSource,
    /if \(mutation\.type === ['"]attributes['"]\)[\s\S]*?element\.closest\(["']\[class\*=['"]danmuItem-["']\]["']\)[\s\S]*?element\.matches/,
  )
  assert.match(
    contentSource,
    /platformId === ['"]douyu['"] && mutation\.type === ['"]attributes['"]\) return false/,
  )
  assert.match(
    contentSource,
    /nextDouyuCandidate !== state\.candidate[\s\S]*?douyuNativeHover\?\.nativeExitWillProceed\(\)[\s\S]*?clearSelection\(\)/,
  )
  assert.match(
    contentSource,
    /enteringCandidate !== state\.candidate[\s\S]*?event\.stopImmediatePropagation\(\)/,
  )
  assert.match(contentSource, /addEventListener\(['"]mouseover['"], onMouseOver, true\)/)
})

test('pauses Bilibili CSS motion without rewriting its animation timeline', () => {
  assert.match(contentSource, /platforms\/bilibili\/overlay-motion/)
  assert.match(
    freezeOverlaySource[0],
    /platformId === ['"]bilibili['"][\s\S]*?bilibiliOverlayMotion\?\.pause\(candidate\)[\s\S]*?state\.pausedAnimations = \[\]/,
  )
  assert.match(contentSource, /frozenClone\.remove\(\)[\s\S]*?bilibiliOverlayMotion\?\.release\(/)
  assert.match(
    contentOverlaySource,
    /\[data-bcp-bilibili-motion-paused='true'\][\s\S]*?animation-play-state:\s*paused\s*!important/,
  )
})

test('keeps long-running Bilibili hover work bounded', () => {
  assert.match(contentSource, /const BILIBILI_OVERLAY_CACHE_TTL = 180/)
  assert.match(contentSource, /const BILIBILI_OVERLAY_CACHE_LIMIT = 240/)
  assert.match(contentSource, /const BILIBILI_OVERLAY_ROW_SELECTOR = ['"]\.bili-danmaku-x-dm['"]/)
  assert.match(contentSource, /const SENDER_SCAN_MIN_INTERVAL = 240/)

  const overlayCandidatesSource = contentSource.match(
    /function overlayMessageCandidates\(\) \{[\s\S]*?\n  \}/,
  )
  assert.ok(overlayCandidatesSource, 'overlayMessageCandidates should exist')
  assert.match(overlayCandidatesSource[0], /queryDocumentElements\(config\.overlayMessages\)/)
  assert.match(overlayCandidatesSource[0], /\.map\(normalizeOverlayCandidate\)/)
  assert.match(contentSource, /function normalizeOverlayCandidate\(element\)/)
  assert.match(
    contentSource,
    /function richPayloadFromCandidate\(candidate\) \{[\s\S]*?candidate\.matches\(BILIBILI_OVERLAY_ROW_SELECTOR\)[\s\S]*?!candidate\.querySelector\(['"]img['"]\)[\s\S]*?content\.textContent/,
  )
  assert.match(
    contentSource,
    /function messageRows\(\) \{[\s\S]*?isInsideBilibiliVideoOverlay\(element\)/,
  )

  const findCandidateSource = contentSource.match(/function findCandidate\(path\) \{[\s\S]*?\n  \}/)
  assert.ok(findCandidateSource, 'findCandidate should exist')
  assert.ok(
    findCandidateSource[0].indexOf('closestFromPath(path, config.overlayMessages)') <
      findCandidateSource[0].indexOf('pathTouchesBilibiliQuickInput(path)'),
    'Bilibili video danmaku should take the fast path before chat-only guards',
  )

  const selectCandidateSource = contentSource.match(
    /function selectCandidate\(candidate, kind, allowNoVisibleActions, pointer, nativeTarget = null\) \{[\s\S]*?\n  \}/,
  )
  assert.ok(selectCandidateSource, 'selectCandidate should exist')
  assert.match(selectCandidateSource[0], /freezeOverlayCandidate\(candidate\)/)
  assert.match(selectCandidateSource[0], /scanDom:\s*false/)
  assert.match(selectCandidateSource[0], /state\.overlayViewport = selectedOverlayViewport/)
  assert.match(selectCandidateSource[0], /scheduleOverlayHydration\(selectionId\)/)
  assert.match(contentSource, /const OVERLAY_HYDRATION_DELAY = 24/)
  assert.match(contentSource, /function hydrateSelectedOverlay\(selectionId\)/)
  assert.match(contentSource, /function ensureSelectedOverlayHydrated\(\)/)
  assert.ok(
    selectCandidateSource[0].indexOf('freezeOverlayCandidate(candidate)') <
      selectCandidateSource[0].indexOf('senderFromCandidate('),
    'the moving overlay must be frozen before sender correlation work',
  )
  const pointerMoveSource = contentSource.match(/function onPointerMove\(event\) \{[\s\S]*?\n  \}/)
  assert.ok(pointerMoveSource, 'onPointerMove should exist')
  assert.ok(
    pointerMoveSource[0].indexOf('state.frozenClone && state.frozenClone.isConnected') <
      pointerMoveSource[0].indexOf('pathTouchesBilibiliChatActions(path)'),
    'a frozen Bilibili danmaku must bypass chat-action detection',
  )
  assert.match(
    contentSource,
    /if \(target && isInsideBilibiliPlayerOutsideChat\(target\)\) \{\s*return false/,
  )
})
