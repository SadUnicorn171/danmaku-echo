import { describe, expect, expectTypeOf, it } from 'vitest'

import { mergeSettings } from '../../../../core/shared'
import {
  createDouyinContentRuntimeState,
} from '../runtime-state'
import {
  type DouyinDomCandidate,
  type DouyinSelection,
} from '../dom-hover-controller'

describe('DouyinContentRuntimeState', () => {
  it('creates isolated mutable services and empty lifecycle resources', () => {
    const first = createDouyinContentRuntimeState(mergeSettings())
    const second = createDouyinContentRuntimeState(mergeSettings())

    first.replyRequests.set('request-1', { at: 1, status: 'pending' })
    expect(second.replyRequests.size).toBe(0)
    expect(first.cooldownTimer).toBe(0)
    expect(first.pageReady).toBe(false)
    expect(first.pageSnapshot).toBeNull()
  })

  it('keeps DOM candidates and active selections structurally distinct', () => {
    const candidate: DouyinDomCandidate = {
      content: [],
      kind: 'video-dom',
      message: '测试弹幕',
      rect: { height: 30, left: 20, top: 10, width: 120 },
      richPayload: {
        assets: [],
        parts: [{ text: '测试弹幕', type: 'text' }],
        plainText: '测试弹幕',
        text: '测试弹幕',
      },
      sender: 'viewer',
      style: {},
      trackId: 'dom-1',
    }
    const selection: DouyinSelection = {
      candidate,
      id: 1,
      lockedUntil: 2500,
      phase: 'armed',
      selectedAt: 100,
    }

    expect(selection.candidate).toBe(candidate)
    expectTypeOf(selection.phase).toEqualTypeOf<'armed' | 'engaged' | 'grace' | 'idle'>()
  })
})
