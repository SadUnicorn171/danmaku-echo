import { describe, expect, it } from 'vitest'

import {
  dispatchEditorEnter,
  editorSelectionOffsets,
  placeEditorCaretAt,
  placeEditorCaretAtEnd,
  readEditorText,
} from '../editor-dom'

describe('live editor DOM helpers', () => {
  it('reads native and contenteditable editor values', () => {
    const input = document.createElement('input')
    input.value = 'input value'
    const rich = document.createElement('div')
    rich.setAttribute('contenteditable', 'true')
    rich.textContent = 'rich value'

    expect(readEditorText(input)).toBe('input value')
    expect(readEditorText(rich)).toBe('rich value')
    expect(readEditorText(null)).toBe('')
  })

  it('places the native editor caret at the end', () => {
    const textarea = document.createElement('textarea')
    textarea.value = '弹幕'
    document.body.append(textarea)

    placeEditorCaretAtEnd(textarea)

    expect(textarea.selectionStart).toBe(2)
    expect(textarea.selectionEnd).toBe(2)
  })

  it('reads caret offsets from native editors', () => {
    const textarea = document.createElement('textarea')
    textarea.value = '1232312 3234'
    document.body.append(textarea)
    textarea.focus()

    expect(editorSelectionOffsets(null)).toBeNull()
    expect(editorSelectionOffsets(textarea)).toEqual({ start: 12, end: 12 })

    textarea.setSelectionRange(10, 10)
    expect(editorSelectionOffsets(textarea)).toEqual({ start: 10, end: 10 })

    textarea.setSelectionRange(3, 7)
    expect(editorSelectionOffsets(textarea)).toEqual({ start: 3, end: 7 })
  })

  it('reads caret offsets from contenteditable editors', () => {
    const editor = document.createElement('div')
    editor.setAttribute('contenteditable', 'true')
    editor.textContent = '1232312 3234'
    document.body.append(editor)
    const textNode = editor.firstChild as Text
    const selection = window.getSelection()!

    const caretRange = document.createRange()
    caretRange.setStart(textNode, 10)
    caretRange.collapse(true)
    selection.removeAllRanges()
    selection.addRange(caretRange)
    expect(editorSelectionOffsets(editor)).toEqual({ start: 10, end: 10 })

    const spanRange = document.createRange()
    spanRange.setStart(textNode, 3)
    spanRange.setEnd(textNode, 7)
    selection.removeAllRanges()
    selection.addRange(spanRange)
    expect(editorSelectionOffsets(editor)).toEqual({ start: 3, end: 7 })

    const outside = document.createRange()
    outside.setStart(document.body, 0)
    outside.collapse(true)
    selection.removeAllRanges()
    selection.addRange(outside)
    expect(editorSelectionOffsets(editor)).toBeNull()
  })

  it('places the caret at a character offset in native editors', () => {
    const textarea = document.createElement('textarea')
    textarea.value = '1232312 3234'
    document.body.append(textarea)

    placeEditorCaretAt(textarea, 10)
    expect(textarea.selectionStart).toBe(10)
    expect(textarea.selectionEnd).toBe(10)

    placeEditorCaretAt(textarea, 999)
    expect(textarea.selectionStart).toBe(12)

    placeEditorCaretAt(textarea, -3)
    expect(textarea.selectionStart).toBe(0)
  })

  it('places the caret at a character offset in contenteditable editors', () => {
    const editor = document.createElement('div')
    editor.setAttribute('contenteditable', 'true')
    editor.textContent = '1232312 3234'
    document.body.append(editor)
    const selection = window.getSelection()!

    placeEditorCaretAt(editor, 10)
    expect(selection.rangeCount).toBeGreaterThan(0)
    const range = selection.getRangeAt(0)
    const pre = document.createRange()
    pre.selectNodeContents(editor)
    pre.setEnd(range.startContainer, range.startOffset)
    expect(pre.toString()).toBe('1232312 32')

    placeEditorCaretAt(editor, 999)
    const endRange = selection.getRangeAt(0)
    const preEnd = document.createRange()
    preEnd.selectNodeContents(editor)
    preEnd.setEnd(endRange.startContainer, endRange.startOffset)
    expect(preEnd.toString()).toBe('1232312 3234')

    placeEditorCaretAt(editor, -2)
    const startRange = selection.getRangeAt(0)
    const preStart = document.createRange()
    preStart.selectNodeContents(editor)
    preStart.setEnd(startRange.startContainer, startRange.startOffset)
    expect(preStart.toString()).toBe('')
  })

  it('dispatches the complete Enter key sequence', () => {
    const input = document.createElement('input')
    const events: string[] = []
    for (const type of ['keydown', 'keypress', 'keyup']) {
      input.addEventListener(type, (event) => events.push(`${type}:${(event as KeyboardEvent).key}`))
    }

    dispatchEditorEnter(input)

    expect(events).toEqual(['keydown:Enter', 'keypress:Enter', 'keyup:Enter'])
  })
})
