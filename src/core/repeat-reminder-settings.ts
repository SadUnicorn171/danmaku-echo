export const DEFAULT_REPEAT_REMINDER_THRESHOLD = 5
export const MIN_REPEAT_REMINDER_THRESHOLD = 2
export const MAX_REPEAT_REMINDER_THRESHOLD = 99

export const DEFAULT_REPEAT_REMINDER_PROMPT_SECONDS = 6
export const MIN_REPEAT_REMINDER_PROMPT_SECONDS = 1
export const MAX_REPEAT_REMINDER_PROMPT_SECONDS = 60

export const DEFAULT_REPEAT_REMINDER_QUEUE_LIMIT = 3
export const MIN_REPEAT_REMINDER_QUEUE_LIMIT = 1
export const MAX_REPEAT_REMINDER_QUEUE_LIMIT = 10

export const DEFAULT_REPEAT_REMINDER_PROMPT_SCALE_PERCENT = 100
export const MIN_REPEAT_REMINDER_PROMPT_SCALE_PERCENT = 50
export const MAX_REPEAT_REMINDER_PROMPT_SCALE_PERCENT = 200

export const DEFAULT_CAPSULE_SCALE_PERCENT = 100
export const MIN_CAPSULE_SCALE_PERCENT = 50
export const MAX_CAPSULE_SCALE_PERCENT = 200

function boundedInteger(value: unknown, fallback: number, minimum: number, maximum: number): number {
  const number = Number(value)
  if (!Number.isFinite(number)) return fallback
  return Math.min(maximum, Math.max(minimum, Math.round(number)))
}

export function normalizeRepeatReminderThreshold(value: unknown): number {
  return boundedInteger(
    value,
    DEFAULT_REPEAT_REMINDER_THRESHOLD,
    MIN_REPEAT_REMINDER_THRESHOLD,
    MAX_REPEAT_REMINDER_THRESHOLD,
  )
}

export function normalizeRepeatReminderPromptSeconds(value: unknown): number {
  return boundedInteger(
    value,
    DEFAULT_REPEAT_REMINDER_PROMPT_SECONDS,
    MIN_REPEAT_REMINDER_PROMPT_SECONDS,
    MAX_REPEAT_REMINDER_PROMPT_SECONDS,
  )
}

export function normalizeRepeatReminderQueueLimit(value: unknown): number {
  return boundedInteger(
    value,
    DEFAULT_REPEAT_REMINDER_QUEUE_LIMIT,
    MIN_REPEAT_REMINDER_QUEUE_LIMIT,
    MAX_REPEAT_REMINDER_QUEUE_LIMIT,
  )
}

export function normalizeRepeatReminderPromptScalePercent(value: unknown): number {
  return boundedInteger(
    value,
    DEFAULT_REPEAT_REMINDER_PROMPT_SCALE_PERCENT,
    MIN_REPEAT_REMINDER_PROMPT_SCALE_PERCENT,
    MAX_REPEAT_REMINDER_PROMPT_SCALE_PERCENT,
  )
}

export function normalizeCapsuleScalePercent(value: unknown): number {
  return boundedInteger(
    value,
    DEFAULT_CAPSULE_SCALE_PERCENT,
    MIN_CAPSULE_SCALE_PERCENT,
    MAX_CAPSULE_SCALE_PERCENT,
  )
}

export function legacySensitivityThreshold(value: unknown): number {
  if (value === 'high') return 3
  if (value === 'low') return 8
  return DEFAULT_REPEAT_REMINDER_THRESHOLD
}
