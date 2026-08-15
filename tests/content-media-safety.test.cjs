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
const douyuOverlayMotionSource = fs.readFileSync(
  path.join(__dirname, '..', 'src', 'platforms', 'douyu', 'overlay-motion.ts'),
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

test("pauses Douyu's Web Animation without nesting controls in the moving danmaku", () => {
  assert.match(contentSource, /platforms\/douyu\/overlay-motion/)
  assert.match(
    freezeOverlaySource[0],
    /if \(platformId === ['"]douyu['"] && candidate instanceof HTMLElement\) \{[\s\S]*?douyuOverlayMotion\?\.pause\(candidate\)[\s\S]*?state\.pausedAnimations = \[\][\s\S]*?return/,
  )
  assert.match(
    contentSource,
    /douyuOverlayMotion\?\.release\(candidate instanceof HTMLElement \? candidate : null\)/,
  )
  assert.match(douyuOverlayMotionSource, /candidate\.getAnimations\(\{ subtree: true \}\)/)
  assert.match(douyuOverlayMotionSource, /animation\.pause\(\)/)
  assert.match(
    douyuOverlayMotionSource,
    /shouldResume:[\s\S]*?animation\.playState === ['"]running['"]/,
  )
  assert.doesNotMatch(
    douyuOverlayMotionSource,
    /\.currentTime\s*=|\.startTime\s*=|style\.setProperty/,
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
    /isInsideSelectedHoverBody\(next\)[\s\S]*?douyuOverlayMotion\?\.hold\(state\.candidate\)[\s\S]*?stopImmediatePropagation/,
  )
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
