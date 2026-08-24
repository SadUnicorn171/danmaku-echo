export const REPEAT_REMINDER_ONBOARDING_KEY = 'danmakuEchoRepeatReminderOnboardingV1'

function onboardingStorage(): chrome.storage.StorageArea | null {
  try {
    return globalThis.chrome?.storage?.local || null
  } catch {
    return null
  }
}

export async function hasAcknowledgedRepeatReminderOnboarding(): Promise<boolean> {
  const storage = onboardingStorage()
  if (!storage) return false
  try {
    const value = await storage.get(REPEAT_REMINDER_ONBOARDING_KEY)
    return value[REPEAT_REMINDER_ONBOARDING_KEY] === true
  } catch {
    return false
  }
}

export async function acknowledgeRepeatReminderOnboarding(): Promise<void> {
  const storage = onboardingStorage()
  if (!storage) return
  try {
    await storage.set({ [REPEAT_REMINDER_ONBOARDING_KEY]: true })
  } catch {
    // Keep the current page usable even if extension storage is temporarily unavailable.
  }
}
