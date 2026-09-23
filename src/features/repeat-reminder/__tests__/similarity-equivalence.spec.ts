import { expect, it } from 'vitest'
import * as reference from '../../../../tests/fixtures/performance/similarity'
import { areRepeatReminderTextsSimilar, repeatReminderSimilarity } from '../similarity'

it('preserves scores and qualification including protected entities and long-text thresholds', () => {
  const texts = [
    '', ' ', '你好', '你好你好', '你 好', '这波太帅了', '这波太帅啦', '不是这样的', '是这样的',
    '👍', '👍👍', '👍🏽', '123', '124', 'v1.2', 'v1.3', 'example https://a.test', 'example https://b.test',
    '？？？？', '???', 'ABC', 'abc', 'ＦＯＯ', 'Foo', '主播今天好强啊', '主播今天好强呀',
    '你好'.repeat(100), '今天真的很精彩'.repeat(40), '今天真的很精彩'.repeat(40) + '😀',
  ]
  for (const first of texts) for (const second of texts) {
    expect(repeatReminderSimilarity(first, second), `${first} / ${second}`).toBe(reference.repeatReminderSimilarity(first, second))
    expect(areRepeatReminderTextsSimilar(first, second)).toBe(reference.areRepeatReminderTextsSimilar(first, second))
  }
})
