export type DeepQueryRoot = Document | ShadowRoot

export interface DeepRootCache {
  cachedAt: number
  roots: DeepQueryRoot[]
}

export interface RefreshDeepRootsOptions {
  maximumRoots?: number
  now?: number
  ttlMs?: number
}

export function eventComposedPath(event: Event): readonly EventTarget[] {
  if (typeof event.composedPath === 'function') {
    const path = event.composedPath()
    if (path.length) return path
  }
  return event.target ? [event.target] : []
}

export function refreshRoots(
  documentRoot: Document,
  cache: DeepRootCache,
  options: RefreshDeepRootsOptions = {},
): DeepQueryRoot[] {
  const now = options.now ?? Date.now()
  const ttlMs = options.ttlMs ?? 3_000
  if (cache.roots.length && now - cache.cachedAt < ttlMs) return cache.roots

  const maximumRoots = Math.max(1, options.maximumRoots ?? 40)
  const roots: DeepQueryRoot[] = [documentRoot]
  const queue: DeepQueryRoot[] = [documentRoot]
  const visited = new Set<DeepQueryRoot>(queue)
  while (queue.length && roots.length < maximumRoots) {
    const root = queue.shift()
    if (!root) break
    let elements: NodeListOf<Element>
    try {
      elements = root.querySelectorAll('*')
    } catch {
      continue
    }
    for (const element of elements) {
      const shadowRoot = element.shadowRoot
      if (!shadowRoot || visited.has(shadowRoot)) continue
      visited.add(shadowRoot)
      roots.push(shadowRoot)
      queue.push(shadowRoot)
      if (roots.length >= maximumRoots) break
    }
  }
  cache.cachedAt = now
  cache.roots = roots
  return roots
}

export function queryAllDeep(
  roots: Iterable<DeepQueryRoot>,
  selectors: readonly string[],
): Element[] {
  const results: Element[] = []
  const seen = new Set<Element>()
  for (const root of roots) {
    for (const selector of selectors) {
      let matches: NodeListOf<Element>
      try {
        matches = root.querySelectorAll(selector)
      } catch {
        continue
      }
      for (const match of matches) {
        if (seen.has(match)) continue
        seen.add(match)
        results.push(match)
      }
    }
  }
  return results
}

export function queryDocumentElements(
  documentRoot: Document,
  selectors: readonly string[],
): Element[] {
  return queryAllDeep([documentRoot], selectors)
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

export function closestFromPath(
  path: readonly EventTarget[],
  selectors: readonly string[],
): Element | null {
  return (path.find((item) => matchesAny(item, selectors)) as Element | undefined) || null
}

export function composedParentElement(element: Element): Element | null {
  if (element.parentElement) return element.parentElement
  const root = element.getRootNode()
  return root instanceof ShadowRoot ? root.host : null
}

export function closestMatching(element: unknown, selectors: readonly string[]): Element | null {
  let current = element instanceof Element ? element : null
  while (current) {
    if (matchesAny(current, selectors)) return current
    current = composedParentElement(current)
  }
  return null
}
