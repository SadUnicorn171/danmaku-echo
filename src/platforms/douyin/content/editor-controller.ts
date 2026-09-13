import { normalizeSenderName, replyDraftValue } from '../../../core/reply'
import {
  dispatchEditorEnter,
  editorSelectionOffsets,
  placeEditorCaretAt,
  placeEditorCaretAtEnd,
  readEditorText,
} from '../../live/editor-dom'
import {
  CHAT_ROOT_SELECTORS,
  EDITABLE_ELEMENT_SELECTOR,
  INPUT_SELECTORS,
  TEXT_EDITOR_SELECTOR,
  VIDEO_ROOT_SELECTORS,
} from './dom-config'

export interface DouyinEditorControllerOptions {
  closest(element: Element, selectors: readonly string[]): Element | null
  fullscreenElement(): Element | null
  isVisible(element: Element): boolean
  normalizeWhitespace(value: unknown): string
  query(selectors: readonly string[]): Element[]
  requestFrame?(callback: FrameRequestCallback): number
  cancelFrame?(handle: number): void
}

export interface DouyinReplyDraftResult {
  alreadyFilled: boolean
  caretOffset: number | null
  editor: HTMLElement
  sender: string
  value: string
}

export interface DouyinEditorController {
  contains(editor: Element | null | undefined, expectedValue: string): boolean
  destroy(): void
  editableFrom(target: EventTarget | null): HTMLElement | null
  find(): HTMLElement | null
  isEmpty(editor: Element | null | undefined): boolean
  mention(editor: Element | null | undefined): string
  prepareReply(
    editor: HTMLElement,
    sender: string,
    alreadyFilled?: boolean,
  ): DouyinReplyDraftResult
  pressEnter(editor: HTMLElement): void
  read(editor: Element | null | undefined): string
  releaseFocus(editor?: HTMLElement | null): void
  setValue(editor: HTMLElement, value: string): void
  start(): void
  waitForClear(editor: HTMLElement, timeoutMs: number): Promise<boolean>
  waitForConsumption(
    editor: HTMLElement,
    expectedValue: string,
    timeoutMs: number,
  ): Promise<boolean>
}

function isContentEditable(editor: HTMLElement): boolean {
  return Boolean(
    editor.isContentEditable ||
      (editor.hasAttribute('contenteditable') &&
        editor.getAttribute('contenteditable') !== 'false'),
  )
}

function isNativeTextEditor(
  editor: HTMLElement,
): editor is HTMLInputElement | HTMLTextAreaElement {
  return editor instanceof HTMLInputElement || editor instanceof HTMLTextAreaElement
}

export function createDouyinEditorController(
  options: DouyinEditorControllerOptions,
): DouyinEditorController {
  const requestFrame = options.requestFrame ?? requestAnimationFrame
  const cancelFrame = options.cancelFrame ?? cancelAnimationFrame
  let active = true
  let focusFrame = 0
  let focusTimer: ReturnType<typeof setTimeout> | 0 = 0

  function clearFocusSchedule(): void {
    if (focusFrame) cancelFrame(focusFrame)
    if (focusTimer) clearTimeout(focusTimer)
    focusFrame = 0
    focusTimer = 0
  }

  function surfaceScore(element: Element, index: number): number {
    const fullscreen = options.fullscreenElement()
    const insideFullscreen = Boolean(
      fullscreen && (fullscreen === element || fullscreen.contains(element)),
    )
    const insideVideo = Boolean(options.closest(element, VIDEO_ROOT_SELECTORS))
    const insideChat = Boolean(options.closest(element, CHAT_ROOT_SELECTORS))
    let score = 1_000 - index
    if (fullscreen) {
      if (insideFullscreen) score += 1_400
      if (insideVideo) score += 800
      if (insideChat && !insideFullscreen) score -= 1_200
    } else {
      if (insideChat) score += 700
      if (!insideVideo) score += 300
      if (insideVideo) score -= 900
    }
    return score
  }

  function appendEditors(root: Document | Element | ShadowRoot, candidates: Element[]): void {
    const seen = new Set(candidates)
    let editors: NodeListOf<Element>
    try {
      editors = root.querySelectorAll(TEXT_EDITOR_SELECTOR)
    } catch {
      return
    }
    for (const editor of editors) {
      if (!seen.has(editor)) {
        seen.add(editor)
        candidates.push(editor)
      }
    }
  }

  function find(): HTMLElement | null {
    const candidates = options.query(INPUT_SELECTORS)
    const fullscreen = options.fullscreenElement()
    if (fullscreen) {
      appendEditors(fullscreen, candidates)
    } else {
      options.query(CHAT_ROOT_SELECTORS).forEach((root) => appendEditors(root, candidates))
    }
    const usable = candidates.filter(
      (element): element is HTMLElement =>
        element instanceof HTMLElement &&
        element.isConnected &&
        element.matches(TEXT_EDITOR_SELECTOR) &&
        !element.matches(':disabled') &&
        element.getAttribute('aria-disabled') !== 'true' &&
        element.getAttribute('contenteditable') !== 'false' &&
        options.isVisible(element),
    )
    usable.sort(
      (left, right) =>
        surfaceScore(right, candidates.indexOf(right)) -
        surfaceScore(left, candidates.indexOf(left)),
    )
    return usable[0] ?? null
  }

  function editableFrom(target: EventTarget | null): HTMLElement | null {
    if (!(target instanceof Element)) return null
    const editor = target.matches(EDITABLE_ELEMENT_SELECTOR)
      ? target
      : target.closest(EDITABLE_ELEMENT_SELECTOR)
    return editor instanceof HTMLElement ? editor : null
  }

  function setValue(editor: HTMLElement, value: string): void {
    editor.focus({ preventScroll: true })
    if (isNativeTextEditor(editor)) {
      const prototype =
        editor instanceof HTMLTextAreaElement
          ? HTMLTextAreaElement.prototype
          : HTMLInputElement.prototype
      const setter = Object.getOwnPropertyDescriptor(prototype, 'value')?.set
      if (setter) setter.call(editor, value)
      else editor.value = value
      editor.dispatchEvent(
        new InputEvent('input', {
          bubbles: true,
          composed: true,
          data: value,
          inputType: 'insertText',
        }),
      )
      editor.dispatchEvent(new Event('change', { bubbles: true, composed: true }))
      placeEditorCaretAtEnd(editor)
      return
    }
    if (!isContentEditable(editor)) return
    editor.dispatchEvent(
      new InputEvent('beforeinput', {
        bubbles: true,
        cancelable: true,
        composed: true,
        data: value,
        inputType: 'insertText',
      }),
    )
    let inserted = false
    try {
      const selection = getSelection()
      if (selection) {
        const range = document.createRange()
        range.selectNodeContents(editor)
        selection.removeAllRanges()
        selection.addRange(range)
      }
      inserted = document.execCommand('insertText', false, value)
    } catch {
      inserted = false
    }
    if (!inserted) editor.textContent = value
    placeEditorCaretAtEnd(editor)
    editor.dispatchEvent(
      new InputEvent('input', {
        bubbles: true,
        composed: true,
        data: value,
        inputType: 'insertText',
      }),
    )
  }

  function focusWhenStable(
    original: HTMLElement,
    expectedValue: string,
    caretOffset: number | null,
  ): void {
    clearFocusSchedule()
    const focus = (): void => {
      if (!active) return
      const editor = original.isConnected ? original : find()
      if (!editor || readEditorText(editor) !== expectedValue) return
      editor.focus({ preventScroll: true })
      if (Number.isFinite(caretOffset)) placeEditorCaretAt(editor, Number(caretOffset))
      else placeEditorCaretAtEnd(editor)
    }
    focus()
    focusFrame = requestFrame(() => {
      focusFrame = 0
      focus()
    })
    focusTimer = setTimeout(() => {
      focusTimer = 0
      focus()
    }, 50)
  }

  function mention(editor: Element | null | undefined): string {
    const match = readEditorText(editor).match(/^\s*@\s*([^\s：:,，]{1,64})(?:\s|$)/u)
    return normalizeSenderName(match?.[1])
  }

  function prepareReply(
    editor: HTMLElement,
    sender: string,
    alreadyFilled = false,
  ): DouyinReplyDraftResult {
    const normalizedSender = normalizeSenderName(sender) || mention(editor)
    const currentValue = readEditorText(editor)
    const offsets = editorSelectionOffsets(editor)
    const insertionStart = offsets?.start ?? currentValue.length
    const nextValue = alreadyFilled
      ? currentValue
      : replyDraftValue(currentValue, normalizedSender, offsets?.start, offsets?.end)
    const mentionText = `@${normalizedSender}`
    const caretOffset =
      !alreadyFilled && nextValue !== currentValue
        ? insertionStart + mentionText.length
        : null
    if (!alreadyFilled) setValue(editor, nextValue)
    focusWhenStable(editor, nextValue, caretOffset)
    return {
      alreadyFilled,
      caretOffset,
      editor,
      sender: normalizedSender,
      value: nextValue,
    }
  }

  function isEmpty(editor: Element | null | undefined): boolean {
    if (!editor || !editor.isConnected) return true
    if (options.normalizeWhitespace(readEditorText(editor))) return false
    return !editor.querySelector('img,[data-emoji],[data-emoticon]')
  }

  function contains(editor: Element | null | undefined, expectedValue: string): boolean {
    return Boolean(
      editor?.isConnected &&
        options.normalizeWhitespace(readEditorText(editor)) ===
          options.normalizeWhitespace(expectedValue),
    )
  }

  async function waitUntil(predicate: () => boolean, timeoutMs: number): Promise<boolean> {
    const deadline = Date.now() + timeoutMs
    while (Date.now() < deadline) {
      if (predicate()) return true
      await new Promise((resolve) => setTimeout(resolve, 50))
    }
    return predicate()
  }

  function releaseFocus(editor?: HTMLElement | null): void {
    clearFocusSchedule()
    const target = editor?.isConnected ? editor : editableFrom(document.activeElement)
    try {
      target?.blur()
    } catch {
      // Controlled editors can be replaced between consumption and cleanup.
    }
  }

  return {
    contains,
    destroy() {
      active = false
      clearFocusSchedule()
    },
    editableFrom,
    find,
    isEmpty,
    mention,
    prepareReply,
    pressEnter: dispatchEditorEnter,
    read: readEditorText,
    releaseFocus,
    setValue,
    start() {
      active = true
    },
    waitForClear: (editor, timeoutMs) => waitUntil(() => isEmpty(editor), timeoutMs),
    waitForConsumption: (editor, expectedValue, timeoutMs) =>
      waitUntil(() => !contains(editor, expectedValue), timeoutMs),
  }
}
