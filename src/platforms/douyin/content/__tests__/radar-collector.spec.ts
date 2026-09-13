import { readFileSync } from 'node:fs'
import { resolve as resolvePath } from 'node:path'

import { beforeEach, describe, expect, it, vi } from 'vitest'

import type { DanmakuDescriptor } from '../../../../core/types'
import type { RepeatReminderObservation } from '../../../../features/repeat-reminder/types'
import type { RichPayload } from '../../own-message'
import type { DouyinRepeatReminderMessage } from '../../protocol'
import { createDouyinChatParser } from '../chat-parser'
import { createDouyinRadarCollector } from '../radar-collector'

function createRow(options: {
  body: string
  id: string
  kind?: string
  sender?: string
}): HTMLElement {
  const row = document.createElement('article')
  row.dataset.e2e = 'chat-message'
  row.dataset.messageId = options.id
  if (options.kind) row.dataset.messageKind = options.kind
  row.innerHTML = `
    <span data-e2e="chat-message-user-name">${options.sender ?? '测试用户'}</span>
    <span data-e2e="chat-message-text">${options.body}</span>
  `
  document.body.append(row)
  return row
}

function rendererMessage(
  text: string,
  options: Partial<DouyinRepeatReminderMessage> = {},
): DouyinRepeatReminderMessage {
  return {
    content: [{ text, type: 'text' }],
    excludedReason: '',
    instanceId: 'instance-1',
    messageId: 'video-1',
    observedAt: 1_000,
    sender: '测试用户',
    text,
    trackId: 'track-1',
    ...options,
  }
}

function createHarness() {
  const clock = { value: 1_000 }
  const room = { value: 'douyin:1' }
  const observations: RepeatReminderObservation[] = []
  const suppressed: string[] = []
  const resolved = vi.fn<(message: {
    instanceId: string | number
    messageId: string | number
    text: string
    trackId: string | number
  }) => void>()
  const parser = createDouyinChatParser({ baseUrl: () => 'https://live.douyin.com/1' })
  const collector = createDouyinRadarCollector({
    enabled: () => true,
    now: () => clock.value,
    parser,
    resolveRendererPayload: (text, content): RichPayload & { sender?: string } => {
      const source = Array.isArray(content) ? content : []
      const hasImage = source.some(
        (part) => part && typeof part === 'object' && 'type' in part && part.type === 'image',
      )
      const normalized = String(text || '')
      const asset = { keys: ['emoji:test'], src: 'https://example.com/emoji.png', token: '[表情]' }
      return {
        assets: hasImage ? [asset] : [],
        parts: hasImage ? [{ asset, type: 'emoji' }] : [{ text: normalized, type: 'text' }],
        plainText: hasImage ? '' : normalized,
        sender: '测试用户',
        text: normalized,
      }
    },
    roomKey: () => room.value,
    sendResolvedMessage: resolved,
  })
  collector.connect({
    ingest: (observation) => observations.push(observation),
    suppressText: (text) => suppressed.push(text),
  })

  function collectChat(row: Element): DanmakuDescriptor | null {
    const descriptor = collector.describe(row, 'chat')
    if (descriptor) {
      observations.push({
        messageId: descriptor.messageId,
        observedAt: clock.value,
        parts: descriptor.parts,
        resourceIds: descriptor.resourceIds,
        senderId: descriptor.senderId,
        senderName: descriptor.senderName,
        source: descriptor.source,
        text: descriptor.text,
      })
    }
    return descriptor
  }

  return { clock, collectChat, collector, observations, resolved, room, suppressed }
}

describe('DouyinRadarCollector', () => {
  beforeEach(() => {
    document.body.replaceChildren()
  })

  it('counts ordinary same-source repeats independently', () => {
    const harness = createHarness()

    expect(harness.collectChat(createRow({ body: '主播好', id: 'chat-1' }))).not.toBeNull()
    harness.clock.value += 100
    expect(harness.collectChat(createRow({ body: '主播好', id: 'chat-2' }))).not.toBeNull()

    expect(harness.observations).toHaveLength(2)
    expect(harness.observations.map((item) => item.text)).toEqual(['主播好', '主播好'])
  })

  it('deduplicates one chat/video mirror inside three seconds', () => {
    const harness = createHarness()
    harness.collector.ingestRenderer(rendererMessage('同一条弹幕'))
    harness.clock.value += 300

    expect(
      harness.collectChat(createRow({ body: '同一条弹幕', id: 'chat-mirror' })),
    ).toBeNull()
    expect(harness.observations).toHaveLength(1)
    expect(harness.observations[0]).toMatchObject({ source: 'video', text: '同一条弹幕' })

    harness.clock.value += 3_001
    expect(
      harness.collectChat(createRow({ body: '同一条弹幕', id: 'chat-later' })),
    ).not.toBeNull()
    expect(harness.observations).toHaveLength(2)
  })

  it('excludes gifts, lottery commands, system rows and image Emoji from chat', () => {
    const harness = createHarness()
    const rows = [
      createRow({ body: '用户 送出小心心 x 1', id: 'gift' }),
      createRow({ body: '左上角福袋抽钻石', id: '__mocked__lottery' }),
      createRow({ body: '直播间系统公告', id: 'system', kind: 'system' }),
      createRow({ body: '<img alt="[杀马特]" src="/emoji.png">', id: 'emoji' }),
    ]

    expect(rows.map((row) => harness.collectChat(row))).toEqual([null, null, null, null])
    expect(harness.observations).toHaveLength(0)
  })

  it('excludes renderer image Emoji while still publishing its resolved display text', () => {
    const harness = createHarness()
    harness.collector.ingestRenderer(
      rendererMessage('[表情]', { content: [{ src: '/emoji.png', type: 'image' }] }),
    )

    expect(harness.observations).toHaveLength(0)
    expect(harness.resolved).toHaveBeenCalledWith(expect.objectContaining({ text: '[表情]' }))
  })

  it('suppresses synthetic activity in the current room and resets on room change', () => {
    const harness = createHarness()
    harness.collector.ingestRenderer(
      rendererMessage('点点关注主播', {
        excludedReason: 'synthetic-activity',
        messageId: '__mocked__activity',
      }),
    )

    expect(harness.suppressed).toEqual(['点点关注主播'])
    expect(
      harness.collectChat(createRow({ body: '点点关注主播', id: 'chat-suppressed' })),
    ).toBeNull()
    expect(harness.collector.snapshot().suppressionCount).toBe(1)

    harness.room.value = 'douyin:2'
    expect(
      harness.collectChat(createRow({ body: '点点关注主播', id: 'chat-next-room' })),
    ).not.toBeNull()
    expect(harness.collector.snapshot()).toMatchObject({
      roomKey: 'douyin:2',
      suppressionCount: 0,
    })
  })

  it('keeps filtering and suppression state outside the entry runtime', () => {
    const entry = readFileSync(
      resolvePath(process.cwd(), 'src/platforms/douyin/content/content-app.ts'),
      'utf8',
    )
    const runtimeState = readFileSync(
      resolvePath(process.cwd(), 'src/platforms/douyin/content/runtime-state.ts'),
      'utf8',
    )
    expect(entry).toContain('collector: radarCollector')
    expect(entry).not.toMatch(
      /function\s+(?:describeDouyinRepeatReminderRow|ingestDouyinRendererRepeatReminderMessage|rememberRepeatReminderSuppression)/,
    )
    expect(runtimeState).not.toContain('repeatReminderSuppressedTexts')
  })
})
