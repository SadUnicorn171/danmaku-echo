import { readFileSync } from 'node:fs'
import { resolve as resolvePath } from 'node:path'

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { normalizeRichPayload, payloadSignature, type RichPayload } from '../../own-message'
import { comparableText } from '../../rich-data'
import type { DouyinContentToPagePayload } from '../../protocol'
import { createDouyinChatParser } from '../chat-parser'
import type { DouyinEditorController } from '../editor-controller'
import { createDouyinOwnMessageController } from '../own-message-controller'

function row(text: string): HTMLElement {
  const element = document.createElement('div')
  element.dataset.e2e = 'chat-message'
  const content = document.createElement('span')
  content.dataset.e2e = 'chat-message-text'
  content.textContent = text
  element.append(content)
  return element
}

function createHarness(clock: { value: number } = { value: 1_000 }) {
  const root = document.createElement('section')
  root.dataset.e2e = 'chat-message-list'
  const editorElement = document.createElement('textarea')
  const editorShell = document.createElement('div')
  const sendButton = document.createElement('button')
  sendButton.dataset.e2e = 'chat-room-send'
  sendButton.textContent = '发送'
  editorShell.append(editorElement, sendButton)
  document.body.append(root, editorShell)
  const messages: DouyinContentToPagePayload[] = []
  const parser = createDouyinChatParser({ baseUrl: () => 'https://live.douyin.com/1' })
  const editor: DouyinEditorController = {
    contains: () => false,
    destroy: () => undefined,
    editableFrom: (target) =>
      target instanceof HTMLElement && target.matches('textarea,[contenteditable]')
        ? target
        : null,
    find: () => editorElement,
    isEmpty: () => false,
    mention: () => '',
    prepareReply: () => {
      throw new Error('not used')
    },
    pressEnter: () => undefined,
    read: (input) => (input instanceof HTMLTextAreaElement ? input.value : ''),
    releaseFocus: () => undefined,
    setValue: () => undefined,
    start: () => undefined,
    waitForClear: () => Promise.resolve(true),
    waitForConsumption: () => Promise.resolve(true),
  }
  const controller = createDouyinOwnMessageController({
    cancelFrame: () => undefined,
    document,
    editor,
    enabled: () => true,
    normalizePayload: (value) =>
      normalizeRichPayload(value, (text) => String(text ?? '').trim(), 1_000),
    normalizeWhitespace: (value) => String(value ?? '').replace(/\s+/gu, ' ').trim(),
    now: () => clock.value,
    parser,
    query: (selectors, queryRoot = document) =>
      Array.from(queryRoot.querySelectorAll(selectors.join(','))),
    readInputPayload: (input) => {
      const text = input instanceof HTMLTextAreaElement ? input.value.trim() : ''
      return { assets: [], parts: text ? [{ text, type: 'text' }] : [], plainText: text, text }
    },
    requestFrame: (callback) => {
      callback(0)
      return 0
    },
    sendToPage: (message) => messages.push(message),
  })
  return { clock, controller, editorElement, messages, root }
}

function intentMessages(messages: DouyinContentToPagePayload[]) {
  return messages.filter(
    (message): message is Extract<DouyinContentToPagePayload, { type: 'own-message-intent' }> =>
      message.type === 'own-message-intent',
  )
}

describe('DouyinOwnMessageController', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    document.body.replaceChildren()
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('uses the input snapshot when Douyin clears a manually sent text before click handling', () => {
    const harness = createHarness()
    harness.editorElement.value = '手动文字'
    harness.controller.rememberManualInputValue(harness.editorElement)
    harness.editorElement.value = ''

    const intentId = harness.controller.announceManualInput(
      harness.editorElement,
      'manual-button',
    )

    expect(intentId).toBe('1000-1')
    expect(intentMessages(harness.messages)).toEqual([
      expect.objectContaining({ intentId, sourceType: 'manual-button', text: '手动文字' }),
    ])
  })

  it('captures a trusted manual image Emoji and merges it into the final send intent', () => {
    const harness = createHarness()
    const panel = document.createElement('div')
    panel.className = 'emoji-panel'
    const image = document.createElement('img')
    image.className = 'emoji-item'
    image.alt = '[杀马特]'
    image.src = 'https://example.com/shamate.png'
    panel.append(image)
    document.body.append(panel)

    const emojiIntent = harness.controller.rememberManualEmojiClick({
      composedPath: () => [image, panel, document.body, document, window],
      isTrusted: true,
      target: image,
    })
    const sendIntent = harness.controller.announceManualInput(
      harness.editorElement,
      'manual-enter',
    )

    expect(emojiIntent).toBe('1000-1')
    expect(sendIntent).toBe('1000-2')
    expect(harness.messages).toContainEqual({ intentId: emojiIntent, type: 'own-message-cancel' })
    expect(intentMessages(harness.messages).at(-1)).toMatchObject({
      assets: [expect.objectContaining({ token: '[杀马特]' })],
      intentId: sendIntent,
      sourceType: 'manual-enter',
      text: '表情',
    })
  })

  it('marks the side-chat row with the same plugin intent payload signature', () => {
    const harness = createHarness()
    const payload: RichPayload = {
      assets: [],
      parts: [{ text: '插件 +1', type: 'text' }],
      plainText: '插件 +1',
      text: '插件 +1',
    }
    const intentId = harness.controller.announce(payload, 'plus-one')
    const ownRow = row('插件 +1')
    harness.root.append(ownRow)

    vi.runOnlyPendingTimers()

    const sent = intentMessages(harness.messages).at(-1)
    expect(sent?.intentId).toBe(intentId)
    expect(sent?.signature).toBe(payloadSignature(payload, comparableText))
    expect(ownRow.dataset.bcpDouyinOwnChat).toBe('true')
    expect(ownRow.dataset.bcpDouyinOwnChatSignature).toBe(
      payloadSignature(payload, comparableText),
    )
    expect(ownRow.querySelector("[data-bcp-douyin-own-chat-frame='true']")).not.toBeNull()
  })

  it('cancels a failed plugin send before a matching chat row can be claimed', () => {
    const harness = createHarness()
    const intentId = harness.controller.announce('发送失败', 'plus-one')

    harness.controller.cancel(intentId)
    const candidate = row('发送失败')
    harness.root.append(candidate)
    vi.runOnlyPendingTimers()

    expect(harness.messages).toContainEqual({ intentId, type: 'own-message-cancel' })
    expect(candidate.dataset.bcpDouyinOwnChat).toBeUndefined()
    expect(harness.controller.snapshot().pendingIntentCount).toBe(0)
  })

  it('does not claim the baseline row when identical content is sent twice', () => {
    const harness = createHarness()
    const baseline = row('重复内容')
    harness.root.append(baseline)
    harness.controller.announce('重复内容', 'plus-one')
    const newlySent = row('重复内容')
    harness.root.append(newlySent)

    vi.runOnlyPendingTimers()

    expect(baseline.dataset.bcpDouyinOwnChat).toBeUndefined()
    expect(newlySent.dataset.bcpDouyinOwnChat).toBe('true')
  })

  it('expires unmatched intents and clears every owned frame on destroy', () => {
    const harness = createHarness()
    harness.controller.announce('即将过期', 'plus-one')
    harness.clock.value += 12_001
    vi.runOnlyPendingTimers()

    expect(harness.controller.snapshot().pendingIntentCount).toBe(0)
    expect(harness.controller.snapshot().timerCount).toBe(0)
    harness.controller.destroy()
    expect(harness.controller.snapshot()).toMatchObject({
      confirmedIntentCount: 0,
      frameCount: 0,
      manualInputSnapshotCount: 0,
      observerCount: 0,
      pendingIntentCount: 0,
      pendingManualEmojiCount: 0,
      timerCount: 0,
    })
  })

  it('keeps manual intent, frame and pending state out of the entry runtime', () => {
    const entry = readFileSync(
      resolvePath(process.cwd(), 'src/platforms/douyin/content/content-app.ts'),
      'utf8',
    )
    const runtimeState = readFileSync(
      resolvePath(process.cwd(), 'src/platforms/douyin/content/runtime-state.ts'),
      'utf8',
    )
    for (const source of [entry, runtimeState]) {
      expect(source).not.toMatch(
        /state\.(?:manualInputSnapshots|pendingManualEmojiIntents|ownChatFrameObservers|ownChatIntents)/,
      )
      expect(source).not.toMatch(/function\s+(?:announceOwnMessage|scanOwnChatMessages|startOwnChatObserver)/)
    }
    expect(entry).toContain('createDouyinOwnMessageController')
  })
})
