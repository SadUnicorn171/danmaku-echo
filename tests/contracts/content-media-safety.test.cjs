'use strict'

const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const test = require('node:test')

const projectRoot = path.resolve(__dirname, '..', '..')

const contentEntrySource = fs.readFileSync(
  path.join(projectRoot, 'src', 'entries', 'content.ts'),
  'utf8',
)
const contentSource = fs.readFileSync(
  path.join(projectRoot, 'src', 'entries', 'content-app.ts'),
  'utf8',
)
const hoverSelectionSource = fs.readFileSync(
  path.join(projectRoot, 'src', 'platforms', 'live', 'hover-selection-controller.ts'),
  'utf8',
)
const liveContentRuntimeSource = fs.readFileSync(
  path.join(projectRoot, 'src', 'platforms', 'live', 'live-content-runtime.ts'),
  'utf8',
)
const inertSnapshotSource = fs.readFileSync(
  path.join(projectRoot, 'src', 'platforms', 'live', 'inert-snapshot.ts'),
  'utf8',
)
const contentOverlaySource = fs.readFileSync(
  path.join(projectRoot, 'src', 'components', 'live', 'ContentOverlay.vue'),
  'utf8',
)
const douyuNativeHoverSource = fs.readFileSync(
  path.join(projectRoot, 'src', 'platforms', 'douyu', 'native-hover.ts'),
  'utf8',
)
const douyuNativeMotionFallbackSource = fs.readFileSync(
  path.join(projectRoot, 'src', 'platforms', 'douyu', 'native-motion-fallback.ts'),
  'utf8',
)
const douyinContentAppSource = fs.readFileSync(
  path.join(projectRoot, 'src', 'platforms', 'douyin', 'content', 'content-app.ts'),
  'utf8',
)
const douyinOwnMessageControllerSource = fs.readFileSync(
  path.join(
    projectRoot,
    'src',
    'platforms',
    'douyin',
    'content',
    'own-message-controller.ts',
  ),
  'utf8',
)
const douyinRadarCollectorSource = fs.readFileSync(
  path.join(projectRoot, 'src', 'platforms', 'douyin', 'content', 'radar-collector.ts'),
  'utf8',
)
const douyinPageHookSource = fs.readFileSync(
  path.join(projectRoot, 'src', 'entries', 'douyin-page-hook.ts'),
  'utf8',
)
const douyinPageAppSource = fs.readFileSync(
  path.join(projectRoot, 'src', 'platforms', 'douyin', 'page', 'page-app.ts'),
  'utf8',
)
const douyinPageRuntimeSource = fs.readFileSync(
  path.join(projectRoot, 'src', 'platforms', 'douyin', 'page', 'page-runtime.ts'),
  'utf8',
)
const douyinBarrageContentSource = fs.readFileSync(
  path.join(projectRoot, 'src', 'platforms', 'douyin', 'page', 'barrage-content.ts'),
  'utf8',
)
const repeatReminderCollectorSource = fs.readFileSync(
  path.join(projectRoot, 'src', 'features', 'repeat-reminder', 'collector.ts'),
  'utf8',
)
const repeatReminderAdapterSource = fs.readFileSync(
  path.join(projectRoot, 'src', 'platforms', 'live', 'repeat-reminder-adapter.ts'),
  'utf8',
)
const douyuAdapterSource = fs.readFileSync(
  path.join(projectRoot, 'src', 'platforms', 'douyu', 'adapter.ts'),
  'utf8',
)
const bilibiliAdapterSource = fs.readFileSync(
  path.join(projectRoot, 'src', 'platforms', 'bilibili', 'adapter.ts'),
  'utf8',
)
const senderIndexSource = fs.readFileSync(
  path.join(projectRoot, 'src', 'platforms', 'live', 'sender-index.ts'),
  'utf8',
)
const bilibiliSenderSource = fs.readFileSync(
  path.join(projectRoot, 'src', 'platforms', 'bilibili', 'sender.ts'),
  'utf8',
)
const freezeOverlaySource = contentSource.match(
  /function freezeOverlayCandidate\(candidate: Element\): void \{[\s\S]*?\n  \}/,
)

test('keeps the shared live entry as a strictly typed composition root', () => {
  assert.match(contentEntrySource, /import \{ startLiveContentApp \} from ['"]\.\/content-app['"]/)
  assert.match(contentEntrySource, /startLiveContentApp\(\)/)
  assert.doesNotMatch(contentEntrySource, /@ts-(?:nocheck|ignore|expect-error)/)
  assert.doesNotMatch(contentSource, /@ts-(?:nocheck|ignore|expect-error)|\bany\b/)
})

test('initializes shared editor dependencies before constructing the controller', () => {
  const controllerIndex = contentSource.indexOf('const replyController = new EditorController')
  assert.notEqual(controllerIndex, -1, 'replyController should exist')

  for (const declaration of [
    'const isVisible = isElementVisible',
    'const isBilibiliQuickInputRegion =',
  ]) {
    const dependencyIndex = contentSource.indexOf(declaration)
    assert.notEqual(dependencyIndex, -1, `${declaration} should exist`)
    assert.ok(
      dependencyIndex < controllerIndex,
      `${declaration} must be initialized before replyController construction`,
    )
  }
})

test('keeps Bilibili sending details behind the platform sender', () => {
  assert.match(contentSource, /new BilibiliSender\(/)
  assert.match(contentSource, /const platformSender =/)
  assert.match(contentSource, /platformSender\.sendRich\(/)
  assert.match(contentSource, /platformSender\.sendFavorite\(/)
  assert.doesNotMatch(contentSource, /BILIBILI_DIRECT_EMOTICON_SEND_MESSAGE/)
  assert.doesNotMatch(contentSource, /BILIBILI_INSTALL_NATIVE_SEND_OBSERVER/)
  assert.doesNotMatch(contentSource, /bilibiliRoomEmoticonIdentity/)
  assert.doesNotMatch(contentSource, /function (?:find|open|waitFor)UniqueBilibili/)
  assert.match(bilibiliSenderSource, /class BilibiliSender/)
  assert.match(bilibiliSenderSource, /uniqueBilibiliPanelItem/)
  assert.match(bilibiliSenderSource, /BILIBILI_DIRECT_EMOTICON_SEND_MESSAGE/)
  assert.match(bilibiliSenderSource, /startNativeSendObservation/)
})

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
  const ingestSource = douyinRadarCollectorSource.match(
    /function ingestRenderer\(message: DouyinRepeatReminderMessage\): void \{[\s\S]*?\n  \}/,
  )
  const ownChatObserverSource = douyinOwnMessageControllerSource.match(
    /function refresh\(\): void \{[\s\S]*?\n  \}/,
  )

  assert.ok(queueNodeSource, 'repeat-reminder queueNode should exist')
  assert.doesNotMatch(queueNodeSource[0], /discoverRoots\(node\)/)
  assert.ok(ingestSource, 'Douyin renderer reminder ingestion should exist')
  assert.match(ingestSource[0], /options\.resolveRendererPayload/)
  assert.doesNotMatch(ingestSource[0], /resolveWithRetry/)
  assert.match(douyinContentAppSource, /rootSelectors: CHAT_ROOT_SELECTORS/)
  assert.match(
    douyinContentAppSource,
    /repeatReminderEnabled: rendererEnabled && repeatReminderEnabled\(\)/,
  )
  assert.ok(ownChatObserverSource, 'scoped Douyin chat observer should exist')
  assert.match(ownChatObserverSource[0], /const currentRoots = new Set\(roots\(\)\)/)
  assert.doesNotMatch(ownChatObserverSource[0], /observe\(document\.documentElement/)
  assert.match(
    douyinPageAppSource,
    /if \(pageRuntime\.isRepeatReminderEnabled\(\)\) \{[\s\S]*?type: ['"]repeat-reminder-message['"]/,
  )
  assert.match(douyinPageAppSource, /prepareDouyinBarrage/)
  assert.doesNotMatch(douyinPageAppSource, /douyinRepeatReminderExclusionReason/)
  assert.match(douyinBarrageContentSource, /douyinRepeatReminderExclusionReason/)
  assert.match(douyinPageAppSource, /excludedReason: repeatReminderExclusion \|\| ['"]["']/)
  assert.match(douyinRadarCollectorSource, /suppress\(resolvedText\)/)
  assert.match(douyinRadarCollectorSource, /sink\?\.suppressText\(text\)/)
})

test('keeps the Douyin page entry thin and delegates lifecycle to DouyinPageRuntime', () => {
  assert.match(douyinPageHookSource, /createDouyinPageAppRuntime/)
  assert.match(douyinPageHookSource, /pageRuntime\.start\(\)/)
  assert.doesNotMatch(douyinPageHookSource, /@ts-(?:nocheck|ignore|expect-error)|\bany\b/)
  assert.match(douyinPageAppSource, /createDouyinPageRuntime/)
  assert.doesNotMatch(douyinPageAppSource, /@ts-(?:nocheck|ignore|expect-error)|\bany\b/)
  assert.doesNotMatch(douyinPageHookSource, /\bsetInterval\(/)
  assert.doesNotMatch(douyinPageHookSource, /canvasHook\.install\(\)/)
  assert.doesNotMatch(douyinPageHookSource, /workerHook\.install\(\)/)
  assert.doesNotMatch(douyinPageHookSource, /pageBridge\.start\(\)/)
  assert.doesNotMatch(douyinPageHookSource, /trackController\.start\(\)/)
  assert.doesNotMatch(
    douyinPageHookSource,
    /(?:document|window)\.addEventListener\(["'](?:fullscreenchange|visibilitychange|pagehide|pageshow)["']/,
  )
  assert.match(douyinPageRuntimeSource, /options\.canvasHook\.install\(\)/)
  assert.match(douyinPageRuntimeSource, /options\.workerHook\.install\(\)/)
  assert.match(douyinPageRuntimeSource, /options\.bridge\.start\(\)/)
  assert.match(douyinPageRuntimeSource, /options\.trackController\.start\(\)/)
  assert.match(douyinPageRuntimeSource, /options\.target\.setInterval\(/)
  assert.match(douyinPageRuntimeSource, /addEventListener\('fullscreenchange'/)
  assert.match(douyinPageRuntimeSource, /addEventListener\('visibilitychange'/)
  assert.match(douyinPageRuntimeSource, /addEventListener\('pagehide'/)
  assert.match(douyinPageRuntimeSource, /addEventListener\('pageshow'/)
})

test('delegates shared live-page lifecycle ownership to LiveContentRuntime', () => {
  assert.match(contentSource, /const liveRuntime = new LiveContentRuntime\(/)
  assert.match(contentSource, /liveRuntime\.start\(\)/)
  assert.match(contentSource, /createFavorites: \(\) =>/)
  assert.match(contentSource, /createRepeatReminder: \(\) =>/)
  assert.doesNotMatch(
    contentSource,
    /document\.addEventListener\(['"](?:click|pointerdown|keydown|fullscreenchange|webkitfullscreenchange|visibilitychange)['"]/,
  )
  assert.doesNotMatch(contentSource, /chrome\.(?:runtime|storage)\.[\s\S]*?\.addListener\(/)
  assert.match(liveContentRuntimeSource, /document\.addEventListener\('visibilitychange'/)
  assert.match(liveContentRuntimeSource, /window\.addEventListener\('pagehide'/)
  assert.match(liveContentRuntimeSource, /runtimeMessages\?\.addListener/)
  assert.match(liveContentRuntimeSource, /storageChanges\?\.addListener/)
  assert.match(liveContentRuntimeSource, /checkRoom\(\): boolean/)
})

test('suppresses Bilibili lottery entries across chat and video reminder sources', () => {
  assert.match(contentSource, /platforms\/live\/repeat-reminder-adapter/)
  assert.match(contentSource, /describe: repeatReminderAdapter\.describe/)
  assert.match(contentSource, /exclusionReason: platformAdapter\.repeatReminderExclusionReason/)
  assert.match(bilibiliAdapterSource, /repeatReminderExclusionReason: bilibiliRepeatReminderExclusionReason/)
  assert.match(repeatReminderAdapterSource, /options\.exclusionReason\([\s\S]*?suppressions\.set/)
  assert.match(
    repeatReminderAdapterSource,
    /options\.suppressText\(descriptor\.text\)/,
  )
  assert.match(contentSource, /state\.repeatReminderRuntime\?\.suppressText\(text\)/)
})

test("uses an ownership-scoped Douyu pause fallback after native resume", () => {
  const douyuFreezeBranch = freezeOverlaySource[0].match(
    /if \(platformId === ['"]douyu['"] && candidate instanceof HTMLElement\) \{[\s\S]*?\n    \}/,
  )
  assert.ok(douyuFreezeBranch, 'Douyu freeze branch should exist')
  assert.match(contentSource, /const douyuBoundary = platformAdapter\.douyu \|\| null/)
  assert.match(douyuAdapterSource, /from ['"]\.\/native-hover['"]/)
  assert.match(douyuAdapterSource, /from ['"]\.\/native-motion-fallback['"]/)
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
    hoverSelectionSource,
    /insideCurrentBody\(next\)[\s\S]*?holdCurrent\(event\.target\)[\s\S]*?stopImmediatePropagation/,
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
    hoverSelectionSource,
    /nextNative !== current\.element[\s\S]*?nativeExitWillProceed\(\)[\s\S]*?operations\.clear\(\)/,
  )
  assert.match(
    hoverSelectionSource,
    /entering !== selected\.element[\s\S]*?event\.stopImmediatePropagation\(\)/,
  )
  assert.match(hoverSelectionSource, /addEventListener\(['"]mouseover['"], onMouseOver, true\)/)
  assert.match(contentSource, /hoverSelection: hoverSelectionController/)
  assert.match(liveContentRuntimeSource, /resources\.hoverSelection\.start\(\)/)
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
  assert.match(senderIndexSource, /minScanInterval \?\? 240/)

  const overlayCandidatesSource = contentSource.match(
    /function overlayMessageCandidates\(\)(?:: [^{]+)? \{[\s\S]*?\n  \}/,
  )
  assert.ok(overlayCandidatesSource, 'overlayMessageCandidates should exist')
  assert.match(overlayCandidatesSource[0], /queryDocumentElements\(config\.overlayMessages\)/)
  assert.match(overlayCandidatesSource[0], /\.map\(normalizeOverlayCandidate\)/)
  assert.match(contentSource, /function normalizeOverlayCandidate\(element: Element \| null\)/)
  assert.match(
    contentSource,
    /function richPayloadFromCandidate\(candidate: Element\)[\s\S]*?candidate\.matches\(BILIBILI_OVERLAY_ROW_SELECTOR\)[\s\S]*?!candidate\.querySelector\(['"]img['"]\)[\s\S]*?content\.textContent/,
  )
  assert.match(
    contentSource,
    /function messageRows\(\)(?:: [^{]+)? \{[\s\S]*?isInsideBilibiliVideoOverlay\(element\)/,
  )

  const findCandidateSource = contentSource.match(
    /function findCandidate\(\s*path: readonly EventTarget\[\],[\s\S]*?\n  \}/,
  )
  assert.ok(findCandidateSource, 'findCandidate should exist')
  assert.ok(
    findCandidateSource[0].indexOf('closestFromPath(path, config.overlayMessages)') <
      findCandidateSource[0].indexOf('pathTouchesBilibiliQuickInput(path)'),
    'Bilibili video danmaku should take the fast path before chat-only guards',
  )

  const selectCandidateSource = contentSource.match(
    /function selectCandidate\([\s\S]*?\): boolean \{[\s\S]*?\n  \}/,
  )
  assert.ok(selectCandidateSource, 'selectCandidate should exist')
  assert.match(selectCandidateSource[0], /freezeOverlayCandidate\(candidate\)/)
  assert.match(selectCandidateSource[0], /scanDom:\s*false/)
  assert.match(selectCandidateSource[0], /state\.overlayViewport = selectedOverlayViewport/)
  assert.match(selectCandidateSource[0], /scheduleOverlayHydration\(selectionId\)/)
  assert.match(contentSource, /const OVERLAY_HYDRATION_DELAY = 24/)
  assert.match(contentSource, /function hydrateSelectedOverlay\(selectionId: number\)/)
  assert.match(contentSource, /function ensureSelectedOverlayHydrated\(\): boolean/)
  assert.ok(
    selectCandidateSource[0].indexOf('freezeOverlayCandidate(candidate)') <
      selectCandidateSource[0].indexOf('senderFromCandidate('),
    'the moving overlay must be frozen before sender correlation work',
  )
  const pointerMoveSource = hoverSelectionSource.match(
    /const onPointerMove = \(event: PointerEvent\) => \{[\s\S]*?\n  \}/,
  )
  assert.ok(pointerMoveSource, 'onPointerMove should exist')
  assert.ok(
    pointerMoveSource[0].indexOf("current?.kind === 'overlay' && current.frozen") <
      pointerMoveSource[0].indexOf("current?.kind === 'chat'"),
    'a frozen Bilibili danmaku must bypass chat-action detection',
  )
  assert.match(
    contentSource,
    /if \(target && isInsideBilibiliPlayerOutsideChat\(target\)\)(?: \{|)\s*return false/,
  )
})
