const DOUYU_OVERLAY_MESSAGE_SELECTOR = [
  "[class*='danmuItem-']",
  "[data-comment-uuid][class*='danmu']",
  "[class*='danmu-item' i]",
  "[class*='danmuItem']",
].join(',')

const DOUYU_OVERLAY_TEXT_SELECTOR = "[class*='text-'],[class*='danmuText-']"
const DOUYU_NON_MESSAGE_SELECTOR = [
  'button',
  "[role='button']",
  '[data-bcp-one-owned]',
  "[class*='interactive-element-']",
  "[class*='reply-button-']",
  "[class*='action-button-']",
].join(',')

function closestOverlayMessage(element: Element): Element | null {
  try {
    return element.matches(DOUYU_OVERLAY_MESSAGE_SELECTOR)
      ? element
      : element.closest(DOUYU_OVERLAY_MESSAGE_SELECTOR)
  } catch {
    return null
  }
}

/**
 * Douyu can render one logical overlay danmaku as multiple sibling text nodes.
 * Return every top-level message segment in DOM order while keeping toolbar and
 * nested overlay contents outside the message boundary.
 */
export function douyuOverlayTextElements(candidate: Element): Element[] {
  const boundary = closestOverlayMessage(candidate)
  if (!boundary) return []
  const matches = Array.from(boundary.querySelectorAll(DOUYU_OVERLAY_TEXT_SELECTOR))
    .filter((element) => closestOverlayMessage(element) === boundary)
    .filter((element) => !element.closest(DOUYU_NON_MESSAGE_SELECTOR))

  return matches.filter(
    (element) => !matches.some((other) => other !== element && other.contains(element)),
  )
}
