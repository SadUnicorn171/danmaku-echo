import type {
  DanmakuDescriptor,
  ExtensionSettings,
  LivePlatformAdapter,
  PlatformId,
} from '../../core/types'
import type { LivePlatformConfig } from './config'
import { describeDanmaku, type LiveMessageElementsResolver } from './descriptor'
import {
  stableCandidateOrder,
  type LiveCandidateAdapter,
  type LiveCandidateDescriptor,
} from './candidate-adapter'

function closest(path: EventTarget[], selectors: readonly string[]): Element | null {
  for (const target of path) {
    if (!(target instanceof Element)) continue
    for (const selector of selectors) {
      try {
        const match = target.closest(selector)
        if (match) return match
      } catch {
        // Ignore selectors unsupported by the current browser.
      }
    }
  }
  return null
}

function visible(element: Element): boolean {
  const style = getComputedStyle(element)
  return element.isConnected && style.display !== 'none' && style.visibility !== 'hidden'
}

export function createSelectorPlatformAdapter(options: {
  config: LivePlatformConfig
  messageElements?: LiveMessageElementsResolver
  nativeCapsuleVisible?: (settings: ExtensionSettings) => boolean
  platform: PlatformId
}): LivePlatformAdapter & { candidates: LiveCandidateAdapter; config: LivePlatformConfig } {
  const { config, platform } = options
  const candidateAdapter: LiveCandidateAdapter = {
    capabilities: {
      chat: true,
      nativeCapsule: platform === 'douyu',
      normalize: true,
      overlay: true,
    },
    describe(candidate) {
      return describeDanmaku(
        platform,
        config,
        candidate.element,
        candidate.source,
        options.messageElements,
      )
    },
    findFromPath(path) {
      const overlay = closest([...path], config.overlayMessages)
      if (overlay) {
        return {
          element: overlay,
          kind: 'overlay',
          order: stableCandidateOrder(overlay),
          source: 'video',
        }
      }
      const chat = closest([...path], config.messages)
      return chat
        ? {
            element: chat,
            kind: 'chat',
            order: stableCandidateOrder(chat),
            source: 'chat',
          }
        : null
    },
    normalize(candidate: LiveCandidateDescriptor) {
      return candidate.element.isConnected ? candidate : null
    },
  }
  return {
    candidates: candidateAdapter,
    cleanup() {},
    config,
    describe(candidate, source) {
      return describeDanmaku(platform, config, candidate, source, options.messageElements)
    },
    findCandidate(path) {
      const video = closest(path, config.overlayMessages)
      if (video) return { element: video, source: 'video' }
      const chat = closest(path, config.messages)
      return chat ? { element: chat, source: 'chat' } : null
    },
    findOfficialEditor() {
      for (const selector of config.inputs) {
        try {
          const editor = document.querySelector(selector)
          if (editor && visible(editor)) return editor
        } catch {
          // Ignore selectors unsupported by the current browser.
        }
      }
      return null
    },
    nativeCapsuleVisible(settings) {
      return options.nativeCapsuleVisible?.(settings) ?? true
    },
    resolveSender(descriptor: DanmakuDescriptor) {
      return { id: descriptor.senderId, name: descriptor.senderName }
    },
  }
}
