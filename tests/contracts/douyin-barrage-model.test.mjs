import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import test from 'node:test'
import vm from 'node:vm'
import { build } from 'vite'

const root = resolve(import.meta.dirname, '..', '..')

async function buildIife(entry, fileName, globalName) {
  const buildResult = await build({
    configFile: false,
    logLevel: 'silent',
    publicDir: false,
    root,
    build: {
      emptyOutDir: false,
      lib: {
        entry: resolve(root, entry),
        fileName: () => fileName,
        formats: ['iife'],
        name: globalName,
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
  if (!source) throw new Error(`Could not build ${entry}`)
  const context = {}
  context.globalThis = context
  vm.runInNewContext(source, context, { filename: fileName })
  return context[globalName]
}

const model = await buildIife(
  'src/platforms/douyin/barrage-model.ts',
  'douyin-barrage-model.js',
  'DanmakuEchoDouyinBarrageModel',
)
const trackMotion = await buildIife(
  'src/platforms/douyin/page/track-motion.ts',
  'douyin-track-motion.js',
  'DanmakuEchoDouyinTrackMotion',
)
const channelScheduler = await buildIife(
  'src/platforms/douyin/page/channel-scheduler.ts',
  'douyin-channel-scheduler.js',
  'DanmakuEchoDouyinChannelScheduler',
)

test('clips the DOM barrage renderer to the native Canvas viewport', () => {
  const stylesheet = readFileSync(
    resolve(root, 'src', 'assets', 'styles', 'douyin-content.css'),
    'utf8',
  )
  const domRenderer = readFileSync(
    resolve(root, 'src', 'platforms', 'douyin', 'page', 'dom-renderer.ts'),
    'utf8',
  )
  const layerRule = stylesheet.match(/\.bcp-douyin-dom-layer\s*\{([\s\S]*?)\}/)?.[1] || ''

  assert.match(layerRule, /overflow:\s*hidden\s*;/)
  assert.doesNotMatch(layerRule, /overflow:\s*visible\s*;/)
  assert.match(domRenderer, /layer\.style\.overflow\s*=\s*['"]hidden['"]/)
})

test('keeps repeat-reminder prompts out of Douyin renderer hover hit testing', () => {
  const pageApp = readFileSync(
    resolve(root, 'src', 'platforms', 'douyin', 'page', 'page-app.ts'),
    'utf8',
  )
  const domRenderer = readFileSync(
    resolve(root, 'src', 'platforms', 'douyin', 'page', 'dom-renderer.ts'),
    'utf8',
  )
  const trackController = readFileSync(
    resolve(root, 'src', 'platforms', 'douyin', 'page', 'track-controller.ts'),
    'utf8',
  )
  assert.match(domRenderer, /options\.trackController\.connectTrack\(track, state\)/)
  assert.match(
    trackController,
    /state\.node\.addEventListener\('pointerenter',[\s\S]*?touchesReminder\(options\.document/,
  )
  assert.match(
    trackController,
    /options\.document\.addEventListener\('pointermove', onPointerMove, true\)/,
  )
  assert.match(pageApp, /createRendererTrackController/)
})

test('normalizes text and rejects non-message labels', () => {
  assert.equal(model.normalizeText('  你好\u200B\n 世界  '), '你好 世界')
  assert.equal(model.plausibleText('主播加油'), true)
  assert.equal(model.plausibleText('退出全屏'), false)
})

test('preserves zero-width joiners inside Douyin Emoji', () => {
  assert.equal(model.normalizeText(' 👩🏽‍💻 👨‍👩‍👧‍👦 '), '👩🏽‍💻 👨‍👩‍👧‍👦')
})

test('keeps image-only native Douyin Emoji interactive', () => {
  assert.equal(model.barrageInteractionText('', 1), '表情')
  assert.equal(model.barrageInteractionText('  ', 2), '表情')
  assert.equal(model.barrageInteractionText('文字弹幕', 1), '文字弹幕')
  assert.equal(model.barrageInteractionText('', 0), '')
})

test('expands CSS-like box shorthand safely', () => {
  assert.deepEqual(JSON.parse(JSON.stringify(model.boxEdges([4, '6', 8]))), {
    top: 4,
    right: 6,
    bottom: 8,
    left: 6,
  })
  assert.deepEqual(JSON.parse(JSON.stringify(model.boxEdges('3'))), {
    top: 3,
    right: 3,
    bottom: 3,
    left: 3,
  })
})

test('serializes barrage content with a bounded, safe payload', () => {
  const serialized = model.serializeBarrage({
    content: [
      {
        type: 'block',
        color: {
          type: 'radial',
          gradientPieces: [
            [0, '#fff'],
            [1, '#000'],
          ],
        },
        margin: [1, 2, 3, 4, 5],
        content: [
          { type: 'text', text: '弹幕', fontSize: '24', unknown: 'discard' },
          { type: 'image', src: 'https://example.com/emoji.png', isInline: true },
        ],
      },
    ],
  })

  assert.deepEqual(JSON.parse(JSON.stringify(serialized)), [
    {
      type: 'block',
      color: {
        type: 'radial',
        gradientPieces: [
          [0, '#fff'],
          [1, '#000'],
        ],
      },
      margin: [1, 2, 3, 4],
      content: [
        { type: 'text', text: '弹幕', fontSize: 24 },
        { type: 'image', src: 'https://example.com/emoji.png', isInline: true },
      ],
    },
  ])
})

test('preserves stable native Emoji resource hints from the renderer', () => {
  const serialized = model.serializeBarrage({
    content: [
      {
        type: 'image',
        src: 'https://signed.example.com/emoji.png?signature=temporary',
        emojiId: 'emoji-42',
        emojiName: 'wave',
        resource: { id: 'resource-9' },
        unrelated: { secret: 'discard' },
      },
    ],
  })

  assert.deepEqual(JSON.parse(JSON.stringify(serialized)), [
    {
      type: 'image',
      src: 'https://signed.example.com/emoji.png?signature=temporary',
      emojiToken: '[wave]',
      assetHints: ['emoji-42', 'wave', 'resource-9'],
    },
  ])
})

test('rebuilds ordered native bracket Emoji text from Canvas content', () => {
  const serialized = model.serializeBarrage({
    content: [
      { type: 'image', src: 'https://example.test/a.webp', emojiName: '杀马特' },
      { type: 'image', src: 'https://example.test/a.webp', emojiName: '杀马特' },
      { type: 'text', text: 'cyh' },
      { type: 'image', src: 'https://example.test/a.webp', emojiName: '[杀马特]' },
      { type: 'text', text: 'cyh' },
    ],
  })

  assert.equal(model.serializedBarrageText(serialized), '[杀马特][杀马特]cyh[杀马特]cyh')
})

test('restores repeated Shamate Emoji text from the live CDN resource', () => {
  const src =
    'https://p3-pc-sign.douyinpic.com/obj/tos-cn-i-tsj2vxp0zn/ed5fb68598cf4741b3e7f2affd825650?lk3s=343af0a2&x-expires=2103001200&x-signature=temporary'
  const serialized = model.serializeBarrage({
    content: Array.from({ length: 3 }, () => ({
      type: 'image',
      src,
      alt: '',
    })),
  })

  assert.equal(serialized.length, 3)
  assert.deepEqual(
    Array.from(serialized, (item) => item.emojiToken),
    ['[杀马特]', '[杀马特]', '[杀马特]'],
  )
  assert.equal(model.serializedBarrageText(serialized), '[杀马特][杀马特][杀马特]')
})

test("restores another viewer's mixed text and native Douyin Emoji", () => {
  const serialized = model.serializeBarrage({
    content: [
      { type: 'text', text: '皮特偷偷上号不开播' },
      {
        type: 'image',
        src: 'https://p3-pc-sign.douyinpic.com/obj/tos-cn-i-tsj2vxp0zn/87c2ae45679c4cc4a35bd7182fd76935?x-signature=temporary',
        alt: '',
      },
    ],
  })

  assert.equal(model.serializedBarrageText(serialized), '皮特偷偷上号不开播[看]')
})

test('converts renderer paints and boxes to bounded CSS values', () => {
  assert.equal(
    model.rendererPaint(
      {
        type: 'linear',
        gradientPieces: [
          [-1, '#111'],
          [2, '#222'],
        ],
      },
      true,
    ),
    'linear-gradient(90deg, #111 0%, #222 100%)',
  )
  assert.equal(model.rendererPaint({ gradientPieces: [[0, '#111']] }, false), '#111')
  assert.equal(model.rendererBox(['-120', 8, 999, 4]), '-100px 8px 200px 4px')
})

test('caps recursive barrage payloads to prevent unbounded page data', () => {
  let branch = { type: 'text', text: 'leaf' }
  for (let index = 0; index < 8; index += 1) {
    branch = { type: 'block', content: [branch] }
  }
  const serialized = model.serializeBarrage({ content: [branch] })
  let depth = 0
  let cursor = serialized[0]
  while (cursor?.content?.[0]) {
    depth += 1
    cursor = cursor.content[0]
  }
  assert.equal(depth, 5)
})

test('calculates stable track geometry and channel ranges', () => {
  const instance = {
    config: {
      devicePixelRatio: 2,
      fontSize: 20,
      width: 400,
      height: 200,
      channelHeight: 40,
      duration: 10_000,
      gap: 50,
    },
  }
  const barrage = {
    instance,
    description: { width: 100, height: 30 },
    motion: { distance: 50, paused: false },
    options: { channelRange: { startIndex: 1, len: 2 }, prior: 4 },
  }
  const rect = { left: 10, top: 20, width: 400, height: 200 }

  assert.deepEqual(JSON.parse(JSON.stringify(channelScheduler.channelInfo(instance, rect))), {
    maxCanUse: 5,
    maxDisplay: 5,
  })
  assert.deepEqual(JSON.parse(JSON.stringify(channelScheduler.realChannelRange(barrage, 5, 5))), {
    start: 1,
    end: 2,
  })
  assert.equal(channelScheduler.trackPriority(barrage, 5), 104)
  assert.equal(trackMotion.trackSpeed(barrage, rect), 0.05)
})
