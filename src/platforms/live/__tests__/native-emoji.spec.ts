import { describe, expect, it } from 'vitest'
import { uniqueHighestScoringItem } from '../native-emoji'

describe('uniqueHighestScoringItem', () => {
  it('deduplicates an image and wrapper that resolve to the same native item', () => {
    const item = { id: 'happy' }
    const candidates = [
      { item, score: 8 },
      { item, score: 12 },
      { item: { id: 'sad' }, score: 4 },
    ]

    expect(
      uniqueHighestScoringItem(
        candidates,
        (candidate) => candidate.item,
        (candidate) => candidate.score,
      ),
    ).toBe(item)
  })

  it('rejects ambiguous native resources with the same strongest name match', () => {
    const first = { id: 'happy-room' }
    const second = { id: 'happy-global' }
    const candidates = [
      { item: first, score: 8 },
      { item: second, score: 8 },
    ]

    expect(
      uniqueHighestScoringItem(
        candidates,
        (candidate) => candidate.item,
        (candidate) => candidate.score,
      ),
    ).toBeNull()
  })

  it('ignores candidates below the required resource-match score', () => {
    expect(
      uniqueHighestScoringItem(
        [{ item: { id: 'weak' }, score: 3 }],
        (candidate) => candidate.item,
        (candidate) => candidate.score,
      ),
    ).toBeNull()
  })
})
