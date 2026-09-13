import { readFileSync } from 'node:fs'
import { resolve as resolvePath } from 'node:path'

import { beforeEach, describe, expect, it, vi } from 'vitest'

import { mergeSettings } from '../../../../core/shared'
import { DOUYIN_PAGE_SOURCE, DOUYIN_PROTOCOL_VERSION } from '../../protocol'
import {
  createDouyinActionDispatcher,
  type DouyinActionDispatcherOptions,
  type DouyinRendererActionMessage,
} from '../action-dispatcher'
import { createDouyinRichContentResolver } from '../rich-content-resolver'

function rendererMessage(
  type: DouyinRendererActionMessage['type'],
  overrides: Partial<DouyinRendererActionMessage> = {},
): DouyinRendererActionMessage {
  const base = {
    content: [{ text: '测试弹幕', type: 'text' }],
    instanceId: 'instance-1',
    messageId: 'message-1',
    protocolVersion: DOUYIN_PROTOCOL_VERSION,
    requestId: 1,
    source: DOUYIN_PAGE_SOURCE,
    text: '测试弹幕',
    trackId: 'track-1',
    ...overrides,
  }
  if (type === 'renderer-reply') {
    return { ...base, observedAt: 100, sender: '测试用户', type } as DouyinRendererActionMessage
  }
  return { ...base, type } as DouyinRendererActionMessage
}

function trustedClick(options: {
  action?: string
  instanceId?: string
  message?: string
  trackId?: string
} = {}): Event {
  const actionBar = document.createElement('div')
  actionBar.className = 'bcp-douyin-dom-action'
  actionBar.dataset.instanceId = options.instanceId ?? 'instance-1'
  actionBar.dataset.message = options.message ?? '测试弹幕'
  actionBar.dataset.trackId = options.trackId ?? 'track-1'
  const item = document.createElement('button')
  item.className = 'bcp-douyin-dom-action-item'
  item.dataset.action = options.action ?? 'plus-one'
  actionBar.append(item)
  document.body.append(actionBar)
  return {
    composedPath: () => [item, actionBar, document.body, document, window],
    isTrusted: true,
    target: item,
  } as unknown as Event
}

function createHarness(overrides: Partial<DouyinActionDispatcherOptions> = {}) {
  const settings = mergeSettings()
  settings.actions = { copy: true, favorite: true, plusOne: true, reply: true }
  const copy = vi.fn<(text: string) => Promise<boolean>>(() => Promise.resolve(true))
  const favorite = vi.fn<
    (text: string, payload?: Parameters<DouyinActionDispatcherOptions['favorite']>[1]) => Promise<boolean>
  >(() => Promise.resolve(true))
  const prepareReply = vi.fn<
    DouyinActionDispatcherOptions['prepareReply']
  >(() => Promise.resolve(true))
  const repeatMessage = vi.fn<
    DouyinActionDispatcherOptions['repeatMessage']
  >(() => Promise.resolve(true))
  const dispatcher = createDouyinActionDispatcher({
    actions: () => settings.actions,
    copy,
    enabled: () => true,
    favorite,
    isPlausibleMessage: (message) => Boolean(message),
    now: () => 100,
    parseMessage: (value) => String(value || '').trim(),
    prepareReply,
    repeatMessage,
    resolver: createDouyinRichContentResolver({ chatMessages: () => [] }),
    senderForMessage: () => '后备用户',
    ...overrides,
  })
  return { copy, dispatcher, favorite, prepareReply, repeatMessage, settings }
}

beforeEach(() => {
  document.body.replaceChildren()
})

describe('Douyin action dispatcher', () => {
  it('routes every DOM capsule action through one semantic dispatcher', async () => {
    const harness = createHarness()
    const candidate = {
      message: '测试弹幕',
      richPayload: {
        assets: [],
        parts: [{ text: '测试弹幕', type: 'text' as const }],
        plainText: '测试弹幕',
        text: '测试弹幕',
      },
    }

    expect((await harness.dispatcher.dispatchDom('plusOne', candidate)).ok).toBe(true)
    expect((await harness.dispatcher.dispatchDom('copy', candidate)).ok).toBe(true)
    expect((await harness.dispatcher.dispatchDom('favorite', candidate)).ok).toBe(true)
    expect((await harness.dispatcher.dispatchDom('reply', candidate)).ok).toBe(true)
    expect(harness.repeatMessage).toHaveBeenCalledTimes(1)
    expect(harness.copy).toHaveBeenCalledWith('测试弹幕')
    expect(harness.favorite).toHaveBeenCalledTimes(1)
    expect(harness.prepareReply).toHaveBeenCalledTimes(1)
  })

  it('accepts a renderer action only after a matching recent trusted click', async () => {
    const harness = createHarness()
    expect(harness.dispatcher.rememberTrustedRendererAction(trustedClick())).toBe(true)

    const result = await harness.dispatcher.dispatchRenderer(
      'plusOne',
      rendererMessage('renderer-activate'),
    )

    expect(result).toMatchObject({ accepted: true, ok: true, outcome: 'sent' })
    expect(harness.repeatMessage).toHaveBeenCalledTimes(1)
  })

  it('rejects an expired trusted click', async () => {
    let clock = 100
    const harness = createHarness({ now: () => clock })
    harness.dispatcher.rememberTrustedRendererAction(trustedClick())
    clock = 1_601

    const result = await harness.dispatcher.dispatchRenderer(
      'plusOne',
      rendererMessage('renderer-activate'),
    )

    expect(result).toMatchObject({ accepted: false, reason: 'untrusted' })
    expect(harness.repeatMessage).not.toHaveBeenCalled()
  })

  it.each([
    ['message', trustedClick({ message: '另一条弹幕' })],
    ['track', trustedClick({ trackId: 'forged-track' })],
    ['instance', trustedClick({ instanceId: 'forged-instance' })],
    ['action', trustedClick({ action: 'favorite' })],
  ])('rejects forged renderer %s metadata', async (_field, event) => {
    const harness = createHarness()
    harness.dispatcher.rememberTrustedRendererAction(event)

    const result = await harness.dispatcher.dispatchRenderer(
      'plusOne',
      rendererMessage('renderer-activate'),
    )

    expect(result).toMatchObject({ accepted: false, reason: 'untrusted' })
  })

  it('rejects a forged protocol action even when its metadata matches', async () => {
    const harness = createHarness()
    harness.dispatcher.rememberTrustedRendererAction(trustedClick({ action: 'copy' }))

    const result = await harness.dispatcher.dispatchRenderer(
      'copy',
      rendererMessage('renderer-activate'),
    )

    expect(result).toMatchObject({ accepted: false, reason: 'untrusted' })
    expect(harness.copy).not.toHaveBeenCalled()
  })

  it('enforces action settings for both DOM and renderer actions', async () => {
    const harness = createHarness({
      actions: () => ({ copy: false, favorite: false, plusOne: false, reply: false }),
    })
    harness.dispatcher.rememberTrustedRendererAction(trustedClick())

    expect(
      await harness.dispatcher.dispatchDom('plusOne', { message: '测试弹幕' }),
    ).toMatchObject({ accepted: false, reason: 'disabled' })
    expect(
      await harness.dispatcher.dispatchRenderer('plusOne', rendererMessage('renderer-activate')),
    ).toMatchObject({ accepted: false, reason: 'disabled' })
    expect(harness.repeatMessage).not.toHaveBeenCalled()
  })

  it('deduplicates renderer request IDs and clears owned resources on destroy', async () => {
    const harness = createHarness()
    const message = rendererMessage('renderer-copy')
    harness.dispatcher.rememberTrustedRendererAction(trustedClick({ action: 'copy' }))
    expect((await harness.dispatcher.dispatchRenderer('copy', message)).ok).toBe(true)
    expect(harness.dispatcher.pendingCount()).toBe(1)

    harness.dispatcher.rememberTrustedRendererAction(trustedClick({ action: 'copy' }))
    expect(await harness.dispatcher.dispatchRenderer('copy', message)).toMatchObject({
      accepted: false,
      reason: 'duplicate',
    })
    harness.dispatcher.destroy()
    expect(harness.dispatcher.pendingCount()).toBe(0)
  })

  it('installs one trusted-click listener and removes it during destroy', () => {
    const add = vi.spyOn(document, 'addEventListener')
    const remove = vi.spyOn(document, 'removeEventListener')
    const harness = createHarness()

    harness.dispatcher.start()
    harness.dispatcher.start()
    expect(add.mock.calls.filter(([type]) => type === 'click')).toHaveLength(1)

    harness.dispatcher.destroy()
    expect(remove.mock.calls.filter(([type]) => type === 'click')).toHaveLength(1)
  })

  it('keeps clipboard and trusted-action orchestration out of both large entries', () => {
    const content = readFileSync(
      resolvePath(process.cwd(), 'src', 'platforms', 'douyin', 'content', 'content-app.ts'),
      'utf8',
    )
    const pageEntry = readFileSync(
      resolvePath(process.cwd(), 'src', 'entries', 'douyin-page-hook.ts'),
      'utf8',
    )
    const pageApp = readFileSync(
      resolvePath(process.cwd(), 'src', 'platforms', 'douyin', 'page', 'page-app.ts'),
      'utf8',
    )
    const trackController = readFileSync(
      resolvePath(
        process.cwd(),
        'src',
        'platforms',
        'douyin',
        'page',
        'track-controller.ts',
      ),
      'utf8',
    )

    expect(content).toContain('createDouyinActionDispatcher')
    expect(content).not.toMatch(/function\s+matchesTrustedAction\s*\(/u)
    expect(content).not.toMatch(/state\.(?:trustedAction|activationRequests)/u)
    expect(pageEntry).toContain('createDouyinPageAppRuntime')
    expect(pageEntry).not.toContain('createRendererTrackController')
    expect(pageApp).toContain('createRendererTrackController')
    expect(trackController).toContain("type: 'renderer-copy'")
    expect(pageEntry).not.toContain('navigator.clipboard')
    expect(pageEntry).not.toContain('document.execCommand("copy")')
    expect(pageApp).not.toContain('navigator.clipboard')
    expect(pageApp).not.toContain('document.execCommand("copy")')
    expect(trackController).not.toContain('navigator.clipboard')
  })
})
