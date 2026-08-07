export function readEditorText(editor: Element | null | undefined): string {
  if (!editor) return ''
  if (editor instanceof HTMLInputElement || editor instanceof HTMLTextAreaElement) {
    return editor.value
  }
  return editor.textContent || ''
}

export interface EditorSelectionOffsets {
  end: number
  start: number
}

function isEditableElement(editor: Element | null | undefined): editor is HTMLElement {
  return Boolean(
    editor instanceof HTMLElement
    && (editor.isContentEditable
      || (editor.hasAttribute('contenteditable')
        && editor.getAttribute('contenteditable') !== 'false')),
  )
}

// Reads the caret/selection as character offsets inside the editor text.
// Returns null when the editor is not focused or the selection is outside it.
export function editorSelectionOffsets(editor: Element | null | undefined): EditorSelectionOffsets | null {
  if (!editor) return null
  if (editor instanceof HTMLInputElement || editor instanceof HTMLTextAreaElement) {
    if (typeof editor.selectionStart !== 'number') return null
    const start = Math.max(0, Math.min(editor.selectionStart, editor.value.length))
    const end = typeof editor.selectionEnd === 'number'
      ? Math.max(start, Math.min(editor.selectionEnd, editor.value.length))
      : start
    return { start, end }
  }
  if (!isEditableElement(editor)) return null
  const selection = getSelection()
  if (!selection || selection.rangeCount === 0) return null
  const range = selection.getRangeAt(0)
  if (!editor.contains(range.startContainer) || !editor.contains(range.endContainer)) {
    return null
  }
  const textBefore = (container: Node, offset: number): number => {
    const preRange = document.createRange()
    preRange.selectNodeContents(editor)
    preRange.setEnd(container, offset)
    return preRange.toString().length
  }
  const start = textBefore(range.startContainer, range.startOffset)
  const end = range.collapsed
    ? start
    : textBefore(range.endContainer, range.endOffset)
  return { start, end }
}

export function placeEditorCaretAt(editor: Element, offset: number): void {
  if (!editor) return
  if (editor instanceof HTMLInputElement || editor instanceof HTMLTextAreaElement) {
    const position = Math.max(0, Math.min(offset, editor.value.length))
    if (typeof editor.setSelectionRange === 'function') {
      editor.setSelectionRange(position, position)
    }
    return
  }
  if (!isEditableElement(editor)) return
  const selection = getSelection()
  if (!selection) return
  const range = document.createRange()
  const total = (editor.textContent || '').length
  let remaining = Math.max(0, Math.min(offset, total))
  const walker = document.createTreeWalker(editor, NodeFilter.SHOW_TEXT)
  let node = walker.nextNode()
  while (node) {
    const length = (node.textContent || '').length
    if (remaining <= length) {
      range.setStart(node, remaining)
      range.collapse(true)
      selection.removeAllRanges()
      selection.addRange(range)
      return
    }
    remaining -= length
    node = walker.nextNode()
  }
  range.selectNodeContents(editor)
  range.collapse(false)
  selection.removeAllRanges()
  selection.addRange(range)
}

export function placeEditorCaretAtEnd(editor: Element): void {
  if (editor instanceof HTMLInputElement || editor instanceof HTMLTextAreaElement) {
    const length = editor.value.length
    if (typeof editor.setSelectionRange === 'function') {
      editor.setSelectionRange(length, length)
    }
    return
  }
  if (isEditableElement(editor)) {
    const selection = getSelection()
    if (!selection) return
    const range = document.createRange()
    range.selectNodeContents(editor)
    range.collapse(false)
    selection.removeAllRanges()
    selection.addRange(range)
  }
}

export function dispatchEditorEnter(editor: Element): void {
  const init = {
    bubbles: true,
    cancelable: true,
    code: 'Enter',
    composed: true,
    key: 'Enter',
    keyCode: 13,
    which: 13,
  }
  editor.dispatchEvent(new KeyboardEvent('keydown', init))
  editor.dispatchEvent(new KeyboardEvent('keypress', init))
  editor.dispatchEvent(new KeyboardEvent('keyup', init))
}
