export type DouyinQueryRoot = Document | DocumentFragment | Element

export function queryAll(
  selectors: readonly string[],
  root: DouyinQueryRoot = document,
): Element[] {
  const results: Element[] = []
  const seen = new Set<Element>()
  for (const selector of selectors) {
    let matches: NodeListOf<Element>
    try {
      matches = root.querySelectorAll(selector)
    } catch {
      continue
    }
    for (const element of matches) {
      if (seen.has(element)) continue
      seen.add(element)
      results.push(element)
    }
  }
  return results
}

export function matchesAny(element: unknown, selectors: readonly string[]): boolean {
  if (!(element instanceof Element)) return false
  return selectors.some((selector) => {
    try {
      return element.matches(selector)
    } catch {
      return false
    }
  })
}

export function closestAny(element: unknown, selectors: readonly string[]): Element | null {
  let current = element instanceof Element ? element : null
  while (current) {
    if (matchesAny(current, selectors)) return current
    current = current.parentElement
  }
  return null
}

export function isDouyinOwnedNode(node: unknown): boolean {
  return node instanceof Element && Boolean(node.closest('[data-bcp-douyin-owned]'))
}
