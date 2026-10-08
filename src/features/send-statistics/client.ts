import type { PlatformId } from '../../core/types'
import { recordRuntimeLog } from '../../core/runtime-logger'
import { currentRoomContext } from '../favorites/room-context'
import { SEND_STATISTICS_MESSAGE, type ConfirmedSend, type SendStatisticsRequest } from './types'

let lastFailureLogAt = 0

/** A statistics write cannot change the outcome of a platform send. */
export function recordConfirmedSend(id: string, sentAtSec: number, platform: PlatformId, roomId: string | undefined, text: string, confirmation: 'platform' | 'page'): void {
  const event: ConfirmedSend = { id, platform, roomId: roomId || currentRoomContext(platform).roomId, sentAtSec, text, confirmation }
  const request: SendStatisticsRequest = { type: SEND_STATISTICS_MESSAGE, action: 'append', event }
  const append = async (): Promise<void> => {
    const response = await chrome.runtime.sendMessage(request)
    if (!response?.ok) throw new Error('send-statistics-write-failed')
  }
  void append().catch(async () => {
    try {
      await new Promise<void>((resolve) => setTimeout(resolve, 500))
      await append() // The same attempt ID makes this retry idempotent.
    } catch {
      const now = Date.now()
      if (now - lastFailureLogAt >= 60_000) {
        lastFailureLogAt = now
        recordRuntimeLog('warn', 'send-statistics-write-failed', { platform })
      }
    }
  })
}
