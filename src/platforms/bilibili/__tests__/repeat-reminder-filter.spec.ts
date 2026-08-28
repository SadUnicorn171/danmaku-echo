import { afterEach, describe, expect, it } from 'vitest'
import { bilibiliRepeatReminderExclusionReason } from '../repeat-reminder-filter'

afterEach(() => {
  document.body.replaceChildren()
})

describe('Bilibili repeat-reminder filtering', () => {
  it('filters a prominent lottery entry code from the video overlay', () => {
    document.body.innerHTML = `
      <div id="overlay">
        <div role="comment" class="bili-danmaku-x-dm" style="--fontSize: 24.3px">普通弹幕</div>
        <div role="comment" class="bili-danmaku-x-dm" style="--fontSize: 36px">哼哧殿静174520</div>
      </div>
    `
    const rows = document.querySelectorAll('.bili-danmaku-x-dm')
    expect(bilibiliRepeatReminderExclusionReason({
      element: rows[1],
      source: 'video',
      text: '哼哧殿静174520',
    })).toBe('lottery-entry')
  })

  it('keeps ordinary and non-prominent numeric danmaku', () => {
    document.body.innerHTML = `
      <div id="overlay">
        <div class="bili-danmaku-x-dm" style="--fontSize: 24.3px">另一条普通弹幕</div>
        <div class="bili-danmaku-x-dm" style="--fontSize: 24.3px">比赛时间174520</div>
      </div>
    `
    const rows = document.querySelectorAll('.bili-danmaku-x-dm')
    expect(bilibiliRepeatReminderExclusionReason({
      element: rows[1],
      source: 'video',
      text: '比赛时间174520',
    })).toBeNull()
    expect(bilibiliRepeatReminderExclusionReason({
      element: rows[0],
      source: 'video',
      text: '字幕能大点吗，看不太清',
    })).toBeNull()
  })

  it('recognizes explicit platform lottery markers without relying on copy', () => {
    document.body.innerHTML = `
      <div class="chat-item anchor-lottery-message" data-biz="anchor_lottery">
        <span>参与直播间活动</span>
      </div>
    `
    expect(bilibiliRepeatReminderExclusionReason({
      element: document.body.firstElementChild,
      source: 'chat',
      text: '参与直播间活动',
    })).toBe('lottery-entry')
  })
})
