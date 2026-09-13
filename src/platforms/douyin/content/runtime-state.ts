import type { ExtensionSettings } from '../../../core/types'
import type { FavoritesRuntime } from '../../../features/favorites/launcher'
import type { RepeatReminderRuntime } from '../../../features/repeat-reminder/runtime'
import type { DouyinEmojiCatalogEntry } from '../emoji-catalog'
import { createSendProtection, type SendProtection } from '../../live/send-protection'
import type {
  DouyinCandidateRect,
  DouyinDomCandidateKind,
  DouyinSelectionPhase,
} from './dom-hover-controller'

export interface DouyinReplyRequest {
  at: number
  status: 'failed' | 'pending' | 'ready'
}

export interface DouyinContentDebugCounters {
  cardPointerEnters: number
  cardsHidden: number
  cardsShown: number
  emojiAssetsInserted: number
  ownChatIntents: number
  ownChatMessagesMarked: number
  pings: number
  protocolMessagesRejected: number
  rendererActivations: number
  rendererActivationsRejected: number
  sendsAttempted: number
  sendsFailed: number
  sendsSucceeded: number
}

export interface DouyinContentDebugEvent {
  at: number
  details: unknown
  sinceLoad: number
  type: string
}

export interface DouyinContentDebugLastCard {
  at: number
  kind: DouyinDomCandidateKind
  message: string
  pointer: [number | undefined, number | undefined]
  rect: DouyinCandidateRect
  selectionId: number
  selectionPhase: DouyinSelectionPhase
  trackId: string
}

export interface DouyinContentDebugState {
  counters: DouyinContentDebugCounters
  events: DouyinContentDebugEvent[]
  href: string
  lastCard: DouyinContentDebugLastCard | null
  lastError: string
  loadedAt: string
  loadedAtMs: number
  pageReady: boolean
  pageVersion: string
  settingsEnabled: boolean
  version: string
}

/**
 * Mutable state owned by the isolated-world Douyin runtime.
 *
 * Creation: `createDouyinContentRuntimeState` owns base values and services.
 * Updates: later DOM/protocol/action controllers receive narrow references.
 * Destruction: the lifecycle controller clears every timer, observer, request
 * set, cache, selection and feature runtime represented here.
 */
export interface DouyinContentRuntimeState {
  /** Action request ownership outside the semantic dispatcher. */
  replyRequests: Map<string, DouyinReplyRequest>

  /** Page protocol state; refreshed by the protocol/lifecycle controller. */
  pageReady: boolean
  pageSnapshot: Record<string, unknown> | null
  pageVersion: string

  /** Native Emoji catalog request state; the catalog loader creates and settles it. */
  douyinEmojiCatalog: DouyinEmojiCatalogEntry[]
  douyinEmojiCatalogRequest: Promise<number> | null

  /** Feature services; their own lifecycle controllers create and destroy them. */
  favoritesRuntime: FavoritesRuntime | null
  repeatReminderRuntime: RepeatReminderRuntime | null
  sendProtection: SendProtection
  settings: ExtensionSettings

  /** Send UI scheduled work remains owned by the send controller integration. */
  cooldownTimer: ReturnType<typeof setInterval> | 0
}

export function createDouyinContentRuntimeState(
  settings: ExtensionSettings,
): DouyinContentRuntimeState {
  return {
    cooldownTimer: 0,
    douyinEmojiCatalog: [],
    douyinEmojiCatalogRequest: null,
    favoritesRuntime: null,
    pageReady: false,
    pageSnapshot: null,
    pageVersion: '',
    repeatReminderRuntime: null,
    replyRequests: new Map(),
    sendProtection: createSendProtection(),
    settings,
  }
}
