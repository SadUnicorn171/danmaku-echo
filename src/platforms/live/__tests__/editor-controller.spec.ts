import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import type { LivePlatformConfig } from '../config'
import { EditorController, type ReplyPreparationFailure } from '../editor-controller'
import type { LiveSelection } from '../runtime-state'

const config: LivePlatformConfig = {
  chatRoots: ['.chat'],
  inputs: ['textarea', "[contenteditable='true']"],
  maxLength: 1_000,
  messages: ['.message'],
  messageText: ['.text'],
  name: '测试直播',
  overlayMessages: ['.overlay'],
  sendButtons: ['button'],
  userNames: ['.user'],
  videoRoots: ['.player'],
}

function selection(sender = '测试用户'): LiveSelection {
  const candidate = document.createElement('div')
  document.body.append(candidate)
  return {
    candidate,
    kind: 'chat',
    message: '消息',
    richPayload: null,
    selectedAt: Date.now(),
    sender,
  }
}

function createController(
  options: {
    failures?: ReplyPreparationFailure[]
    fullscreen?: boolean
    resolveSender?: () => string
  } = {},
): EditorController {
  return new EditorController({
    clearSelection: () => undefined,
    closest: (element, selectors) => element.closest(selectors.join(',')),
    config,
    fullscreenActive: () => Boolean(options.fullscreen),
    fullscreenElement: () =>
      options.fullscreen ? document.querySelector<Element>('.player') : null,
    isQuickInput: (element) => element.classList.contains('quick'),
    isVisible: () => true,
    onFailure: (reason) => options.failures?.push(reason),
    platform: 'bilibili',
    query: (selectors) => Array.from(document.querySelectorAll(selectors.join(','))),
    requestFrame: (callback) => {
      callback(0)
      return 1
    },
    resolveSender: () => options.resolveSender?.() ?? '',
    senderResolveAttempts: 1,
  })
}

describe('EditorController', () => {
  beforeEach(() => {
    document.body.replaceChildren()
    vi.useFakeTimers()
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('inserts a reply mention at the textarea selection without sending', async () => {
    document.body.innerHTML = '<section class="chat"><textarea>开头结尾</textarea></section>'
    const textarea = document.querySelector('textarea')!
    textarea.setSelectionRange(2, 2)
    const controller = createController()

    await controller.prepare(selection('主播'))

    expect(textarea.value).toBe('开头@主播结尾')
    expect(textarea.selectionStart).toBe(5)
  })

  it('supports contenteditable and reports missing sender/editor states', async () => {
    document.body.innerHTML =
      '<section class="chat"><div contenteditable="true">草稿</div></section>'
    const editor = document.querySelector('[contenteditable]')!
    const controller = createController()
    controller.setValue(editor, '新草稿')
    expect(editor.textContent).toBe('新草稿')

    const failures: ReplyPreparationFailure[] = []
    document.body.replaceChildren()
    const missingSender = createController({ failures, resolveSender: () => '' })
    expect(await missingSender.prepare(selection(''))).toBe(false)
    expect(failures).toEqual(['sender-unknown'])

    const missingEditor = createController({ failures })
    expect(await missingEditor.prepare(selection('已知用户'))).toBe(false)
    expect(failures).toEqual(['sender-unknown', 'editor-not-found'])
  })

  it('prefers the fullscreen player editor for replies', () => {
    document.body.innerHTML = `
      <section class="chat"><textarea class="side"></textarea></section>
      <section class="player"><textarea class="quick"></textarea></section>
    `
    const controller = createController({ fullscreen: true })
    expect(controller.find({ reply: true })).toBe(document.querySelector('.quick'))
  })
})
