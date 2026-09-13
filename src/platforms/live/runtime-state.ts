import type { ExtensionSettings } from '../../core/types'
import type { FavoritesRuntime } from '../../features/favorites/launcher'
import type { RepeatReminderRuntime } from '../../features/repeat-reminder/runtime'
import type { SenderIndex } from './sender-index'
import type { SendCoordinator } from './send-coordinator'
import type { RectBounds } from './overlay-viewport'
import type { RichMessagePayload } from './rich-message'

export type LiveCandidateKind = 'chat' | 'native-capsule' | 'overlay'

export interface LiveSelection {
  candidate: Element
  kind: LiveCandidateKind
  message: string
  richPayload: RichMessagePayload | null
  selectedAt: number
  sender: string
}

export interface PausedAnimationSnapshot {
  animation: Animation
  shouldResume: boolean
}

export interface InlineStyleSnapshot {
  priority: string
  value: string
}

export interface HiddenQuickBarSnapshot {
  hiddenAt: number
  styles: Record<string, InlineStyleSnapshot>
}

export interface LiveContentRuntimeState {
  /** Vue overlay and its queried element handles; owned by the runtime lifecycle. */
  bilibiliDismissToken: number
  bilibiliOverlayCandidates: Element[]
  bilibiliOverlayCandidatesCachedAt: number
  candidate: Element | null
  candidateKind: LiveCandidateKind | null
  cooldownTimer: ReturnType<typeof setInterval> | 0
  douyuNativeCapsuleMutationRoots: Set<Node>
  frozenClone: HTMLElement | null
  favoritesRuntime: FavoritesRuntime | null
  hiddenBilibiliQuickBars: Map<HTMLElement, HiddenQuickBarSnapshot>
  message: string
  originalVisibility: InlineStyleSnapshot | null
  overlayHydratedId: number
  overlayHydrationId: number
  overlayHydrationTimer: ReturnType<typeof setTimeout> | 0
  overlayViewport: RectBounds | null
  pausedAnimations: PausedAnimationSnapshot[]
  pointerX: number
  pointerY: number
  repeatReminderRuntime: RepeatReminderRuntime | null
  richPayload: RichMessagePayload | null
  roots: Array<Document | ShadowRoot>
  rootsCachedAt: number
  selectedAt: number
  sender: string
  senderIndex: SenderIndex
  sendCoordinator: SendCoordinator
  settings: ExtensionSettings
}
