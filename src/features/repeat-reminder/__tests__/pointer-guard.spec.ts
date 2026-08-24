import { describe, expect, it, vi } from 'vitest'
import { eventTouchesRepeatReminder, pointTouchesRepeatReminder } from '../pointer-guard'

describe('repeat reminder pointer guard', () => {
  it('recognizes the Shadow DOM portal in an event path', () => {
    const portal = document.createElement('div')
    portal.dataset.bcpRepeatReminderOwned = 'true'
    const event = new Event('pointermove')
    event.composedPath = vi.fn<() => EventTarget[]>(() => [portal, document])
    expect(eventTouchesRepeatReminder(event)).toBe(true)
  })

  it('blocks a covered barrage below the prompt', () => {
    const portal = document.createElement('div')
    portal.dataset.bcpRepeatReminderOwned = 'true'
    const elementsFromPoint = vi.fn<(x: number, y: number) => Element[]>(() => [portal])
    expect(pointTouchesRepeatReminder({ elementsFromPoint }, 120, 80)).toBe(true)
  })

  it('uses published prompt rectangles when a higher Douyin layer wins hit testing', () => {
    const portal = document.createElement('div')
    portal.dataset.bcpRepeatReminderOwned = 'true'
    portal.dataset.bcpRepeatReminderHitRegions = JSON.stringify([[100, 60, 260, 130]])
    const elementsFromPoint = vi.fn<(x: number, y: number) => Element[]>(() => [])
    const querySelectorAll = vi.fn<(selectors: string) => Element[]>(() => [portal])
    expect(pointTouchesRepeatReminder({ elementsFromPoint, querySelectorAll }, 180, 90)).toBe(true)
    expect(pointTouchesRepeatReminder({ elementsFromPoint, querySelectorAll }, 280, 90)).toBe(false)
  })
})
