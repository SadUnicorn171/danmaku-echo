export const REPEAT_REMINDER_OWNED_SELECTOR = '[data-bcp-repeat-reminder-owned]'
export const REPEAT_REMINDER_HIT_REGIONS_ATTRIBUTE = 'data-bcp-repeat-reminder-hit-regions'

interface RepeatReminderPointDocument {
  elementsFromPoint(x: number, y: number): Element[]
  querySelectorAll?(selectors: string): Iterable<Element> | ArrayLike<Element>
}

interface HitRegionCacheEntry {
  regions: number[][]
  serialized: string
}

const hitRegionCache = new WeakMap<Element, HitRegionCacheEntry>()

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
  if (typeof documentValue.querySelectorAll === 'function') {
    const portals = Array.from(documentValue.querySelectorAll(REPEAT_REMINDER_OWNED_SELECTOR))
    let hasPublishedRegions = false
    for (const portal of portals) {
      const serialized = portal.getAttribute(REPEAT_REMINDER_HIT_REGIONS_ATTRIBUTE)
      if (!serialized) continue
      hasPublishedRegions = true
      let cached = hitRegionCache.get(portal)
      if (!cached || cached.serialized !== serialized) {
        let regions: number[][] = []
        try {
          const parsed = JSON.parse(serialized) as unknown
          if (Array.isArray(parsed)) {
            regions = parsed.filter(
              (region): region is number[] => Array.isArray(region)
                && region.length === 4
                && region.map(Number).every(Number.isFinite),
            ).map((region) => region.map(Number))
          }
        } catch {
          regions = []
        }
        cached = { regions, serialized }
        hitRegionCache.set(portal, cached)
      }
      if (cached.regions.some(([left, top, right, bottom]) => (
        x >= left && x <= right && y >= top && y <= bottom
      ))) return true
    }
    // Published rectangles are authoritative and avoid a forced hit-test on
    // every high-frequency pointer event.
    if (hasPublishedRegions) return false
  }
  return documentValue.elementsFromPoint(x, y).some(isReminderElement)
}
