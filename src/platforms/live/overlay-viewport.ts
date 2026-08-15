export interface RectBounds {
  bottom: number
  height: number
  left: number
  right: number
  top: number
  width: number
}

type RectLike = Pick<DOMRectReadOnly, 'bottom' | 'left' | 'right' | 'top'>

export function intersectRectBounds(rectangles: Iterable<RectLike>): RectBounds | null {
  let bottom = Number.POSITIVE_INFINITY
  let count = 0
  let left = Number.NEGATIVE_INFINITY
  let right = Number.POSITIVE_INFINITY
  let top = Number.NEGATIVE_INFINITY

  for (const rect of rectangles) {
    if (
      !Number.isFinite(rect.left) ||
      !Number.isFinite(rect.right) ||
      !Number.isFinite(rect.top) ||
      !Number.isFinite(rect.bottom) ||
      rect.right <= rect.left ||
      rect.bottom <= rect.top
    ) {
      continue
    }
    count += 1
    left = Math.max(left, rect.left)
    right = Math.min(right, rect.right)
    top = Math.max(top, rect.top)
    bottom = Math.min(bottom, rect.bottom)
  }

  if (!count || right <= left || bottom <= top) return null
  return {
    bottom,
    height: bottom - top,
    left,
    right,
    top,
    width: right - left,
  }
}

export function pointInsideRect(
  rect: RectLike | null,
  x: number,
  y: number,
  padding = 0,
): boolean {
  if (!rect) return false
  const margin = Number.isFinite(padding) ? padding : 0
  return (
    x >= rect.left - margin &&
    x <= rect.right + margin &&
    y >= rect.top - margin &&
    y <= rect.bottom + margin
  )
}

export function clipInsetsWithinRect(content: RectLike, viewport: RectLike) {
  return {
    bottom: Math.max(0, content.bottom - viewport.bottom),
    left: Math.max(0, viewport.left - content.left),
    right: Math.max(0, content.right - viewport.right),
    top: Math.max(0, viewport.top - content.top),
  }
}

export function clampBoxStart(
  preferred: number,
  size: number,
  viewportStart: number,
  viewportEnd: number,
  padding = 0,
): number {
  const minimum = viewportStart + padding
  const maximum = viewportEnd - padding - Math.max(0, size)
  if (maximum < minimum) return minimum
  return Math.max(minimum, Math.min(preferred, maximum))
}
