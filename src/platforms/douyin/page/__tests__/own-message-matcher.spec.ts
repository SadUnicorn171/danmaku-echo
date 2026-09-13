import { beforeEach, describe, expect, it } from 'vitest'

import { payloadSignature, type RichPayload } from '../../own-message'
import { comparableText, serializedEmojiAssets } from '../../rich-data'
import {
  createRendererOwnMessageMatcher,
  type RendererOwnMessageIntentInput,
  type RendererOwnMessageMatcherEvent,
} from '../own-message-matcher'
import { initialTrackMotion } from '../track-motion'
import type { RendererInstance, RendererTrack } from '../runtime-types'

const baseUrl = 'https://live.douyin.com/123'

interface MatcherHarness {
  events: RendererOwnMessageMatcherEvent[]
  matcher: ReturnType<typeof createRendererOwnMessageMatcher>
  setNow(value: number): void
  tracks: RendererTrack[]
}

function createInstance(): RendererInstance {
  const canvas = document.createElement('canvas')
  document.body.append(canvas)
  return {
    active: true,
    animationFrame: 0,
    canvas,
    canvasEverConnected: true,
    canvasId: 1,
    channels: [[]],
    config: {
      channelHeight: 40,
      devicePixelRatio: 1,
      duration: 10_000,
      fontSize: 20,
      gap: 100,
      height: 120,
      maxCount: 200,
      maxHeightRate: 1,
      width: 400,
    },
    createdAt: 1_000,
    frameState: {
      moved: new Set(),
      previousIds: new Map(),
      rightPositions: new Map(),
      speeds: new Map(),
    },
    id: 'instance-1',
    lastFrameAt: 0,
    lifecycle: { lastFailure: null, state: 'observing' },
    mountGraceUntil: 2_000,
    pending: [],
    pushTimer: 0,
    recovered: false,
    rendererBlocked: false,
    rendererBorderRadius: null,
    rendererCanvasVisibility: '',
    rendererCleanClearObserved: false,
    rendererGeneration: 0,
    rendererGeometryKey: '',
    rendererLayer: null,
    rendererNodes: new Map(),
    rendererOwnsCanvasVisibility: false,
    rendererPreparing: 0,
    rendererSafeAfter: 0,
    rendererSafeSync: true,
    rendererTakeover: false,
    tracks: new Map(),
  }
}

function createTrack(
  instance: RendererInstance,
  id: number,
  text: string,
  content: RendererTrack['content'] = [{ text, type: 'text' }],
  observedAt = 1_000,
  messageId: string = `message-${id}`,
): RendererTrack {
  const track: RendererTrack = {
    bookedChannel: { end: 0, start: 0 },
    content,
    description: {
      actionWidth: 172,
      contentHeight: 40,
      contentWidth: 120,
      firstText: {},
      height: 40,
      imageCount: content.filter(({ type }) => type === 'image').length,
      imageOnly: false,
      rendererPadding: [8, 8, 8, 8],
      text,
      width: 312,
    },
    id,
    instance,
    motion: initialTrackMotion(),
    observedAt,
    options: { id: messageId },
    own: false,
    sender: `用户${id}`,
    startedAt: 1_000,
  }
  instance.tracks.set(id, track)
  return track
}

function createHarness(initialNow = 1_000): MatcherHarness {
  let currentNow = initialNow
  const events: RendererOwnMessageMatcherEvent[] = []
  const tracks: RendererTrack[] = []
  const matcher = createRendererOwnMessageMatcher({
    baseUrl: () => baseUrl,
    now: () => currentNow,
    onEvent: (event) => events.push(event),
    recentTrackWindow: 2_500,
    tracks: () => tracks,
    ttl: 12_000,
  })
  return {
    events,
    matcher,
    setNow(value) {
      currentNow = value
    },
    tracks,
  }
}

function richSignature(
  text: string,
  plainText: string,
  assets: RendererOwnMessageIntentInput['assets'],
): string {
  const payload: RichPayload = {
    assets: [...assets],
    parts: [],
    plainText,
    text,
  }
  return payloadSignature(payload, comparableText)
}

function intent(
  intentId: string,
  text: string,
  options: Partial<RendererOwnMessageIntentInput> = {},
): RendererOwnMessageIntentInput {
  const assets = options.assets ?? []
  const plainText = options.plainText ?? text
  return {
    assets,
    intentId,
    messageId: options.messageId,
    plainText,
    signature: options.signature ?? richSignature(text, String(plainText), assets),
    sourceType: options.sourceType ?? 'plus-one',
    text,
  }
}

beforeEach(() => {
  document.body.replaceChildren()
})

describe('Douyin renderer own-message matcher', () => {
  it('prefers an exact rich signature and consumes the intent only once', () => {
    const harness = createHarness()
    const instance = createInstance()
    const content: RendererTrack['content'] = [
      { text: '你好', type: 'text' },
      { src: 'https://example.com/emoji/smile.png', type: 'image' },
    ]
    const assets = serializedEmojiAssets(content, baseUrl)
    harness.matcher.remember(
      intent('intent-1', '[微笑]你好', { assets, plainText: '你好' }),
    )
    const first = createTrack(instance, 1, '你好', content)
    const second = createTrack(instance, 2, '你好', content)

    expect(harness.matcher.match(first)).toBe(true)
    expect(harness.matcher.match(second)).toBe(false)
    expect(first.own).toBe(true)
    expect(second.own).toBe(false)
    expect(harness.events.filter(({ type }) => type === 'matched')).toHaveLength(1)
  })

  it('marks at most one barrage when multiple users send the same text', () => {
    const harness = createHarness()
    const instance = createInstance()
    harness.matcher.remember(intent('intent-1', '同意'))
    const otherUser = createTrack(instance, 1, '同意')
    const currentUser = createTrack(instance, 2, '同意')

    expect(harness.matcher.match(otherUser)).toBe(true)
    expect(harness.matcher.match(currentUser)).toBe(false)
    expect([otherUser, currentUser].filter(({ own }) => own)).toHaveLength(1)
  })

  it('requires every repeated Emoji asset before consuming a consecutive-Emoji intent', () => {
    const harness = createHarness()
    const instance = createInstance()
    const image = { src: 'https://example.com/emoji/shamate.png', type: 'image' as const }
    const expectedAssets = serializedEmojiAssets([image, image], baseUrl)
    harness.matcher.remember(
      intent('intent-1', '[杀马特][杀马特]', {
        assets: expectedAssets,
        plainText: '',
      }),
    )

    expect(harness.matcher.match(createTrack(instance, 1, '表情', [image]))).toBe(false)
    expect(harness.matcher.match(createTrack(instance, 2, '表情', [image, image]))).toBe(true)
  })

  it('removes a failed-send intent by its stable intent id', () => {
    const harness = createHarness()
    const instance = createInstance()
    harness.matcher.remember(intent('failed-send', '不会发送'))

    expect(harness.matcher.cancel({ intentId: 'failed-send' })).toBe(true)
    expect(harness.matcher.match(createTrack(instance, 1, '不会发送'))).toBe(false)
    expect(harness.events).toContainEqual({ intentId: 'failed-send', type: 'cancelled' })
  })

  it('prunes an expired intent before matching a late barrage', () => {
    const harness = createHarness()
    const instance = createInstance()
    harness.matcher.remember(intent('expired', '已经超时'))
    harness.setNow(13_001)

    expect(harness.matcher.prune()).toBe(1)
    expect(harness.matcher.match(createTrack(instance, 1, '已经超时'))).toBe(false)
  })

  it('reconciles a manual-send race to the newest matching recent track', () => {
    const harness = createHarness(5_000)
    const instance = createInstance()
    const older = createTrack(instance, 1, '手动发送', undefined, 3_500)
    const newest = createTrack(instance, 2, '手动发送', undefined, 4_950)
    harness.tracks.push(older, newest)

    expect(
      harness.matcher.remember(
        intent('manual-race', '手动发送', { sourceType: 'manual-button' }),
      ),
    ).toBe(true)
    expect(older.own).toBe(false)
    expect(newest.own).toBe(true)
    expect(harness.events.at(-1)).toMatchObject({ mode: 'recent-track', type: 'matched' })
  })

  it('treats an available platform message id as authoritative', () => {
    const harness = createHarness()
    const instance = createInstance()
    harness.matcher.remember(intent('intent-1', '相同正文', { messageId: 'own-id' }))

    expect(
      harness.matcher.match(createTrack(instance, 1, '相同正文', undefined, 1_000, 'other-id')),
    ).toBe(false)
    expect(
      harness.matcher.match(createTrack(instance, 2, '相同正文', undefined, 1_000, 'own-id')),
    ).toBe(true)
  })
})
