import { afterEach, describe, expect, it, vi } from 'vitest'
import { installRuntimeLogger } from '../../../core/runtime-logger'
import type { RuntimeLog } from '../../../core/runtime-log'

import { SendCoordinator, type SendNetworkObserver } from '../send-coordinator'
import {
  createSendProtection,
  type PlatformFeedbackProbe,
  type PlatformSendFeedback,
  type SendBlock,
} from '../send-protection'

function probe(feedback: PlatformSendFeedback | null): PlatformFeedbackProbe {
  return {
    stop: () => undefined,
    wait: async () => feedback,
  }
}

function network(value: Awaited<ReturnType<SendNetworkObserver['read']>>): SendNetworkObserver {
  return {
    cancel: () => undefined,
    read: async () => value,
  }
}

afterEach(() => {
  installRuntimeLogger({ source: 'test', write: () => {} }).destroy()
  document.body.replaceChildren()
})

describe('SendCoordinator', () => {
  it('records failed attempts once with DOM and request evidence, and skips successful sends', async () => {
    const write = vi.fn<(entry: RuntimeLog) => void>()
    installRuntimeLogger({ source: 'test', write })
    document.body.innerHTML = '<textarea class="chat-input">private-message</textarea>'
    const coordinator = new SendCoordinator({
      platform: 'douyin', protection: createSendProtection({ accidentalIntervalMs: 0 }),
    })
    coordinator.begin('private-message')
    await coordinator.settle({
      message: 'private-message', method: 'text', success: false, feedbackProbe: probe(null),
      networkObserver: network({
        nonce: 'nonce-12345678', platform: 'douyin', source: 'danmaku-echo.live-native-send-observer',
        type: 'native-send-result', transport: 'fetch', endpoint: 'live.douyin.com/webcast/room/chat/',
        requestOnly: true, pending: true, requestFields: ['content', 'csrf'],
      }),
    })
    coordinator.finish('private-message', false)
    expect(write).toHaveBeenCalledTimes(1)
    expect(write.mock.calls[0]?.[0]).toMatchObject({
      message: 'send-failure', details: { reason: 'unconfirmed', networkObserved: true },
      evidence: { schemaVersion: 1, page: { scope: 'current-frame' } },
    })
    expect(JSON.stringify(write.mock.calls)).not.toContain('private-message')
    coordinator.begin('success')
    coordinator.finish('success', true)
    expect(write).toHaveBeenCalledTimes(1)
  })

  it('limits page snapshots while retaining later error summaries and survives snapshot errors', () => {
    const write = vi.fn<(entry: RuntimeLog) => void>()
    installRuntimeLogger({ source: 'test', write })
    const coordinator = new SendCoordinator({
      platform: 'huya', protection: createSendProtection({ accidentalIntervalMs: 0 }),
    })
    for (let index = 0; index < 4; index++) {
      coordinator.begin(`failed-${index}`)
      coordinator.finish(`failed-${index}`, false)
    }
    expect(write).toHaveBeenCalledTimes(4)
    expect(write.mock.calls.filter(([row]) => row.evidence)).toHaveLength(3)
    const brokenDocument = { querySelectorAll() { throw new Error('detached') } } as unknown as Document
    const other = new SendCoordinator({ platform: 'douyin', document: brokenDocument })
    other.begin('failure')
    expect(() => other.finish('failure', false)).not.toThrow()
    expect(write.mock.calls.at(-1)?.[0]).toMatchObject({ message: 'send-failure' })
    expect(write.mock.calls.at(-1)?.[0].evidence).toBeUndefined()
  })

  it('reports in-flight and duplicate blocks through one begin boundary', () => {
    let now = 1_000
    const blocks: SendBlock[] = []
    const coordinator = new SendCoordinator({
      onBlock: (block) => blocks.push(block),
      platform: 'bilibili',
      protection: createSendProtection({ now: () => now }),
    })

    expect(coordinator.begin('同一条')).toBe(true)
    expect(coordinator.begin('另一条')).toBe(false)
    expect(blocks.at(-1)?.reason).toBe('in-flight')
    coordinator.finish('同一条', true)
    now += 1_000
    expect(coordinator.begin('同一条')).toBe(false)
    expect(blocks.at(-1)?.reason).toBe('duplicate')
  })

  it('returns structured platform feedback and applies its cooldown', async () => {
    const feedback: PlatformSendFeedback = {
      cooldownMs: 15_000,
      kind: 'rate-limit',
      message: '发送太快，请稍后再试',
      source: 'page',
      transport: 'page',
    }
    let observedFeedback: PlatformSendFeedback | null = null
    const coordinator = new SendCoordinator({
      onFeedback: (value) => {
        observedFeedback = value
      },
      platform: 'huya',
    })
    expect(coordinator.begin('测试')).toBe(true)

    const result = await coordinator.settle({
      feedbackProbe: probe(feedback),
      message: '测试',
      method: 'text',
      success: false,
    })

    expect(result).toMatchObject({
      failureReason: 'platform-feedback',
      method: 'text',
      success: false,
    })
    expect(observedFeedback).toEqual(feedback)
    expect(coordinator.remainingMs('其他消息')).toBeGreaterThan(0)
  })

  it('distinguishes confirmed success from an unconfirmed native request', async () => {
    const summaries: string[] = []
    const coordinator = new SendCoordinator({
      onUnconfirmed: (summary) => summaries.push(summary),
      platform: 'douyu',
      protection: createSendProtection({ accidentalIntervalMs: 0 }),
    })
    expect(coordinator.begin('测试')).toBe(true)
    const request = {
      endpoint: 'www.douyu.com/chat/send',
      method: 'POST',
      nonce: 'nonce-12345678',
      platform: 'douyu' as const,
      requestOnly: true,
      source: 'danmaku-echo.live-native-send-observer' as const,
      transport: 'fetch' as const,
      type: 'native-send-result' as const,
    }
    const failed = await coordinator.settle({
      feedbackProbe: probe(null),
      message: '测试',
      networkObserver: network(request),
      success: false,
    })
    expect(failed.failureReason).toBe('unconfirmed')
    expect(summaries[0]).toContain('POST www.douyu.com/chat/send')

    expect(coordinator.begin('成功消息')).toBe(true)
    const succeeded = await coordinator.settle({
      feedbackProbe: probe(null),
      message: '成功消息',
      method: 'text',
      success: true,
    })
    expect(succeeded).toMatchObject({ method: 'text', success: true })
  })
})
