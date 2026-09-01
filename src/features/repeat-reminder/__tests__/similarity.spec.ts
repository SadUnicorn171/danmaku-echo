import { describe, expect, it } from 'vitest'
import {
  areRepeatReminderTextsSimilar,
  canonicalRepeatReminderText,
  repeatReminderSimilarity,
} from '../similarity'

describe('repeat reminder similarity', () => {
  it('collapses complete repeated units into one stable key', () => {
    expect(canonicalRepeatReminderText('你老公你老公你老公')).toBe('你老公')
    expect(areRepeatReminderTextsSimilar('你老公你老公你老公', '你老公')).toBe(true)
  })

  it('normalizes full-width and ASCII punctuation runs', () => {
    expect(canonicalRepeatReminderText('？？？？？？')).toBe('?')
    expect(canonicalRepeatReminderText('??????')).toBe('?')
    expect(areRepeatReminderTextsSimilar('？？？？？？', '??????')).toBe(true)
  })

  it('recognizes a high-confidence short textual variant', () => {
    expect(repeatReminderSimilarity('主播太强了', '主播太强啦')).toBeGreaterThanOrEqual(0.74)
    expect(areRepeatReminderTextsSimilar('主播太强了', '主播太强啦')).toBe(true)
  })

  it('protects numbers, negation, URLs, Latin entities, and Emoji', () => {
    expect(areRepeatReminderTextsSimilar('比分 2:1', '比分 2:0')).toBe(false)
    expect(areRepeatReminderTextsSimilar('赢了', '没赢')).toBe(false)
    expect(areRepeatReminderTextsSimilar('看 https://a.example', '看 https://b.example')).toBe(false)
    expect(areRepeatReminderTextsSimilar('A队赢了', 'B队赢了')).toBe(false)
    expect(areRepeatReminderTextsSimilar('太强了😀', '太强了😡')).toBe(false)
  })
})
