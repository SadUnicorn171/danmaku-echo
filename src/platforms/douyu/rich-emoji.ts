export function douyuEmojiToken(
  element: Element,
  normalizeToken: (value: unknown, marker: string) => string,
  markerFor: (element: Element) => string,
): string {
  const image = element instanceof HTMLImageElement ? element : element.querySelector('img')
  if (
    image instanceof HTMLImageElement &&
    /(?:^|\s)EmotImage(?:Pe3?)?(?:-|\s|$)/i.test(markerFor(image))
  ) {
    const token = normalizeToken(image.getAttribute('rel'), 'douyu emoji')
    if (token) return token
  }

  const item = element.matches('.EmotionList-item') ? element : element.closest('.EmotionList-item')
  const title = item?.querySelector('.EmotionList-item-title')
  return title ? normalizeToken(title.textContent, markerFor(title)) : ''
}
