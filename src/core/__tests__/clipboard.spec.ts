import { afterEach, describe, expect, it, vi } from 'vitest'

import { copyTextToClipboard } from '../clipboard'

const originalClipboard = Object.getOwnPropertyDescriptor(navigator, 'clipboard')
const originalExecCommand = document.execCommand

afterEach(() => {
  vi.restoreAllMocks()
  if (originalClipboard) Object.defineProperty(navigator, 'clipboard', originalClipboard)
  else Reflect.deleteProperty(navigator, 'clipboard')
  document.execCommand = originalExecCommand
  document.querySelectorAll('textarea[aria-hidden="true"]').forEach((item) => item.remove())
})

describe('copyTextToClipboard', () => {
  it('copies the exact danmaku with the Clipboard API', async () => {
    const writeText = vi.fn<(text: string) => Promise<void>>().mockResolvedValue(undefined)
    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: { writeText },
    })

    await expect(copyTextToClipboard('你好[开心]')).resolves.toBe(true)
    expect(writeText).toHaveBeenCalledWith('你好[开心]')
  })

  it('falls back to a temporary selection when clipboard access is rejected', async () => {
    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: {
        writeText: vi.fn<(text: string) => Promise<void>>()
          .mockRejectedValue(new Error('denied')),
      },
    })
    document.execCommand = vi.fn<(commandId: string) => boolean>(() => true)

    await expect(copyTextToClipboard('[开心]加油')).resolves.toBe(true)
    expect(document.execCommand).toHaveBeenCalledWith('copy')
    expect(document.querySelector('textarea[aria-hidden="true"]')).toBeNull()
  })

  it('rejects empty content without touching the clipboard', async () => {
    const writeText = vi.fn<(text: string) => Promise<void>>()
    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: { writeText },
    })
    await expect(copyTextToClipboard('')).resolves.toBe(false)
    expect(writeText).not.toHaveBeenCalled()
  })
})
