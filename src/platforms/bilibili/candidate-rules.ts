import { normalizeWhitespace } from '../../core/shared'
import type { LivePlatformConfig } from '../live/config'
import { closestMatching, composedParentElement, matchesAny } from '../live/deep-dom'
import { elementMarker } from '../live/element-text'
import { EDITABLE_CONTROL_SELECTOR } from '../live/editor-config'
import {
  BILIBILI_CHAT_ACTION_SURFACES,
  BILIBILI_CHAT_ACTION_TEXT,
  BILIBILI_CHAT_AD_LABEL_SELECTORS,
  BILIBILI_CHAT_AD_SELECTORS,
  BILIBILI_CHAT_STRONG_ACTION_TEXT,
  BILIBILI_QUICK_BAR_SELECTORS,
  isBilibiliAdvertisementLabel,
  isBilibiliAdvertisementMarker,
} from './dom-config'

export interface BilibiliCandidateRules {
  isChatAdvertisement(element: unknown): boolean
  isInsidePlayerOutsideChat(element: unknown): boolean
  isInsideVideoOverlay(element: unknown): boolean
  isQuickInputRegion(element: unknown): boolean
  isRenderedOverlay(element: unknown): boolean
  isSideChatEditor(element: unknown): boolean
  pathTouchesChatActions(path: readonly EventTarget[]): boolean
  pathTouchesChatAdvertisement(path: readonly EventTarget[]): boolean
  pathTouchesQuickInput(path: readonly EventTarget[]): boolean
}

export function createBilibiliCandidateRules(options: {
  config: LivePlatformConfig
  viewportWidth?: () => number
}): BilibiliCandidateRules {
  const { config } = options
  const viewportWidth = options.viewportWidth ?? (() => innerWidth)

  const isSideChatEditor = (element: unknown): boolean =>
    element instanceof Element &&
    Boolean(
      element.matches(
        "textarea.chat-input,.chat-input-ctnr textarea,.chat-input-ctnr input,.chat-input[contenteditable]:not([contenteditable='false'])",
      ) || element.closest('.chat-input-ctnr'),
    )

  const isQuickInputRegion = (element: unknown): boolean => {
    if (!(element instanceof Element) || isSideChatEditor(element)) return false
    if (closestMatching(element, BILIBILI_QUICK_BAR_SELECTORS)) return true
    if (!closestMatching(element, config.videoRoots)) return false
    if (element.matches(EDITABLE_CONTROL_SELECTOR)) return true
    const nestedEditor = element.querySelector(EDITABLE_CONTROL_SELECTOR)
    if (nestedEditor && !matchesAny(element, config.videoRoots)) {
      const rect = element.getBoundingClientRect()
      if (
        rect.height > 0 &&
        rect.height <= 160 &&
        rect.width <= Math.max(900, viewportWidth() * 0.95)
      ) {
        return true
      }
    }
    return /(?:danmaku|danmu|dm)[-_ ]?(?:input|send)|(?:input|send)[-_ ]?(?:danmaku|danmu|dm)|快捷(?:输入|发送)|发送弹幕/iu.test(
      elementMarker(element),
    )
  }

  const isChatAdvertisement = (element: unknown): boolean => {
    if (!(element instanceof Element)) return false
    const chatRoot = closestMatching(element, config.chatRoots)
    if (!chatRoot) return false
    const card = closestMatching(element, config.messages) || element
    if (card === chatRoot) return false
    let current: Element | null = card
    while (current && current !== chatRoot) {
      if (matchesAny(current, BILIBILI_CHAT_AD_SELECTORS)) return true
      const metadata = [
        elementMarker(current),
        current.getAttribute('data-type'),
        current.getAttribute('data-module'),
        current.getAttribute('data-report'),
        current.getAttribute('data-testid'),
        current.getAttribute('data-e2e'),
      ]
        .filter(Boolean)
        .join(' ')
      if (isBilibiliAdvertisementMarker(metadata)) return true
      current = current.parentElement
    }
    let labels: Element[] = []
    try {
      labels = Array.from(card.querySelectorAll(BILIBILI_CHAT_AD_LABEL_SELECTORS.join(',')))
    } catch {
      // Invalid selectors are treated as no label.
    }
    const hasAdvertisementLabel = labels.some((label) =>
      isBilibiliAdvertisementLabel(normalizeWhitespace(label.textContent)),
    )
    return (
      hasAdvertisementLabel &&
      Boolean(
        card.querySelector(
          "a[href], button, [role='button'], [data-url], [data-href], [class*='banner' i], [class*='card' i]",
        ),
      )
    )
  }

  return {
    isChatAdvertisement,
    isQuickInputRegion,
    isSideChatEditor,
    isRenderedOverlay(element) {
      if (!(element instanceof Element) || !element.isConnected || isQuickInputRegion(element)) {
        return false
      }
      if (!element.getClientRects().length) return false
      // Measurement/recycled rows keep their text and dimensions while hidden.
      // Check the painted content and its ancestors, not only the row's box.
      let current: Element | null = element.querySelector('.bili-danmaku-x-dm-content') || element
      while (current) {
        const style = getComputedStyle(current)
        if (
          style.display === 'none' ||
          style.visibility === 'hidden' ||
          style.visibility === 'collapse' ||
          style.contentVisibility === 'hidden' ||
          Number(style.opacity || 1) <= 0
        ) {
          return false
        }
        current = composedParentElement(current)
      }
      return true
    },
    isInsidePlayerOutsideChat(element) {
      if (!(element instanceof Element)) return false
      if (closestMatching(element, config.overlayMessages)) return true
      return Boolean(
        closestMatching(element, config.videoRoots) && !closestMatching(element, config.chatRoots),
      )
    },
    isInsideVideoOverlay(element) {
      return element instanceof Element && Boolean(closestMatching(element, config.overlayMessages))
    },
    pathTouchesChatActions(path) {
      for (const item of path) {
        if (!(item instanceof Element)) continue
        if (closestMatching(item, config.userNames)) return true
        const surface = closestMatching(item, BILIBILI_CHAT_ACTION_SURFACES)
        if (surface) {
          const role = surface.getAttribute('role') || ''
          const text = normalizeWhitespace(surface.textContent).slice(0, 500)
          if (/^(?:dialog|menu|listbox)$/iu.test(role) || BILIBILI_CHAT_ACTION_TEXT.test(text)) {
            return true
          }
        }
        const control = closestMatching(item, [
          'button',
          'a',
          "[role='button']",
          "[role='menuitem']",
        ])
        if (control && BILIBILI_CHAT_ACTION_TEXT.test(normalizeWhitespace(control.textContent))) {
          return true
        }
        if (
          BILIBILI_CHAT_STRONG_ACTION_TEXT.test(normalizeWhitespace(item.textContent).slice(0, 500))
        ) {
          const position = getComputedStyle(item).position
          if (position === 'fixed' || position === 'absolute') return true
        }
      }
      return false
    },
    pathTouchesChatAdvertisement(path) {
      return path.some((item) => isChatAdvertisement(item))
    },
    pathTouchesQuickInput(path) {
      return path.some((item) => isQuickInputRegion(item))
    },
  }
}
