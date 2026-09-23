import { expect, it } from 'vitest'
import { ExpirationQueue } from '../expiration-queue'

it('renews deadlines without accumulating entries and preserves inclusive expiry', () => {
  const queue = new ExpirationQueue<string>()
  queue.set('a', 10); queue.set('b', 5); queue.set('c', 15)
  for (let index = 0; index < 1_000; index++) queue.set('b', 20 + index)
  expect(queue.size).toBe(3)
  queue.set('c', 1)
  expect(queue.popBefore(1)).toBeUndefined()
  expect(queue.popBefore(2)).toBe('c')
  queue.delete('a'); queue.delete('a')
  expect(queue.popBefore(2_000)).toBe('b')
  expect(queue.popBefore(2_000)).toBeUndefined()
  queue.set('d', 1); queue.clear()
  expect(queue.size).toBe(0)
})

it('matches a sorted deadline model after out-of-order inserts, renewals and removals', () => {
  const queue = new ExpirationQueue<number>()
  const model = new Map<number, number>()
  let state = 1234
  const random = (limit: number) => { state = (Math.imul(state, 1664525) + 1013904223) >>> 0; return state % limit }
  for (let step = 0; step < 3_000; step++) {
    const key = random(100)
    if (random(3) === 0) { queue.delete(key); model.delete(key) }
    else { const deadline = random(1000); queue.set(key, deadline); model.set(key, deadline) }
    const now = random(500)
    let expired: number | undefined
    while ((expired = queue.popBefore(now)) !== undefined) {
      expect(model.get(expired)).toBe(Math.min(...model.values()))
      expect(model.get(expired)!).toBeLessThan(now)
      model.delete(expired)
    }
    expect([...model.values()].every((at) => at >= now)).toBe(true)
    expect(queue.size).toBe(model.size)
  }
})
