import { replyDraftValue } from '../../core/reply'
import type { LivePlatformConfig, SupportedContentPlatform } from './config'
import {
  editorSelectionOffsets,
  placeEditorCaretAt,
  placeEditorCaretAtEnd,
  readEditorText,
} from './editor-dom'
import { TEXT_EDITOR_SELECTOR } from './editor-config'
import type { LiveSelection } from './runtime-state'

export type ReplyPreparationFailure = 'editor-not-found' | 'sender-unknown'

export interface EditorControllerOptions {
  activateQuickInput?(): boolean
  clearSelection(): void
  closest(element: Element, selectors: readonly string[]): Element | null
  config: LivePlatformConfig
  fullscreenActive(): boolean
  fullscreenElement(): Element | null
  invalidateRoots?(): void
  isQuickInput?(element: Element): boolean
  isVisible(element: Element): boolean
  onFailure(reason: ReplyPreparationFailure): void
  platform: SupportedContentPlatform
  query(selectors: readonly string[]): Element[]
  resolveSender(selection: LiveSelection, scanDom: boolean): string
  requestFrame?(callback: FrameRequestCallback): number
  senderResolveAttempts?: number
  senderResolveIntervalMs?: number
}

export interface EditorFindOptions {
  reply?: boolean
}

export class EditorController {
  private readonly options: EditorControllerOptions

  constructor(options: EditorControllerOptions) {
    this.options = options
  }

  private isQuickInput(element: Element): boolean {
    return this.options.platform === 'bilibili' && Boolean(this.options.isQuickInput?.(element))
  }

  private surfaceScore(element: Element, index: number): number {
    const fullscreen = this.options.fullscreenElement()
    const isFullscreen = this.options.fullscreenActive()
    const insideFullscreen = Boolean(
      fullscreen && (fullscreen === element || fullscreen.contains(element)),
    )
    const insideVideo = Boolean(this.options.closest(element, this.options.config.videoRoots))
    const insideChat = Boolean(this.options.closest(element, this.options.config.chatRoots))
    const quickInput = this.isQuickInput(element)
    let score = 1_000 - index
    if (isFullscreen) {
      if (insideFullscreen) score += 1_400
      if (insideVideo) score += 800
      if (quickInput) score += 900
      if (insideChat && !insideFullscreen) score -= 1_200
    } else {
      if (insideChat) score += 700
      if (!insideVideo) score += 300
      if (insideVideo || quickInput) score -= 900
    }
    return score
  }

  private appendEditors(root: Document | Element | ShadowRoot, candidates: Element[]): void {
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

  find(options: EditorFindOptions = {}): Element | null {
    const candidates = this.options.query(this.options.config.inputs)
    const fullscreen = this.options.fullscreenElement()
    if (this.options.fullscreenActive()) {
      if (fullscreen) this.appendEditors(fullscreen, candidates)
      this.options
        .query(this.options.config.videoRoots)
        .forEach((root) => this.appendEditors(root, candidates))
    } else {
      this.options
        .query(this.options.config.chatRoots)
        .forEach((root) => this.appendEditors(root, candidates))
    }

    const usable = candidates.filter((element) => {
      const disabled =
        element.matches(':disabled') ||
        element.getAttribute('aria-disabled') === 'true' ||
        element.getAttribute('contenteditable') === 'false'
      return !disabled && element.isConnected && element.matches(TEXT_EDITOR_SELECTOR)
    })
    const visible = usable
      .filter((element) => this.options.isVisible(element))
      .map((element) => ({ element, index: candidates.indexOf(element) }))
      .sort(
        (left, right) =>
          this.surfaceScore(right.element, right.index) -
          this.surfaceScore(left.element, left.index),
      )

    if (options.reply && this.options.platform === 'bilibili' && this.options.fullscreenActive()) {
      return (
        visible.find(
          ({ element }) =>
            this.isQuickInput(element) ||
            Boolean(this.options.closest(element, this.options.config.videoRoots)) ||
            Boolean(fullscreen && (fullscreen === element || fullscreen.contains(element))),
        )?.element ?? null
      )
    }
    if (visible.length) return visible[0].element
    if (!options.reply && this.options.platform === 'bilibili' && this.options.fullscreenActive()) {
      return usable[0] ?? null
    }
    return null
  }

  findEmojiEditor(): Element | null {
    if (this.options.platform !== 'bilibili') return null
    const fullscreen = this.options.fullscreenElement()
    const candidates = this.options.query(this.options.config.inputs).filter((element) => {
      const disabled =
        element.matches(':disabled') ||
        element.getAttribute('aria-disabled') === 'true' ||
        element.getAttribute('contenteditable') === 'false'
      const insideFullscreen = Boolean(
        fullscreen && (fullscreen === element || fullscreen.contains(element)),
      )
      return (
        !disabled &&
        element.isConnected &&
        element.matches(TEXT_EDITOR_SELECTOR) &&
        !insideFullscreen &&
        !this.isQuickInput(element)
      )
    })
    candidates.sort((first, second) => {
      const score = (element: Element): number =>
        (element.matches('textarea.chat-input,.chat-input-ctnr textarea,.chat-input') ? 1_200 : 0) +
        (this.options.closest(element, this.options.config.chatRoots) ? 600 : 0) +
        (this.options.isVisible(element) ? 120 : 0)
      return score(second) - score(first)
    })
    return candidates[0] ?? null
  }

  private async findReplyEditor(): Promise<Element | null> {
    let editor = this.find({ reply: true })
    if (
      editor ||
      this.options.platform !== 'bilibili' ||
      !this.options.fullscreenActive() ||
      !this.options.activateQuickInput
    ) {
      return editor
    }
    this.options.activateQuickInput()
    for (const delay of [0, 40, 80, 140, 220, 360]) {
      if (delay) await new Promise((resolve) => setTimeout(resolve, delay))
      this.options.invalidateRoots?.()
      editor = this.find({ reply: true })
      if (editor) return editor
    }
    return null
  }

  setValue(editor: Element, value: string): void {
    const hiddenBilibiliFullscreen =
      this.options.platform === 'bilibili' &&
      this.options.fullscreenActive() &&
      !this.options.isVisible(editor)
    if (!hiddenBilibiliFullscreen && editor instanceof HTMLElement) {
      editor.focus({ preventScroll: true })
    }

    if (editor instanceof HTMLInputElement || editor instanceof HTMLTextAreaElement) {
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
      return
    }

    if (
      editor instanceof HTMLElement &&
      (editor.isContentEditable ||
        (editor.hasAttribute('contenteditable') &&
          editor.getAttribute('contenteditable') !== 'false'))
    ) {
      if (hiddenBilibiliFullscreen) {
        editor.textContent = value
      } else {
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
          document.execCommand('selectAll', false)
          inserted = document.execCommand('insertText', false, value)
        } catch {
          inserted = false
        }
        if (!inserted) editor.textContent = value
      }
      editor.dispatchEvent(
        new InputEvent('input', {
          bubbles: true,
          composed: true,
          data: value,
          inputType: 'insertText',
        }),
      )
    }
  }

  private focusReply(editor: Element, expectedValue: string, caretOffset: number | null): void {
    const focus = (): void => {
      const current = editor.isConnected ? editor : this.find({ reply: true })
      if (!(current instanceof HTMLElement) || readEditorText(current) !== expectedValue) return
      current.focus({ preventScroll: true })
      if (Number.isFinite(caretOffset)) placeEditorCaretAt(current, Number(caretOffset))
      else placeEditorCaretAtEnd(current)
    }
    focus()
    ;(this.options.requestFrame ?? requestAnimationFrame)(focus)
    setTimeout(focus, 50)
  }

  async prepare(selection: LiveSelection): Promise<boolean> {
    let sender = selection.sender
    const attempts = Math.max(1, this.options.senderResolveAttempts ?? 7)
    const interval = Math.max(0, this.options.senderResolveIntervalMs ?? 70)
    for (let attempt = 0; !sender && attempt < attempts; attempt += 1) {
      sender = this.options.resolveSender(selection, attempt === 0)
      if (!sender && attempt + 1 < attempts) {
        await new Promise((resolve) => setTimeout(resolve, interval))
      }
    }
    if (!sender) {
      this.options.onFailure('sender-unknown')
      return false
    }
    const editor = await this.findReplyEditor()
    if (!editor) {
      this.options.onFailure('editor-not-found')
      return false
    }

    const currentValue = readEditorText(editor)
    const offsets = editorSelectionOffsets(editor)
    const mention = `@${sender}`
    const insertionStart = offsets?.start ?? currentValue.length
    const nextValue = replyDraftValue(currentValue, sender, offsets?.start, offsets?.end)
    const caretOffset = nextValue !== currentValue ? insertionStart + mention.length : null
    this.setValue(editor, nextValue)
    this.options.clearSelection()
    this.focusReply(editor, nextValue, caretOffset)
    return true
  }
}
