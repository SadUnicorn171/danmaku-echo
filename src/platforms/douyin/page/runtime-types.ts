import type { ActionSettings } from '../../../core/types'
import type { SerializedBarrageItem, SafePaint } from '../barrage-model'

/** CSS viewport pixels, before device-pixel-ratio scaling. */
export type CssPixels = number

/** Backing-store pixels used by the native Canvas renderer. */
export type DevicePixels = number

/** A duration measured in milliseconds. */
export type Milliseconds = number

/** A Unix timestamp measured in milliseconds. */
export type TimestampMilliseconds = number

/** A monotonic requestAnimationFrame timestamp measured in milliseconds. */
export type AnimationFrameMilliseconds = number

/** Dimensionless device-pixel or layout scale. */
export type RendererScale = number

/** Browser timer/animation identifiers in the MAIN world. Zero means inactive. */
export type RendererTimerId = number
export type RendererAnimationFrameId = number

export type RendererInstanceId = number | string
export type RendererTrackId = number
export type RendererMessageId = string

export interface RendererConfig {
  [key: string]: unknown
  channelHeight: CssPixels
  devicePixelRatio: RendererScale
  duration: Milliseconds
  fontSize: CssPixels
  gap: CssPixels
  height: CssPixels
  maxChannelCount?: number
  maxCount: number
  maxHeightRate: RendererScale
  width: CssPixels
}

export interface RendererTextStyle {
  color?: SafePaint
  fontFamily?: string
  fontSize?: CssPixels
  fontWeight?: number | string
  strokeColor?: SafePaint
  strokeWidth?: CssPixels
}

export interface RendererBarrageDescription {
  actionWidth: CssPixels
  contentHeight: CssPixels
  contentWidth: CssPixels
  firstText: RendererTextStyle | null
  height: CssPixels
  imageCount: number
  imageOnly: boolean
  rendererPadding: [CssPixels, CssPixels, CssPixels, CssPixels]
  text: string
  width: CssPixels
}

export interface RendererChannelRange {
  additionalPriority?: number
  additionalReserveDuration?: Milliseconds
  len?: number
  startIndex?: number
}

export interface RendererBarrageOptions {
  [key: string]: unknown
  channelRange?: RendererChannelRange
  duration?: Milliseconds
  id?: string | number
  itemId?: string | number
  messageId?: string | number
  msgId?: string | number
  prior?: number
  reserveDuration?: Milliseconds
  startTime?: TimestampMilliseconds
}

export type RendererCapsuleSide = 'left' | 'right'

export interface RendererTrackDomState {
  actionBar: HTMLDivElement
  actionSide: RendererCapsuleSide | null
  barrage: HTMLDivElement
  button: HTMLButtonElement
  content: HTMLSpanElement
  copyButton: HTMLButtonElement
  favoriteButton: HTMLButtonElement
  hovered: boolean
  hoverTimer: RendererTimerId
  node: HTMLDivElement
  releaseTimer: RendererTimerId
  replyButton: HTMLButtonElement
  sending: boolean
  visualHeight: CssPixels
  visualLeft: CssPixels | null
  visualWidth: CssPixels
}

export interface RendererTrackMotionState {
  /** Distance travelled in CSS pixels, before renderer DPR scaling. */
  distance: CssPixels
  paused: boolean
}

export interface RendererBookedChannel {
  end: number
  start: number
}

/** A measured barrage waiting for channel assignment. */
export interface PendingBarrage {
  content: SerializedBarrageItem[]
  description: RendererBarrageDescription
  observedAt: TimestampMilliseconds
  options: RendererBarrageOptions
  own: boolean
  sender: string
}

/** A pending barrage after it has been registered to one renderer instance. */
export interface RendererTrack extends PendingBarrage {
  bookedChannel: RendererBookedChannel | null
  id: RendererTrackId
  instance: RendererInstance
  motion: RendererTrackMotionState
  renderer?: RendererTrackDomState | null
  startedAt: TimestampMilliseconds | 0
}

export type RendererChannel = RendererTrack[]

export interface RendererFrameState {
  /** Native message id to CSS-pixels-per-millisecond speed. */
  rightPositions: Map<RendererMessageId, DevicePixels>
  /** Track id to the native message ids immediately ahead of it. */
  previousIds: Map<RendererTrackId, RendererMessageId[]>
  /** Native message id to CSS-pixels-per-millisecond speed. */
  speeds: Map<RendererMessageId, number>
  moved: Set<RendererTrackId>
}

export const RENDERER_LIFECYCLE_STATES = [
  'recovering',
  'observing',
  'active',
  'suspended',
  'blocked',
  'destroyed'
] as const

export type RendererLifecycleState = (typeof RENDERER_LIFECYCLE_STATES)[number]

export const RENDERER_FAILURE_REASONS = [
  'activation-metadata-mismatch',
  'animation-frame-error',
  'copy-metadata-mismatch',
  'favorite-metadata-mismatch',
  'fullscreen-relayout-error',
  'prepare-barrage-error',
  'reply-metadata-mismatch'
] as const

export type RendererFailureReason = (typeof RENDERER_FAILURE_REASONS)[number]

export interface RendererLifecycle {
  lastFailure: RendererFailureReason | null
  state: RendererLifecycleState
}

export interface RendererInstance {
  active: boolean
  animationFrame: RendererAnimationFrameId
  canvas: HTMLCanvasElement
  canvasEverConnected: boolean
  canvasId: number
  channels: RendererChannel[]
  config: RendererConfig
  createdAt: TimestampMilliseconds
  frameState: RendererFrameState
  id: RendererInstanceId
  /** Monotonic timestamp of the previous animation frame, in milliseconds. */
  lastFrameAt: AnimationFrameMilliseconds | 0
  lifecycle: RendererLifecycle
  /** Deadline for the initial Canvas mount grace period, in milliseconds. */
  mountGraceUntil: TimestampMilliseconds
  pending: RendererTrack[]
  pushTimer: RendererTimerId
  recovered: boolean
  rendererBlocked: boolean
  rendererBorderRadius: string | null
  rendererCanvasVisibility: string
  rendererCleanClearObserved: boolean
  rendererGeneration: number
  rendererGeometryKey: string
  rendererLayer: HTMLDivElement | null
  rendererNodes: Map<RendererTrackId, HTMLDivElement>
  rendererOwnsCanvasVisibility: boolean
  rendererPreparing: number
  /** Earliest timestamp at which a recovered instance may take over Canvas. */
  rendererSafeAfter: TimestampMilliseconds
  rendererSafeSync: boolean
  rendererTakeover: boolean
  tracks: Map<RendererTrackId, RendererTrack>
}

export type RendererActionName = 'copy' | 'favorite' | 'plus-one'

export type RendererActionButton<Action extends RendererActionName> = HTMLButtonElement & {
  dataset: DOMStringMap & { action?: Action }
}

export interface RendererActionRequest<Action extends RendererActionName> {
  button: RendererActionButton<Action>
  cancelResponse: () => void
  track: RendererTrack
}

export type RendererActivationRequest = RendererActionRequest<'plus-one'>
export type RendererCopyRequest = RendererActionRequest<'copy'>
export type RendererFavoriteRequest = RendererActionRequest<'favorite'>

export interface RendererOrphanInstance {
  barrages: RendererBarrageOptions[]
  config: Partial<RendererConfig>
  createdAt: TimestampMilliseconds
  id: RendererInstanceId
}

export type DouyinPageDebugLevel = 'debug' | 'error' | 'info' | 'warn'
export type DouyinPageDebugValue =
  | boolean
  | number
  | string
  | null
  | DouyinPageDebugValue[]
  | { [key: string]: DouyinPageDebugValue }

export interface DouyinPageDebugEvent {
  at: TimestampMilliseconds
  details: DouyinPageDebugValue
  sinceInstall: Milliseconds
  type: string
}

export interface DouyinPageDebugCounters {
  barragesObserved: number
  barragesStarted: number
  canvasTransfers: number
  instancesCreated: number
  instancesRecovered: number
  ownBarragesMatched: number
  ownBarragesReconciled: number
  ownMessagesQueued: number
  protocolMessagesRejected: number
  rendererActivations: number
  rendererNodesCreated: number
  rendererRestores: number
  rendererResults: number
  rendererTakeovers: number
  skippedBarrages: number
  workerMessages: number
}

export interface DouyinPageDebugState {
  counters: DouyinPageDebugCounters
  events: DouyinPageDebugEvent[]
  href: string
  installedAt: string
  installedAtMs: TimestampMilliseconds
  lastError: string
  readyState: DocumentReadyState
  version: string
}

export interface DouyinPageRendererSettings {
  actions: ActionSettings
  capsuleScale: RendererScale
  enabled: boolean
  heartbeatAt: TimestampMilliseconds | 0
  repeatReminderEnabled: boolean
}
