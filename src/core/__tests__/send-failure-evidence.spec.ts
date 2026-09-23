import { afterEach, describe, expect, it } from 'vitest'
import { captureSendFailureEvidence, exportSendFailureEvidence, normalizeSendFailureEvidence } from '../send-failure-evidence'

afterEach(() => document.body.replaceChildren())

describe('send failure page evidence', () => {
  it('bounds actual work for a page containing many adjacent text nodes', () => {
    const fragment = document.createDocumentFragment()
    for (let index = 0; index < 10_000; index++) fragment.append(document.createTextNode('x'))
    document.body.append(fragment)
    const evidence = captureSendFailureEvidence('attempt-text-nodes', 123, document)
    expect(evidence.page.fragments.some((item) => item.truncated)).toBe(true)
    const textLength = evidence.page.fragments.flatMap((item) => item.nodes).reduce((total, node) => total + (node.textLength || 0), 0)
    expect(textLength).toBeLessThanOrEqual(2_000)
    expect(textLength).toBeGreaterThan(0)
  })

  it('exports useful editor markup without page text, input values, scripts or private attributes', () => {
    document.body.innerHTML = `
      <main id="player" class="live-player"><script>secretScript()</script>
        <form class="chat-editor" data-token="secret-token">
          <textarea placeholder="private-user">private-message</textarea>
          <input type="password" value="private-password">
          <button class="send-button" onclick="secretHandler()">Send private-message</button>
          <a href="https://example.com/?token=private-token">private-user</a>
        </form>
      </main>`
    document.querySelector('textarea')!.focus()
    const evidence = captureSendFailureEvidence('attempt-12345678', 123, document)
    const exported = exportSendFailureEvidence(evidence)
    const serialized = JSON.stringify(exported)
    expect(serialized).toContain('chat-editor')
    expect(serialized).toContain('send-button')
    expect(serialized).toContain('<textarea>')
    expect(serialized).not.toContain('private-')
    expect(serialized).not.toContain('secret')
    expect(serialized).not.toContain('onclick')
    expect(evidence.page.fragments[0]?.label).toBe('focused-control')
    expect(normalizeSendFailureEvidence(evidence)).toEqual(evidence)
  })

  it('bounds large pages and revalidates untrusted serialized nodes without needing DOM APIs', () => {
    document.body.innerHTML = '<div class="message">text</div>'.repeat(2000)
    const evidence = captureSendFailureEvidence('attempt-large', 123, document)
    expect(evidence.page.fragments.some((fragment) => fragment.truncated)).toBe(true)
    expect(evidence.page.fragments.flatMap((fragment) => fragment.nodes).length).toBeLessThanOrEqual(500)
    expect(new TextEncoder().encode(JSON.stringify(evidence)).length).toBeLessThan(50_000)
    evidence.page.fragments[0]!.nodes.unshift({ depth: 0, tag: 'script', attributes: {} })
    evidence.page.fragments[0]!.nodes[1]!.attributes = { onclick: 'secret()', value: 'private', class: 'editor' }
    const safe = normalizeSendFailureEvidence(evidence)!
    const output = JSON.stringify(exportSendFailureEvidence(safe))
    expect(output).not.toContain('<script')
    expect(output).not.toContain('secret')
    expect(output).not.toContain('private')
  })
})
