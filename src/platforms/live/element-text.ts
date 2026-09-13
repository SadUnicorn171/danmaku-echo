import { parseMessageText } from '../../core/shared'
import { matchesAny } from './deep-dom'

export interface SerializeElementTextOptions {
  imageToken?: (image: HTMLImageElement) => string
  maxLength: number
  removals?: readonly string[]
  rejectRoot?: boolean
}

export function elementMarker(element: unknown): string {
  if (!(element instanceof Element)) return ''
  return [
    element.tagName,
    element.id,
    typeof element.className === 'string' ? element.className : '',
    element.getAttribute('aria-label'),
    element.getAttribute('title'),
    element.getAttribute('placeholder'),
    element.getAttribute('data-placeholder'),
    element.getAttribute('role'),
  ]
    .filter(Boolean)
    .join(' ')
}

export function isElementVisible(element: unknown): element is Element {
  if (!(element instanceof Element) || !element.isConnected) return false
  const style = getComputedStyle(element)
  return (
    style.display !== 'none' &&
    style.visibility !== 'hidden' &&
    Number(style.opacity || 1) > 0 &&
    element.getClientRects().length > 0
  )
}

export function serializedTextFromElement(
  root: Element,
  options: SerializeElementTextOptions,
): string {
  const pieces: string[] = []
  const removals = options.removals ?? []
  const visit = (node: Node, isRoot: boolean): void => {
    if (node.nodeType === Node.TEXT_NODE) {
      pieces.push(node.textContent || '')
      return
    }
    if (!(node instanceof Element)) return
    if ((!isRoot || options.rejectRoot) && matchesAny(node, removals)) return
    if (node instanceof HTMLImageElement) {
      const token = options.imageToken?.(node) ?? ''
      if (token) pieces.push(` ${token} `)
      return
    }
    if (node.tagName === 'BR') {
      pieces.push(' ')
      return
    }
    node.childNodes.forEach((child) => visit(child, false))
  }
  visit(root, true)
  return parseMessageText(pieces.join(''), options.maxLength)
}
