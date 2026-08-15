export const DOUYU_NATIVE_DANMAKU_ACTION_MARKER = 'data-bcp-douyu-native-action-hidden'

export const DOUYU_NATIVE_DANMAKU_ACTION_SELECTORS = [
  "[class*='interactive-element-']",
  "[class*='reply-button-']",
  "[class*='action-button-']",
  "[data-action='plus-one' i]",
  "[data-action='plusOne' i]",
  "[data-action='reply' i]",
  "[data-action='collect' i]",
  "[data-action='favorite' i]",
  "[aria-label='+1']",
  "[aria-label='回复']",
  "[aria-label='收藏']",
  "[title='+1']",
  "[title='回复']",
  "[title='收藏']",
] as const

export const DOUYU_NATIVE_DANMAKU_CAPSULE_CONTAINER_SELECTORS = [
  ":is(div, span):not([class*='danmuItem-']):has(> [class*='interactive-element-']):has(> [class*='reply-button-'])",
  ":is(div, span):not([class*='danmuItem-']):has(> [class*='interactive-element-']):has(> [class*='action-button-'])",
  ":is(div, span):not([class*='danmuItem-']):has(> [class*='reply-button-']):has(> [class*='action-button-'])",
] as const

// Douyu mounts this triangle beside btnsInner-* inside #comment-dzjy-container,
// rather than inside the action panel or the hovered danmaku item. Keep it in
// a separate list so the content script can find the detached portal node
// globally without broadening the scan for the older afterDiv-* wrapper.
export const DOUYU_NATIVE_DANMAKU_CAPSULE_DETACHED_DECORATION_SELECTORS = [
  "[class*='btnscontainerrect-']",
] as const

export const DOUYU_NATIVE_DANMAKU_CAPSULE_DECORATION_SELECTORS = [
  ...DOUYU_NATIVE_DANMAKU_CAPSULE_DETACHED_DECORATION_SELECTORS,
] as const

const ACTION_LABELS = new Set(['+1', '回复', '收藏'])
const DANMAKU_ITEM_SELECTOR = "[class*='danmuItem-']"
const ACTION_KIND_SELECTORS = {
  plusOne: [
    "[class*='interactive-element-']",
    "[data-action='plus-one' i]",
    "[data-action='plusOne' i]",
    "[aria-label='+1']",
    "[title='+1']",
  ],
  reply: [
    "[class*='reply-button-']",
    "[data-action='reply' i]",
    "[aria-label='回复']",
    "[title='回复']",
  ],
  favorite: [
    "[class*='action-button-']",
    "[data-action='collect' i]",
    "[data-action='favorite' i]",
    "[aria-label='收藏']",
    "[title='收藏']",
  ],
} as const
const HIDDEN_STYLE_PROPERTIES = ['display', 'visibility', 'pointer-events'] as const

interface InlineStyleSnapshot {
  priority: string
  value: string
}

interface VisibilitySnapshot {
  ariaHidden: string | null
  hidden: string | null
  styles: Record<(typeof HIDDEN_STYLE_PROPERTIES)[number], InlineStyleSnapshot>
}

function readInlineStyle(
  element: HTMLElement,
  property: (typeof HIDDEN_STYLE_PROPERTIES)[number],
): InlineStyleSnapshot {
  return {
    priority: element.style.getPropertyPriority(property),
    value: element.style.getPropertyValue(property),
  }
}

function restoreInlineStyle(
  element: HTMLElement,
  property: (typeof HIDDEN_STYLE_PROPERTIES)[number],
  snapshot: InlineStyleSnapshot,
): void {
  if (snapshot.value) {
    element.style.setProperty(property, snapshot.value, snapshot.priority)
  } else {
    element.style.removeProperty(property)
  }
}

function setAttributeValue(element: HTMLElement, name: string, value: string | null): void {
  if (value === null) {
    element.removeAttribute(name)
  } else {
    element.setAttribute(name, value)
  }
}

function captureVisibility(element: HTMLElement): VisibilitySnapshot {
  return {
    ariaHidden: element.getAttribute('aria-hidden'),
    hidden: element.getAttribute('hidden'),
    styles: {
      display: readInlineStyle(element, 'display'),
      visibility: readInlineStyle(element, 'visibility'),
      'pointer-events': readInlineStyle(element, 'pointer-events'),
    },
  }
}

function forceHidden(element: HTMLElement): void {
  if (!element.hidden) element.hidden = true
  if (element.getAttribute('aria-hidden') !== 'true') {
    element.setAttribute('aria-hidden', 'true')
  }
  if (element.getAttribute(DOUYU_NATIVE_DANMAKU_ACTION_MARKER) !== 'true') {
    element.setAttribute(DOUYU_NATIVE_DANMAKU_ACTION_MARKER, 'true')
  }
  for (const property of HIDDEN_STYLE_PROPERTIES) {
    const expected =
      property === 'pointer-events' ? 'none' : property === 'display' ? 'none' : 'hidden'
    if (
      element.style.getPropertyValue(property) !== expected ||
      element.style.getPropertyPriority(property) !== 'important'
    ) {
      element.style.setProperty(property, expected, 'important')
    }
  }
}

/**
 * Applies a reversible, v-show-like visibility state directly to Douyu's
 * native action component. The controller retains the original inline state
 * so enabling the setting restores exactly what Douyu rendered.
 */
export class DouyuNativeCapsuleVisibilityController {
  private readonly snapshots = new Map<HTMLElement, VisibilitySnapshot>()

  get hiddenCount(): number {
    return this.snapshots.size
  }

  hide(targets: Iterable<Element>): void {
    for (const target of targets) {
      if (!(target instanceof HTMLElement)) continue
      // Never write attributes or inline styles into a moving danmaku item.
      // Douyu's native hover controller owns that subtree and observes it
      // while calculating its pause/resume position. CSS hides those visuals
      // without changing their box metrics; only detached portal UI is
      // collapsed by this controller.
      if (target.closest(DANMAKU_ITEM_SELECTOR)) continue
      if (!this.snapshots.has(target)) {
        this.snapshots.set(target, captureVisibility(target))
      }
      forceHidden(target)
    }
  }

  reinforce(): void {
    for (const target of this.snapshots.keys()) {
      forceHidden(target)
    }
  }

  releaseDisconnected(): void {
    for (const [target, snapshot] of this.snapshots) {
      if (target.isConnected) continue
      this.restore(target, snapshot)
      this.snapshots.delete(target)
    }
  }

  showAll(): void {
    for (const [target, snapshot] of this.snapshots) {
      this.restore(target, snapshot)
    }
    this.snapshots.clear()
  }

  private restore(target: HTMLElement, snapshot: VisibilitySnapshot): void {
    setAttributeValue(target, 'hidden', snapshot.hidden)
    setAttributeValue(target, 'aria-hidden', snapshot.ariaHidden)
    target.removeAttribute(DOUYU_NATIVE_DANMAKU_ACTION_MARKER)
    for (const property of HIDDEN_STYLE_PROPERTIES) {
      restoreInlineStyle(target, property, snapshot.styles[property])
    }
  }
}

function actionLabel(element: Element): string {
  const value = String(element.textContent || '')
    .replace(/[\s|｜·•]/gu, '')
    .trim()
  return ACTION_LABELS.has(value) ? value : ''
}

function actionLabelsWithin(element: Element): Set<string> {
  const labels = new Set<string>()
  for (const candidate of [element, ...element.querySelectorAll('*')]) {
    const label = actionLabel(candidate)
    if (label) labels.add(label)
  }
  return labels
}

function actionKind(element: Element): keyof typeof ACTION_KIND_SELECTORS | '' {
  for (const [kind, selectors] of Object.entries(ACTION_KIND_SELECTORS)) {
    if (selectors.some((selector) => element.matches(selector))) {
      return kind as keyof typeof ACTION_KIND_SELECTORS
    }
  }
  return ''
}

function actionKindsWithin(element: Element): Set<keyof typeof ACTION_KIND_SELECTORS> {
  const kinds = new Set<keyof typeof ACTION_KIND_SELECTORS>()
  const candidates = [
    element,
    ...element.querySelectorAll(DOUYU_NATIVE_DANMAKU_ACTION_SELECTORS.join(',')),
  ]
  for (const candidate of candidates) {
    const kind = actionKind(candidate)
    if (kind) kinds.add(kind)
  }
  return kinds
}

function closestMultiActionContainer(root: Element, element: Element): Element | null {
  let current = element.parentElement
  while (current) {
    // The renderer itself contains the actual danmaku text. It must never be
    // hidden merely because Douyu mounted action controls directly beneath it.
    if (current.matches(DANMAKU_ITEM_SELECTOR)) return null
    if (actionKindsWithin(current).size >= 2 || actionLabelsWithin(current).size >= 2) {
      return current
    }
    if (current === root) break
    current = current.parentElement
  }
  return null
}

function actionOnlyShells(root: Element, element: Element): Element[] {
  const shells: Element[] = []
  let current = element.parentElement
  while (current) {
    if (current.matches(DANMAKU_ITEM_SELECTOR)) break

    const hasMultipleActions =
      actionKindsWithin(current).size >= 2 || actionLabelsWithin(current).size >= 2
    if (hasMultipleActions) {
      const remainingText = String(current.textContent || '')
        .replace(/\+1|回复|收藏/gu, '')
        .replace(/[\s|｜·•]/gu, '')
      if (!remainingText) shells.push(current)
    }

    if (current === root) break
    current = current.parentElement
  }
  return shells
}

export function findDouyuNativeDanmakuCapsuleTargets(root: Element): Element[] {
  const targets = new Set<Element>()
  const decorationScopes = new Set<Element>()
  const decorationSelector = DOUYU_NATIVE_DANMAKU_CAPSULE_DECORATION_SELECTORS.join(',')
  const detachedDecorationSelector =
    DOUYU_NATIVE_DANMAKU_CAPSULE_DETACHED_DECORATION_SELECTORS.join(',')

  // The current Douyu capsule portal renders btnscontainerrect-* as a sibling
  // of btnsInner-*. It must be collected even when this root is not a danmaku
  // item and the action panel has already been removed or hidden.
  if (root.matches(detachedDecorationSelector)) targets.add(root)
  root
    .querySelectorAll(detachedDecorationSelector)
    .forEach((decoration) => targets.add(decoration))

  const actionSelector = DOUYU_NATIVE_DANMAKU_ACTION_SELECTORS.join(',')
  const actionElements = [
    ...(root.matches(actionSelector) ? [root] : []),
    ...root.querySelectorAll(actionSelector),
  ]
  for (const element of actionElements) {
    targets.add(element)
    actionOnlyShells(root, element).forEach((shell) => targets.add(shell))
    const container = closestMultiActionContainer(root, element)
    if (container) {
      targets.add(container)
    }

    const danmakuItem = element.closest(DANMAKU_ITEM_SELECTOR)
    if (danmakuItem && (danmakuItem === root || root.contains(danmakuItem))) {
      decorationScopes.add(danmakuItem)
    } else if (container?.parentElement) {
      decorationScopes.add(container.parentElement)
    }
  }

  const labelElements = [root, ...root.querySelectorAll('*')].filter((element) =>
    Boolean(actionLabel(element)),
  )
  for (const element of labelElements) {
    actionOnlyShells(root, element).forEach((shell) => targets.add(shell))
    const container = closestMultiActionContainer(root, element)
    if (container) {
      targets.add(container)
      const danmakuItem = container.closest(DANMAKU_ITEM_SELECTOR)
      decorationScopes.add(danmakuItem || container.parentElement || container)
    }
  }

  for (const scope of decorationScopes) {
    if (scope.matches(decorationSelector)) targets.add(scope)
    scope.querySelectorAll(decorationSelector).forEach((decoration) => targets.add(decoration))
  }

  return Array.from(targets)
}
