import type { PlatformId } from '../../core/types'

export const SEND_STATISTICS_MESSAGE = 'danmaku-echo.send-statistics'
export const SEND_STATISTICS_INDEX_KEY = 'danmakuEchoSendStatisticsIndexV1'
export const SEND_STATISTICS_DAY_PREFIX = 'danmakuEchoSendStatisticsDayV1:'

export interface ConfirmedSend {
  id: string
  platform: PlatformId
  roomId: string
  /** UTC Unix time in whole seconds, captured when the send is confirmed. */
  sentAtSec: number
  /** Submitted text / textual emoji names only; absent in older records. */
  text?: string
  confirmation?: 'platform' | 'page'
}

export interface SendStatisticsRequest {
  type: typeof SEND_STATISTICS_MESSAGE
  action: 'append' | 'read' | 'export' | 'clear'
  event?: ConfirmedSend
  filter?: StatisticsFilter
}

export function isConfirmedSend(value: unknown): value is ConfirmedSend {
  if (!value || typeof value !== 'object') return false
  const event = value as Partial<ConfirmedSend>
  return typeof event.id === 'string' && /^[a-z0-9-]{12,100}$/i.test(event.id)
    && (event.platform === 'bilibili' || event.platform === 'douyin'
      || event.platform === 'douyu' || event.platform === 'huya')
    && typeof event.roomId === 'string' && event.roomId.length > 0
    && event.roomId.length <= 300 && Array.from(event.roomId).every((char) => char.charCodeAt(0) >= 32)
    && Number.isSafeInteger(event.sentAtSec) && event.sentAtSec! > 0
    && Number.isFinite(new Date(event.sentAtSec! * 1_000).getTime())
    && (event.text === undefined || typeof event.text === 'string')
    && (event.confirmation === undefined || event.confirmation === 'platform' || event.confirmation === 'page')
}

export interface StatisticsFilter {
  from?: string
  to?: string
  platform?: PlatformId
  room?: string
  text?: string
}
export interface StatisticsCursor { date: string; before: number }
