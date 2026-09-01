import { afterEach, describe, expect, it } from 'vitest'
import { douyinRepeatReminderExclusionReason } from '../repeat-reminder-filter'

afterEach(() => {
  document.body.replaceChildren()
})

describe('Douyin repeat-reminder filtering', () => {
  it('filters rendered gift notices by their strict platform text shape', () => {
    expect(
      douyinRepeatReminderExclusionReason({
        messageId: '7677896058697339955',
        text: '爱吃海胆的土鸡 送出点亮粉丝团 x 1',
      }),
    ).toBe('gift')
    expect(
      douyinRepeatReminderExclusionReason({ text: '用户：送出了 小心心 ×10' }),
    ).toBe('gift')
  })

  it('filters gift and lucky-bag business types even when their copy changes', () => {
    expect(
      douyinRepeatReminderExclusionReason({ record: { messageType: 'WebcastGiftMessage' } }),
    ).toBe('gift')
    expect(
      douyinRepeatReminderExclusionReason({ record: { extra: { biz_type: 'lucky_bag' } } }),
    ).toBe('synthetic-activity')
  })

  it('uses the platform synthetic id instead of hard-coding a lucky-bag phrase', () => {
    expect(
      douyinRepeatReminderExclusionReason({
        messageId: '__mocked__1787649616242',
        text: '点点关注铝厂ev63键盘',
      }),
    ).toBe('synthetic-activity')
    expect(
      douyinRepeatReminderExclusionReason({
        messageId: '7677896058697339999',
        text: '点点关注铝厂ev63键盘',
      }),
    ).toBeNull()
  })

  it('filters native lucky-bag instruction copy with a normal message id', () => {
    expect(
      douyinRepeatReminderExclusionReason({
        messageId: '7677935239113611018',
        text: '金牌讲师归来，左上角福袋抽钻石。',
      }),
    ).toBe('synthetic-activity')
    expect(
      douyinRepeatReminderExclusionReason({
        messageId: '7677935239113611019',
        text: '输入口令参与福袋',
      }),
    ).toBe('synthetic-activity')
  })

  it('recognizes nested lucky-bag record fields even without a type value', () => {
    expect(
      douyinRepeatReminderExclusionReason({
        record: { payload: { luckyBagInfo: { status: 1 } } },
        text: '金牌讲师归来',
      }),
    ).toBe('synthetic-activity')
  })

  it('keeps ordinary viewer discussion about a lucky bag', () => {
    expect(
      douyinRepeatReminderExclusionReason({ text: '主播今天还有福袋吗' }),
    ).toBeNull()
    expect(
      douyinRepeatReminderExclusionReason({ text: '我刚才抽到了钻石' }),
    ).toBeNull()
  })

  it('recognizes native row markers but keeps ordinary user chat', () => {
    document.body.innerHTML = `
      <div class="webcast-chatroom___gift-message___hash" data-message-type="gift">
        用户送出礼物
      </div>
    `
    expect(
      douyinRepeatReminderExclusionReason({ element: document.body.firstElementChild }),
    ).toBe('gift')
    expect(
      douyinRepeatReminderExclusionReason({
        messageId: '123456',
        text: '我送出了一份测试代码',
      }),
    ).toBeNull()
  })
})
