import { describe, expect, it } from 'vitest'
import {
  isLiveAudienceFrameReadRequest,
  isLiveAudienceFrameReportRequest,
} from '../audience-api'

describe('live audience API contracts', () => {
  it('accepts only bounded Bilibili frame audience messages', () => {
    expect(isLiveAudienceFrameReadRequest({
      platform: 'bilibili',
      type: 'danmaku-echo.live-audience.frame-read',
    })).toBe(true)
    expect(isLiveAudienceFrameReportRequest({
      metric: {
        kind: 'viewers',
        label: '房间观众',
        platform: 'bilibili',
        rawText: '1万+',
        source: 'dom',
        value: 10_000,
      },
      platform: 'bilibili',
      type: 'danmaku-echo.live-audience.frame-report',
    })).toBe(true)
    expect(isLiveAudienceFrameReportRequest({
      metric: {
        kind: 'guests',
        platform: 'bilibili',
        rawText: '1万+',
        source: 'dom',
        value: 10_000,
      },
      platform: 'bilibili',
      type: 'danmaku-echo.live-audience.frame-report',
    })).toBe(false)
  })
})
