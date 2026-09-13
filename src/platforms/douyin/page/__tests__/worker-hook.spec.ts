import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

import { describe, expect, it } from 'vitest'

import { createDouyinWorkerHook, parseDouyinRendererCommand } from '../worker-hook'
import type {
  DouyinMessageSenderTarget,
  DouyinRendererCommand,
  DouyinWorkerHook,
} from '../worker-hook'

type TestPostMessage = (this: object, ...args: unknown[]) => unknown

interface SenderHarness {
  deliveries: Array<{ args: unknown[]; receiver: object }>
  original: TestPostMessage
  prototype: object
  target: DouyinMessageSenderTarget
}

function createSenderHarness(name: DouyinMessageSenderTarget['name']): SenderHarness {
  const deliveries: SenderHarness['deliveries'] = []
  const result = { delivered: name }
  const original: TestPostMessage = function originalPostMessage(...args: unknown[]) {
    deliveries.push({ args, receiver: this })
    return result
  }
  const prototype = { postMessage: original }
  return { deliveries, original, prototype, target: { name, prototype } }
}

function post(prototype: object, receiver: object, message: unknown, transfer?: unknown): unknown {
  const method = (prototype as { postMessage: TestPostMessage }).postMessage
  return Reflect.apply(method, receiver, transfer === undefined ? [message] : [message, transfer])
}

function rendererMessage(method: string, params: Record<string, unknown> = {}): object {
  return { _uniqueId: 'renderer-1', method, params }
}

describe('Douyin worker renderer command parser', () => {
  it('converts known worker messages into bounded renderer commands', () => {
    const offscreen = { width: 1280 }
    expect(
      parseDouyinRendererCommand(
        rendererMessage('createInstance', {
          barrages: [{ content: [] }, null, 'invalid'],
          config: { duration: 15_000, width: 1280 },
          offscrrenCanvas: offscreen,
        }),
      ),
    ).toMatchObject({
      barrages: [{ content: [] }],
      config: { duration: 15_000, width: 1280 },
      instanceId: 'renderer-1',
      offscreen,
      type: 'create-instance',
    })
    expect(
      parseDouyinRendererCommand(rendererMessage('addBarrage', { content: [] })),
    ).toMatchObject({ barrage: { content: [] }, instanceId: 'renderer-1', type: 'add-barrage' })
    expect(parseDouyinRendererCommand(rendererMessage('updateConfig', { gap: 80 }))).toMatchObject({
      config: { gap: 80 },
      instanceId: 'renderer-1',
      type: 'update-config',
    })
    expect(parseDouyinRendererCommand(rendererMessage('clear'))).toEqual({
      instanceId: 'renderer-1',
      type: 'clear',
    })
  })

  it('ignores unrelated traffic and messages without an instance id', () => {
    expect(parseDouyinRendererCommand({ method: 'addBarrage', params: {} })).toBeNull()
    expect(parseDouyinRendererCommand(rendererMessage('privateTelemetry'))).toBeNull()
    expect(parseDouyinRendererCommand('socket-frame')).toBeNull()
  })
})

describe('DouyinWorkerHook', () => {
  it('observes before delivery while preserving message and transfer references', () => {
    const sender = createSenderHarness('Worker')
    const commands: DouyinRendererCommand[] = []
    const order: string[] = []
    const original = sender.original
    ;(sender.prototype as { postMessage: TestPostMessage }).postMessage = function (...args) {
      order.push('deliver')
      return Reflect.apply(original, this, args)
    }
    const hook = createDouyinWorkerHook({
      onCommand: (command) => {
        order.push('observe')
        commands.push(command)
      },
      targets: [sender.target],
    })
    hook.install()
    const receiver = Object.create(sender.prototype) as object
    const message = rendererMessage('addBarrage', { content: [{ text: '测试' }] })
    const transferList: object[] = [{ transferable: true }]

    const result = post(sender.prototype, receiver, message, transferList)

    expect(order).toEqual(['observe', 'deliver'])
    expect(sender.deliveries).toHaveLength(1)
    expect(sender.deliveries[0]?.receiver).toBe(receiver)
    expect(sender.deliveries[0]?.args[0]).toBe(message)
    expect(sender.deliveries[0]?.args[1]).toBe(transferList)
    expect(result).toEqual({ delivered: 'Worker' })
    expect(commands).toHaveLength(1)
    hook.destroy()
  })

  it('never blocks the native delivery when command handling throws', () => {
    const sender = createSenderHarness('MessagePort')
    let errorCount = 0
    const hook = createDouyinWorkerHook({
      onCommand: () => {
        throw new Error('observer failed')
      },
      onError: () => {
        errorCount += 1
      },
      targets: [sender.target],
    })
    hook.install()

    expect(() => post(sender.prototype, {}, rendererMessage('clear'))).not.toThrow()
    expect(sender.deliveries).toHaveLength(1)
    expect(errorCount).toBe(1)
    hook.destroy()
  })

  it('passes unrelated traffic through without emitting renderer commands', () => {
    const sender = createSenderHarness('Worker')
    const commands: DouyinRendererCommand[] = []
    const hook = createDouyinWorkerHook({
      onCommand: (command) => commands.push(command),
      targets: [sender.target],
    })
    hook.install()
    const privatePayload = { event: 'private-telemetry' }

    post(sender.prototype, {}, privatePayload)

    expect(sender.deliveries[0]?.args[0]).toBe(privatePayload)
    expect(commands).toEqual([])
    expect(hook.diagnostics()).toMatchObject({ commandCount: 0, ignoredMessageCount: 1 })
    hook.destroy()
  })

  it('shares one wrapper across owners and restores each original method once', () => {
    const worker = createSenderHarness('Worker')
    const port = createSenderHarness('MessagePort')
    const hooks: DouyinWorkerHook[] = []
    const create = (): DouyinWorkerHook => {
      const hook = createDouyinWorkerHook({
        onCommand: () => undefined,
        targets: [worker.target, port.target],
      })
      hooks.push(hook)
      return hook
    }
    const first = create()
    const second = create()

    expect(first.install()).toBe(true)
    const workerWrapper = (worker.prototype as { postMessage: TestPostMessage }).postMessage
    const portWrapper = (port.prototype as { postMessage: TestPostMessage }).postMessage
    expect(first.install()).toBe(true)
    expect(second.install()).toBe(true)
    expect((worker.prototype as { postMessage: TestPostMessage }).postMessage).toBe(workerWrapper)
    expect((port.prototype as { postMessage: TestPostMessage }).postMessage).toBe(portWrapper)
    expect(second.diagnostics().reusedPatchCount).toBe(2)

    first.destroy()
    expect((worker.prototype as { postMessage: TestPostMessage }).postMessage).toBe(workerWrapper)
    second.destroy()
    expect((worker.prototype as { postMessage: TestPostMessage }).postMessage).toBe(worker.original)
    expect((port.prototype as { postMessage: TestPostMessage }).postMessage).toBe(port.original)
    hooks.forEach((hook) => hook.destroy())
  })

  it('keeps sender prototype patching and WebSocket traffic out of the page entry', () => {
    const entry = readFileSync(resolve(process.cwd(), 'src/entries/douyin-page-hook.ts'), 'utf8')
    const hook = readFileSync(
      resolve(process.cwd(), 'src/platforms/douyin/page/worker-hook.ts'),
      'utf8',
    )
    const app = readFileSync(
      resolve(process.cwd(), 'src/platforms/douyin/page/page-app.ts'),
      'utf8',
    )
    expect(entry).not.toContain('Worker.prototype')
    expect(entry).not.toContain('MessagePort.prototype')
    expect(entry).not.toContain('patchMessageSender')
    expect(entry).toContain('createDouyinPageAppRuntime')
    expect(app).toContain('createDouyinWorkerHook')
    expect(hook).not.toContain('WebSocket')
  })
})
