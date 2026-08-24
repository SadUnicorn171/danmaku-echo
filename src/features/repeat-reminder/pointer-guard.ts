export const REPEAT_REMINDER_OWNED_SELECTOR = '[data-bcp-repeat-reminder-owned]'
export const REPEAT_REMINDER_HIT_REGIONS_ATTRIBUTE = 'data-bcp-repeat-reminder-hit-regions'

interface RepeatReminderPointDocument {
  elementsFromPoint(x: number, y: number): Element[]
  querySelectorAll?(selectors: string): Iterable<Element> | ArrayLike<Element>
}

function isReminderElement(value: unknown): boolean {
  return value instanceof Element && Boolean(value.closest(REPEAT_REMINDER_OWNED_SELECTOR))
}

export function eventTouchesRepeatReminder(event: Event): boolean {
  const path = typeof event.composedPath === 'function' ? event.composedPath() : [event.target]
  return path.some(isReminderElement)
}

export function pointTouchesRepeatReminder(
  documentValue: RepeatReminderPointDocument,
  x: number,
  y: number,
): boolean {
  if (!Number.isFinite(x) || !Number.isFinite(y)) return false
  if (documentValue.elementsFromPoint(x, y).some(isReminderElement)) return true
  if (typeof documentValue.querySelectorAll !== 'function') return false
  const portals = Array.from(documentValue.querySelectorAll(REPEAT_REMINDER_OWNED_SELECTOR))
  return portals.some((portal) => {
    const serialized = portal.getAttribute(REPEAT_REMINDER_HIT_REGIONS_ATTRIBUTE)
    if (!serialized) return false
    try {
      const regions = JSON.parse(serialized) as unknown
      if (!Array.isArray(regions)) return false
      return regions.some((region) => {
        if (!Array.isArray(region) || region.length !== 4) return false
        const [left, top, right, bottom] = region.map(Number)
        return (
          [left, top, right, bottom].every(Number.isFinite)
          && x >= left
          && x <= right
          && y >= top
          && y <= bottom
        )
      })
    } catch {
      return false
    }
  })
}
