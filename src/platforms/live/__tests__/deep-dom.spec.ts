import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { beforeEach, describe, expect, it } from 'vitest'

import {
  closestFromPath,
  closestMatching,
  composedParentElement,
  eventComposedPath,
  matchesAny,
  queryAllDeep,
  queryDocumentElements,
  refreshRoots,
  type DeepRootCache,
} from '../deep-dom'
import { elementMarker, isElementVisible, serializedTextFromElement } from '../element-text'

beforeEach(() => {
  document.body.replaceChildren()
})

describe('deep live DOM queries', () => {
  it('discovers open shadow roots once and de-duplicates selector results', () => {
    const host = document.createElement('div')
    const shadow = host.attachShadow({ mode: 'open' })
    shadow.innerHTML = '<article class="message"><span class="body">你好</span></article>'
    document.body.append(host)
    const cache: DeepRootCache = { cachedAt: 0, roots: [] }

    const roots = refreshRoots(document, cache, { now: 10, ttlMs: 100 })
    expect(roots).toEqual([document, shadow])
    expect(queryAllDeep(roots, ['.message', 'article'])).toHaveLength(1)
    expect(refreshRoots(document, cache, { now: 20, ttlMs: 100 })).toBe(roots)
  })

  it('ignores invalid selectors and walks composed-tree parents', () => {
    const host = document.createElement('div')
    host.className = 'host'
    const shadow = host.attachShadow({ mode: 'open' })
    const child = document.createElement('span')
    child.className = 'child'
    shadow.append(child)
    document.body.append(host)

    expect(queryDocumentElements(document, ['[', '.host'])).toEqual([host])
    expect(matchesAny(child, ['[', '.child'])).toBe(true)
    expect(composedParentElement(child)).toBe(host)
    expect(closestMatching(child, ['.host'])).toBe(host)
    expect(closestFromPath([document.body, child], ['.child'])).toBe(child)
  })

  it('normalizes composed event paths and falls back to the event target', () => {
    const target = document.createElement('button')
    document.body.append(target)
    const dispatched = new Event('test')
    target.dispatchEvent(dispatched)

    expect(eventComposedPath(dispatched)).toEqual([target])
    expect(
      eventComposedPath({ composedPath: () => [target], target: null } as unknown as Event),
    ).toEqual([target])
  })
})

describe('platform-independent element serialization', () => {
  it.each(['bilibili', 'huya', 'douyu', 'douyin'])(
    'keeps %s fixture content ordered without capsule action labels',
    (platform) => {
      document.body.innerHTML = readFileSync(
        resolve(process.cwd(), 'tests', 'fixtures', 'live-dom', `${platform}.html`),
        'utf8',
      )
      const candidate = document.querySelector<HTMLElement>(
        'article, [role="comment"], .bcp-douyin-dom-track',
      )
      expect(candidate).not.toBeNull()
      const action = document.createElement('button')
      action.dataset.bcpOneOwned = 'true'
      action.textContent = '+1 回复 收藏'
      candidate?.append(action)

      const text = serializedTextFromElement(candidate!, {
        imageToken: (image) => image.alt || image.getAttribute('rel') || '',
        maxLength: 1_000,
        removals: ['button', '[data-bcp-one-owned]'],
      })

      expect(text).not.toMatch(/\+1|回复|收藏/u)
      expect(text).not.toBe('')
    },
  )

  it('marks elements and applies connected visibility checks', () => {
    const element = document.createElement('div')
    element.id = 'message'
    element.setAttribute('aria-label', '弹幕')
    document.body.append(element)
    Object.defineProperty(element, 'getClientRects', { value: () => [{ width: 1 }] })

    expect(elementMarker(element)).toContain('message')
    expect(elementMarker(element)).toContain('弹幕')
    expect(isElementVisible(element)).toBe(true)
    element.style.display = 'none'
    expect(isElementVisible(element)).toBe(false)
  })
})
