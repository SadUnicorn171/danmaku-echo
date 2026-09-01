import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  acknowledgeRepeatReminderOnboarding,
  hasAcknowledgedRepeatReminderOnboarding,
  REPEAT_REMINDER_ONBOARDING_KEY,
} from '../onboarding'

afterEach(() => vi.unstubAllGlobals())

describe('repeat reminder onboarding storage', () => {
  it('persists acknowledgement in extension-local storage', async () => {
    const values: Record<string, unknown> = {}
    const get = vi.fn<(key: string) => Promise<Record<string, unknown>>>(async (key) => ({
      [key]: values[key],
    }))
    const set = vi.fn<(items: Record<string, unknown>) => Promise<void>>(async (items) => {
      Object.assign(values, items)
    })
    vi.stubGlobal('chrome', { storage: { local: { get, set } } })

    expect(await hasAcknowledgedRepeatReminderOnboarding()).toBe(false)
    await acknowledgeRepeatReminderOnboarding()
    expect(set).toHaveBeenCalledWith({ [REPEAT_REMINDER_ONBOARDING_KEY]: true })
    expect(await hasAcknowledgedRepeatReminderOnboarding()).toBe(true)
  })
})
