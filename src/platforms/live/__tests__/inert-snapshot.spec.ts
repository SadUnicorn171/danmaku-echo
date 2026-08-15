import { describe, expect, it } from 'vitest'

import {
  containsActiveMediaDeep,
  createInertOverlaySnapshot,
  inertSnapshotSkipSelector,
} from '../inert-snapshot'

describe('inert overlay snapshots', () => {
  it('detects active media inside open shadow roots', () => {
    const candidate = document.createElement('div')
    const host = document.createElement('span')
    host.attachShadow({ mode: 'open' }).append(document.createElement('video'))
    candidate.append(host)

    expect(containsActiveMediaDeep(candidate)).toBe(true)
    expect(containsActiveMediaDeep(document.createElement('div'))).toBe(false)
  })

  it('copies presentation into inert built-in elements without active controls', () => {
    const candidate = document.createElement('div')
    candidate.innerHTML = [
      '<custom-player><strong>保留文字</strong></custom-player>',
      '<video src="test.mp4"></video>',
      '<button>不要复制</button>',
      '<img alt="[微笑]" src="emoji.png">',
    ].join('')

    const snapshot = createInertOverlaySnapshot(candidate, {
      skipSelector: inertSnapshotSkipSelector(['[data-test-owned]']),
    })

    expect(snapshot.getAttribute('aria-hidden')).toBe('true')
    expect(snapshot.textContent).toContain('保留文字')
    expect(snapshot.querySelector('custom-player')).toBeNull()
    expect(snapshot.querySelector('video')).toBeNull()
    expect(snapshot.querySelector('button')).toBeNull()
    expect(snapshot.querySelector('img')?.alt).toBe('[微笑]')
    expect(snapshot.style.getPropertyValue('pointer-events')).toBe('none')
    expect(snapshot.style.getPropertyPriority('pointer-events')).toBe('important')
  })

  it('bounds the copied node count', () => {
    const candidate = document.createElement('div')
    for (let index = 0; index < 100; index += 1) {
      candidate.append(document.createElement('span'))
    }

    const snapshot = createInertOverlaySnapshot(candidate, { nodeLimit: 8 })

    expect(snapshot.querySelectorAll('*').length).toBeLessThanOrEqual(8)
  })

  it('can exclude a site-owned tail decoration from the frozen snapshot', () => {
    const candidate = document.createElement('div')
    candidate.innerHTML = [
      '<span class="text-next">测试弹幕</span>',
      '<span class="afterDiv-next"><span class="afterpic-next" style="border: 8px solid transparent; border-left-color: #000"></span></span>',
    ].join('')

    const snapshot = createInertOverlaySnapshot(candidate, {
      skipSelector: inertSnapshotSkipSelector([
        "[class*='afterpic-']",
        "[class*='afterDiv-']",
      ]),
    })

    expect(snapshot.textContent).toBe('测试弹幕')
    expect(snapshot.children).toHaveLength(1)
  })
})
