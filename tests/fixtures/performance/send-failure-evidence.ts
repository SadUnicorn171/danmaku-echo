// Frozen pre-optimization reference (2026-09-16). Test/benchmark use only.
/** A bounded, data-only snapshot. HTML is reconstructed only when exporting. */
export interface DiagnosticDomNode {
  depth: number
  tag: string
  attributes: Record<string, string>
  textLength?: number
}

export interface DiagnosticDomFragment {
  label: string
  truncated: boolean
  nodes: DiagnosticDomNode[]
}

export interface SendFailureEvidence {
  schemaVersion: 1
  attemptId: string
  startedAt: number
  capturedAt: number
  page: {
    scope: 'current-frame'
    fragments: DiagnosticDomFragment[]
  }
}

const MAX_NODES = 500
const MAX_BYTES = 48_000
const OMIT_SUBTREE = /^(script|style|noscript|template|iframe|object|embed)$/
const STRUCTURAL_ATTRIBUTE = /^(id|class|role|type|name|contenteditable|disabled|readonly|checked|aria-disabled|aria-hidden|data-e2e|data-testid)$/

function structuralValue(value: string): string {
  // Retain selector-like names, never arbitrary attribute values or long IDs.
  return value.split(/\s+/).slice(0, 8)
    .map((part) => /^[a-z_-][a-z0-9_-]{0,47}$/i.test(part)
      && !/cookie|token|secret|csrf|password|sessdata|authorization/i.test(part)
      ? part.replace(/\d{5,}/g, 'redacted') : '[redacted]')
    .join(' ').slice(0, 160)
}

export function normalizeSendFailureEvidence(value: unknown): SendFailureEvidence | undefined {
  if (!value || typeof value !== 'object') return undefined
  const raw = value as Partial<SendFailureEvidence>
  if (raw.schemaVersion !== 1 || typeof raw.attemptId !== 'string'
    || !/^[a-z0-9._:-]{1,120}$/i.test(raw.attemptId)
    || !Number.isFinite(raw.startedAt) || !Number.isFinite(raw.capturedAt)
    || !Array.isArray(raw.page?.fragments)) return undefined
  let count = 0
  let bytes = 0
  const encoder = new TextEncoder()
  const fragments: DiagnosticDomFragment[] = []
  for (const fragment of raw.page.fragments.slice(0, 5)) {
    if (!fragment || !Array.isArray(fragment.nodes)) continue
    const nodes: DiagnosticDomNode[] = []
    let truncated = fragment.truncated === true
    for (const node of fragment.nodes.slice(0, MAX_NODES + 1)) {
      if (count >= MAX_NODES || bytes >= MAX_BYTES) { truncated = true; break }
      if (!node || typeof node.tag !== 'string' || !/^[a-z][a-z0-9-]{0,39}$/.test(node.tag)
        || OMIT_SUBTREE.test(node.tag)) continue
      const attributes: Record<string, string> = {}
      if (node.attributes && typeof node.attributes === 'object') {
        for (const [key, item] of Object.entries(node.attributes).slice(0, 16)) {
          if (STRUCTURAL_ATTRIBUTE.test(key) && typeof item === 'string') {
            attributes[key] = structuralValue(item)
          }
        }
      }
      const safe: DiagnosticDomNode = {
        depth: Math.min(32, Math.max(0, Number.isInteger(node.depth) ? node.depth : 0)),
        tag: node.tag,
        attributes,
        ...(Number.isFinite(node.textLength) ? { textLength: Math.max(0, Math.min(100_000, node.textLength!)) } : {}),
      }
      const size = encoder.encode(JSON.stringify(safe)).length
      if (bytes + size > MAX_BYTES) { truncated = true; break }
      nodes.push(safe)
      bytes += size
      count++
    }
    fragments.push({
      label: ['document', 'focused-control', 'editor', 'fullscreen'].includes(fragment.label)
        ? fragment.label : 'document',
      truncated: truncated || fragment.nodes.length > nodes.length,
      nodes,
    })
  }
  return {
    schemaVersion: 1,
    attemptId: raw.attemptId,
    startedAt: raw.startedAt!,
    capturedAt: raw.capturedAt!,
    page: { scope: 'current-frame', fragments },
  }
}

/** Called only on a failed attempt. Never reads input values or raw outerHTML. */
export function captureSendFailureEvidence(attemptId: string, startedAt: number, doc: Document): SendFailureEvidence {
  const roots: Array<{ label: string; root: Element }> = []
  const add = (label: string, root: Element | null) => {
    if (root && !roots.some((item) => item.root === root)) roots.push({ label, root })
  }
  const active = doc.activeElement
  if (active && active !== doc.body && active !== doc.documentElement) add('focused-control', active.parentElement)
  for (const editor of doc.querySelectorAll('textarea, [contenteditable="true"], input[type="text"]')) {
    add('editor', editor.parentElement)
    if (roots.length >= 3) break
  }
  add('fullscreen', doc.fullscreenElement)
  add('document', doc.documentElement)
  let remaining = MAX_NODES
  const fragments = roots.map(({ label, root }) => {
    const nodes: DiagnosticDomNode[] = []
    const limit = label === 'document' ? remaining : Math.min(80, remaining)
    let truncated = false
    let visited = 0
    const visit = (node: Node, depth: number): void => {
      if (nodes.length >= limit || depth > 32 || ++visited > 2000) { truncated = true; return }
      if (node.nodeType !== 1) return
      const element = node as Element
      const tag = element.localName.toLowerCase()
      if (OMIT_SUBTREE.test(tag)) return
      const attributes: Record<string, string> = {}
      for (const name of element.getAttributeNames().slice(0, 32)) {
        if (STRUCTURAL_ATTRIBUTE.test(name)) attributes[name] = structuralValue(element.getAttribute(name) || '')
      }
      let textLength = 0
      // Count text without copying it into evidence; skip textarea/password content.
      for (let child = element.firstChild; child; child = child.nextSibling) {
        if (child.nodeType === 3 && tag !== 'textarea') textLength += child.textContent?.length || 0
      }
      nodes.push({ depth, tag, attributes, ...(textLength ? { textLength } : {}) })
      const children = element.shadowRoot?.children || element.children
      for (const child of children) {
        if (nodes.length >= limit || visited >= 2000) { truncated = true; break }
        visit(child, depth + 1)
      }
    }
    visit(root, 0)
    remaining -= nodes.length
    return { label, truncated, nodes }
  })
  return normalizeSendFailureEvidence({
    schemaVersion: 1, attemptId, startedAt, capturedAt: Date.now(),
    page: { scope: 'current-frame', fragments },
  })!
}

export function exportSendFailureEvidence(evidence: SendFailureEvidence) {
  const escape = (value: string) => value.replace(/&/g, '&amp;').replace(/</g, '&lt;')
    .replace(/>/g, '&gt;').replace(/"/g, '&quot;')
  return {
    ...evidence,
    page: {
      scope: evidence.page.scope,
      fragments: evidence.page.fragments.map(({ label, nodes, truncated }) => {
        const lines: string[] = []
        const stack: string[] = []
        for (const node of nodes) {
          while (stack.length > node.depth) lines.push(`</${stack.pop()}>`)
          const attrs = Object.entries(node.attributes).map(([key, value]) => ` ${key}="${escape(value)}"`).join('')
          lines.push(`<${node.tag}${attrs}>${node.textLength ? `<!-- text omitted: ${node.textLength} chars -->` : ''}`)
          if (!/^(area|base|br|col|hr|img|input|link|meta|param|source|track|wbr)$/.test(node.tag)) stack.push(node.tag)
        }
        while (stack.length) lines.push(`</${stack.pop()}>`)
        return { label, truncated, html: lines.join('\n') }
      }),
    },
  }
}
