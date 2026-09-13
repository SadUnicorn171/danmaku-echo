import { describe, expect, it } from 'vitest'

import type { SendCoordinator, SendResult } from '../send-coordinator'
import { LiveTextSender } from '../text-sender'

function coordinator(settleResult: SendResult = { success: true }): {
  settleCalls: Array<Record<string, unknown>>
  value: SendCoordinator
} {
  const settleCalls: Array<Record<string, unknown>> = []
  const value = {
    begin: () => true,
    feedbackProbe: () => ({
      stop: () => undefined,
      wait: async () => null,
    }),
    finish: () => undefined,
    observeNetwork: async () => ({
      cancel: () => undefined,
      read: async () => null,
    }),
    async settle(options: Record<string, unknown>) {
      settleCalls.push(options)
      return settleResult
    },
  } as unknown as SendCoordinator
  return { settleCalls, value }
}

describe('LiveTextSender', () => {
  it('uses the official editor and confirms that the editor was consumed', async () => {
    const input = document.createElement('textarea')
    const button = document.createElement('button')
    let clicks = 0
    let released = false
    button.addEventListener('click', () => {
      clicks += 1
    })
    const sendCoordinator = coordinator()
    const sender = new LiveTextSender({
      coordinator: sendCoordinator.value,
      document,
      findInput: () => input,
      findSendButton: () => button,
      platformName: '测试平台',
      pressEnter: () => undefined,
      releaseInputFocus: () => {
        released = true
      },
      setNativeValue: (element, value) => {
        ;(element as HTMLTextAreaElement).value = value
      },
      showToast: () => undefined,
      waitForInputConsumption: async () => true,
    })

    await expect(sender.send('测试弹幕')).resolves.toBe(true)
    expect(input.value).toBe('测试弹幕')
    expect(clicks).toBe(1)
    expect(released).toBe(true)
    expect(sendCoordinator.settleCalls).toHaveLength(1)
    expect(sendCoordinator.settleCalls[0]).toMatchObject({ method: 'text', success: true })
  })

  it('does not report success when the platform returns a rate-limit failure', async () => {
    const input = document.createElement('textarea')
    const sendCoordinator = coordinator({ failureReason: 'platform-feedback', success: false })
    const toasts: string[] = []
    const sender = new LiveTextSender({
      coordinator: sendCoordinator.value,
      document,
      findInput: () => input,
      findSendButton: () => document.createElement('button'),
      platformName: '测试平台',
      pressEnter: () => undefined,
      releaseInputFocus: () => undefined,
      setNativeValue: () => undefined,
      showToast: (message) => toasts.push(message),
      waitForInputConsumption: async () => false,
    })

    await expect(sender.send('重复弹幕')).resolves.toBe(false)
    expect(sendCoordinator.settleCalls).toHaveLength(1)
    expect(sendCoordinator.settleCalls[0]).toMatchObject({ method: 'text', success: false })
    expect(toasts).toEqual([])
  })
})
