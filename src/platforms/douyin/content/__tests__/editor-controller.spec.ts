import { readFileSync } from 'node:fs'
import { resolve as resolvePath } from 'node:path'

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import {
  createDouyinEditorController,
  type DouyinEditorControllerOptions,
} from '../editor-controller'

function visible(element: Element): boolean {
  return element.getAttribute('data-hidden') !== 'true'
}

function createController(overrides: Partial<DouyinEditorControllerOptions> = {}) {
  return createDouyinEditorController({
    cancelFrame: (handle) => window.clearTimeout(handle),
    closest: (element, selectors) => element.closest(selectors.join(',')),
    fullscreenElement: () => document.fullscreenElement,
    isVisible: visible,
    normalizeWhitespace: (value) => String(value ?? '').replace(/\s+/g, ' ').trim(),
    query: (selectors) => Array.from(document.querySelectorAll(selectors.join(','))),
    requestFrame: (callback) => window.setTimeout(() => callback(performance.now()), 0),
    ...overrides,
  })
}

describe('DouyinEditorController', () => {
  beforeEach(() => {
    document.body.replaceChildren()
    vi.useFakeTimers()
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('scores the side-chat editor above a video editor outside fullscreen', () => {
    document.body.innerHTML = `
      <section class="LivePlayer"><textarea placeholder="弹幕"></textarea></section>
      <section class="ChatMessageList"><textarea placeholder="说点什么"></textarea></section>
    `
    const controller = createController()
    expect(controller.find()).toBe(document.querySelector('.ChatMessageList textarea'))
  })

  it('writes native and contenteditable values and preserves bracket emoji text', () => {
    document.body.innerHTML = `
      <textarea placeholder="说点什么"></textarea>
      <div contenteditable="true"></div>
    `
    const textarea = document.querySelector('textarea')!
    const contenteditable = document.querySelector<HTMLElement>('[contenteditable]')!
    const controller = createController()
    const nativeInput = vi.fn<() => void>()
    const richInput = vi.fn<() => void>()
    textarea.addEventListener('input', nativeInput)
    contenteditable.addEventListener('input', richInput)

    controller.setValue(textarea, '[杀马特][杀马特]cyh')
    controller.setValue(contenteditable, '[表情]正文[表情]')

    expect(textarea.value).toBe('[杀马特][杀马特]cyh')
    expect(contenteditable.textContent).toBe('[表情]正文[表情]')
    expect(nativeInput).toHaveBeenCalledOnce()
    expect(richInput).toHaveBeenCalledOnce()
  })

  it('fills and focuses a reply draft without triggering send events', () => {
    document.body.innerHTML = '<textarea placeholder="说点什么">开头结尾</textarea>'
    const textarea = document.querySelector('textarea')!
    textarea.setSelectionRange(2, 2)
    const sends = vi.fn<() => void>()
    textarea.addEventListener('keydown', sends)
    const controller = createController()

    const result = controller.prepareReply(textarea, '主播')
    vi.runAllTimers()

    expect(result.value).toBe('开头@主播结尾')
    expect(textarea.value).toBe('开头@主播结尾')
    expect(textarea.selectionStart).toBe(5)
    expect(document.activeElement).toBe(textarea)
    expect(sends).not.toHaveBeenCalled()
  })

  it('rediscovers and focuses an editor rebuilt after the reply write', () => {
    document.body.innerHTML = '<section class="ChatMessageList"><textarea placeholder="说点什么"></textarea></section>'
    const original = document.querySelector('textarea')!
    const controller = createController()
    const result = controller.prepareReply(original, '测试用户')
    const replacement = document.createElement('textarea')
    replacement.placeholder = '说点什么'
    replacement.value = result.value
    original.replaceWith(replacement)

    vi.runAllTimers()

    expect(document.activeElement).toBe(replacement)
    expect(replacement.selectionStart).toBe(result.value.length - 1)
  })

  it('observes post-send clearing and releases focus', async () => {
    document.body.innerHTML = '<textarea placeholder="说点什么">待发送</textarea>'
    const textarea = document.querySelector('textarea')!
    const controller = createController()
    textarea.focus()
    const waiting = controller.waitForClear(textarea, 200)
    setTimeout(() => {
      textarea.value = ''
    }, 60)
    await vi.advanceTimersByTimeAsync(100)

    expect(await waiting).toBe(true)
    controller.releaseFocus(textarea)
    expect(document.activeElement).not.toBe(textarea)
  })

  it('stops delayed reply focus after destroy', () => {
    document.body.innerHTML = '<textarea placeholder="说点什么"></textarea>'
    const textarea = document.querySelector('textarea')!
    const controller = createController()
    controller.prepareReply(textarea, '测试用户')
    controller.releaseFocus(textarea)
    controller.destroy()

    vi.runAllTimers()

    expect(document.activeElement).not.toBe(textarea)
  })

  it('keeps Selection, Range, input dispatch and caret operations out of the entry', () => {
    const entry = readFileSync(
      resolvePath(process.cwd(), 'src/entries/douyin-content.ts'),
      'utf8',
    )
    expect(entry).not.toMatch(/document\.createRange\s*\(/)
    expect(entry).not.toMatch(/\bgetSelection\s*\(/)
    expect(entry).not.toMatch(/new\s+InputEvent\s*\(/)
    expect(entry).not.toMatch(/editorSelectionOffsets|placeEditorCaretAt|placeCaretAt/)
  })
})
