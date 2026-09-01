import type { LiveAudienceMetric } from './live-audience'

export const LIVE_AUDIENCE_FRAME_READ = 'danmaku-echo.live-audience.frame-read'
export const LIVE_AUDIENCE_FRAME_REPORT = 'danmaku-echo.live-audience.frame-report'
export const LIVE_AUDIENCE_FRAME_STALE_MS = 5_000

export interface LiveAudienceFrameReadRequest {
  platform: 'bilibili'
  type: typeof LIVE_AUDIENCE_FRAME_READ
}

export interface LiveAudienceFrameReportRequest {
  metric: LiveAudienceMetric
  platform: 'bilibili'
  type: typeof LIVE_AUDIENCE_FRAME_REPORT
}

export interface LiveAudienceFrameResponse {
  metric?: LiveAudienceMetric
  ok: boolean
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object'
}

function positiveInteger(value: unknown): number | null {
  const number = Number(value)
  return Number.isSafeInteger(number) && number >= 0 ? number : null
}

export function isLiveAudienceFrameReadRequest(
  value: unknown,
): value is LiveAudienceFrameReadRequest {
  return isRecord(value)
    && value.type === LIVE_AUDIENCE_FRAME_READ
    && value.platform === 'bilibili'
}

export function isLiveAudienceFrameReportRequest(
  value: unknown,
): value is LiveAudienceFrameReportRequest {
  if (!isRecord(value) || value.type !== LIVE_AUDIENCE_FRAME_REPORT
    || value.platform !== 'bilibili' || !isRecord(value.metric)) return false
  const metric = value.metric
  return metric.platform === 'bilibili'
    && metric.kind === 'viewers'
    && metric.source === 'dom'
    && typeof metric.rawText === 'string'
    && metric.rawText.length <= 40
    && positiveInteger(metric.value) !== null
}
