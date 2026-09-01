import { describe, expect, it } from 'vitest'
import { RepeatReminderSelection } from '../selection'
import type { RepeatReminderSuggestion } from '../types'

function suggestion(id: string, text: string): RepeatReminderSuggestion {
  return { count: 8, id, senders: 8, text, threshold: 8, windowMs: 60_000 }
}

describe('repeat reminder selection', () => {
  it('keeps the newest suggestions first and permanently retires queue overflow', () => {
    const selection = new RepeatReminderSelection(3)
    const first = suggestion('first', '第一条')
    const second = suggestion('second', '第二条')
    const third = suggestion('third', '第三条')
    const fourth = suggestion('fourth', '第四条')

    selection.replace(first)
    selection.replace(second)
    selection.replace(third)
    expect(selection.current().map((item) => item.id)).toEqual(['third', 'second', 'first'])

    selection.replace(fourth)
    expect(selection.current().map((item) => item.id)).toEqual(['fourth', 'third', 'second'])
    expect(selection.replace({ ...first, count: 40 })).toBeNull()
    expect(selection.current().map((item) => item.id)).toEqual(['fourth', 'third', 'second'])
  })

  it('retires overflow when the limit shrinks and allows it again only after reset', () => {
    const selection = new RepeatReminderSelection(3)
    const first = suggestion('first', '第一条')
    selection.replace(first)
    selection.replace(suggestion('second', '第二条'))
    selection.replace(suggestion('third', '第三条'))
    selection.setLimit(1)

    expect(selection.current().map((item) => item.id)).toEqual(['third'])
    expect(selection.replace(first)).toBeNull()
    selection.reset()
    expect(selection.replace(first)).toBe(first)
  })

  it('updates a similarity cluster in place without changing its queue order', () => {
    const selection = new RepeatReminderSelection(3)
    selection.replace(suggestion('cluster-a', '较早代表'))
    selection.replace(suggestion('cluster-b', '更新的其他弹幕'))
    selection.replace({ ...suggestion('cluster-a', '新的高频代表'), count: 12 })
    expect(selection.current().map((item) => `${item.id}:${item.text}`)).toEqual([
      'cluster-b:更新的其他弹幕',
      'cluster-a:新的高频代表',
    ])
  })
})
