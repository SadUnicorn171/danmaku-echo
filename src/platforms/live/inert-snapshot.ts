export const ACTIVE_MEDIA_SELECTOR = 'video, audio, iframe, object, embed'

const SNAPSHOT_STYLE_PROPERTIES = [
  'display',
  'box-sizing',
  'font',
  'font-family',
  'font-size',
  'font-style',
  'font-weight',
  'line-height',
  'letter-spacing',
  'text-align',
  'text-shadow',
  '-webkit-text-stroke',
  'color',
  'background',
  'border',
  'border-radius',
  'padding',
  'margin',
  'opacity',
  'filter',
  'white-space',
  'vertical-align',
  'width',
  'height',
  'max-width',
  'max-height',
]

// Descendants inherit most typography from the frozen root. Copying every
// computed typography field into every nested span made a real-site hover pay
// for hundreds of style writes before the browser could paint the paused
// danmaku. Keep only properties that can materially change an inline child.
const SNAPSHOT_DESCENDANT_STYLE_PROPERTIES = [
  'display',
  'box-sizing',
  'font',
  'text-shadow',
  '-webkit-text-stroke',
  'color',
  'background',
  'border',
  'border-radius',
  'padding',
  'margin',
  'opacity',
  'filter',
  'white-space',
  'vertical-align',
  'width',
  'height',
  'max-width',
  'max-height',
]

const BASE_SKIP_SELECTORS = [
  ACTIVE_MEDIA_SELECTOR,
  'script',
  'style',
  'link',
  'meta',
  'canvas',
  'button',
  'input',
  'textarea',
  'select',
  'option',
  "[contenteditable]:not([contenteditable='false'])",
  '[data-bcp-one-owned]',
]

export function inertSnapshotSkipSelector(extraSelectors: readonly string[] = []): string {
  return [...BASE_SKIP_SELECTORS, ...extraSelectors].join(',')
}

export function containsActiveMediaDeep(element: Element): boolean {
  const roots: Array<Element | ShadowRoot> = [element]
  const visited = new Set<Element | ShadowRoot>()
  let inspectedElements = 0
  while (roots.length && visited.size < 24 && inspectedElements < 500) {
    const root = roots.shift()
    if (!root || visited.has(root)) continue
    visited.add(root)

    if (root instanceof Element && root.matches(ACTIVE_MEDIA_SELECTOR)) return true
    try {
      if (root.querySelector(ACTIVE_MEDIA_SELECTOR)) return true
      for (const descendant of root.querySelectorAll('*')) {
        inspectedElements += 1
        if (descendant.shadowRoot && !visited.has(descendant.shadowRoot)) {
          roots.push(descendant.shadowRoot)
        }
        if (inspectedElements >= 500) break
      }
    } catch {
      // Detached and site-owned roots are treated as media-free when they cannot be inspected.
    }
  }
  return false
}

function copyPresentation(source: Element, target: HTMLElement, descendant = false): void {
  const computed = getComputedStyle(source)
  const properties = descendant ? SNAPSHOT_DESCENDANT_STYLE_PROPERTIES : SNAPSHOT_STYLE_PROPERTIES
  for (const property of properties) {
    const value = computed.getPropertyValue(property)
    if (value) target.style.setProperty(property, value, 'important')
  }
  target.style.setProperty('animation', 'none', 'important')
  target.style.setProperty('transition', 'none', 'important')
  target.style.setProperty('pointer-events', 'none', 'important')
}

function appendChildren(
  source: Element,
  target: HTMLElement,
  skipSelector: string,
  budget: { count: number },
  depth: number,
  nodeLimit: number,
): void {
  if (depth > 10 || budget.count >= nodeLimit) return
  for (const child of source.childNodes) {
    if (budget.count >= nodeLimit) break
    if (child.nodeType === Node.TEXT_NODE) {
      target.appendChild(document.createTextNode(child.textContent || ''))
      budget.count += 1
      continue
    }
    if (!(child instanceof Element) || child.matches(skipSelector)) continue

    let inertChild: HTMLElement
    if (child instanceof HTMLImageElement) {
      const image = document.createElement('img')
      const sourceUrl = child.currentSrc || child.src
      if (sourceUrl) image.src = sourceUrl
      image.alt = child.alt || ''
      image.decoding = 'async'
      image.draggable = false
      inertChild = image
    } else if (child.tagName === 'BR') {
      inertChild = document.createElement('br')
    } else {
      inertChild = document.createElement('span')
    }

    copyPresentation(child, inertChild, true)
    target.appendChild(inertChild)
    budget.count += 1
    if (!(child instanceof HTMLImageElement) && child.tagName !== 'BR') {
      appendChildren(child, inertChild, skipSelector, budget, depth + 1, nodeLimit)
    }
  }
}

export function createInertOverlaySnapshot(
  candidate: Element,
  options: { nodeLimit?: number; skipSelector?: string } = {},
): HTMLSpanElement {
  const snapshot = document.createElement('span')
  snapshot.setAttribute('aria-hidden', 'true')
  copyPresentation(candidate, snapshot)
  appendChildren(
    candidate,
    snapshot,
    options.skipSelector || inertSnapshotSkipSelector(),
    { count: 0 },
    0,
    options.nodeLimit || 96,
  )
  return snapshot
}
