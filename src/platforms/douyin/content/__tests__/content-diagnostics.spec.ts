import { afterEach, describe, expect, it, vi } from 'vitest'

import { createDouyinContentDiagnostics } from '../content-diagnostics'
import type { DouyinContentDebugState } from '../runtime-state'

function debugState(): DouyinContentDebugState {
  return {
    counters: {
      cardPointerEnters: 0,
      cardsHidden: 0,
      cardsShown: 0,
      emojiAssetsInserted: 0,
      ownChatIntents: 0,
      ownChatMessagesMarked: 0,
      pings: 0,
      protocolMessagesRejected: 0,
      rendererActivations: 0,
      rendererActivationsRejected: 0,
      sendsAttempted: 0,
      sendsFailed: 0,
      sendsSucceeded: 0,
    },
    events: [],
    href: 'https://live.douyin.com/100',
    lastCard: null,
    lastError: '',
    loadedAt: '2026-09-04T00:00:00.000Z',
    loadedAtMs: Date.now(),
    pageReady: false,
    pageVersion: '',
    settingsEnabled: true,
    version: 'test',
  }
}

afterEach(() => {
  vi.restoreAllMocks()
  vi.useRealTimers()
  document.getElementById('bcp-douyin-content-debug')?.remove()
})

describe('DouyinContentDiagnostics', () => {
  it('publishes a bounded debug marker and removes it on destroy', async () => {
    vi.useFakeTimers()
    vi.spyOn(console, 'info').mockImplementation(() => {})
    const state = debugState()
    const diagnostics = createDouyinContentDiagnostics({
      debugState: state,
      document,
      enabled: () => true,
      href: () => state.href,
      hover: () => ({
        candidate: null,
        hovered: false,
        lockedUntil: 0,
        selectedAt: 0,
        selectionId: 0,
        selectionPhase: 'idle',
        timers: 0,
        visible: false,
      }),
      pageReady: () => state.pageReady,
      pageSnapshot: () => null,
      pageVersion: () => state.pageVersion,
      version: 'test',
    })

    diagnostics.event('ready', { text: 'x'.repeat(300) }, 'info')
    await vi.advanceTimersByTimeAsync(80)

    const marker = document.getElementById('bcp-douyin-content-debug')
    expect(state.events).toHaveLength(1)
    expect(JSON.stringify(state.events[0].details).length).toBeLessThan(280)
    expect(marker?.dataset.version).toBe('test')
    expect(marker?.textContent).toContain('"pageReady":false')

    diagnostics.destroy()
    expect(document.getElementById('bcp-douyin-content-debug')).toBeNull()
  })
})
