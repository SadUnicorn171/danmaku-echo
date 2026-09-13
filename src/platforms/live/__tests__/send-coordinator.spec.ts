import { describe, expect, it } from 'vitest'

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

describe('SendCoordinator', () => {
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
