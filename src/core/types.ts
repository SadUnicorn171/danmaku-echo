export type PlatformId = 'bilibili' | 'douyin' | 'douyu' | 'huya'

export interface RepeatReminderSettings {
  enabled: boolean
  promptDurationSeconds: number
  promptScalePercent: number
  queueLimit: number
  threshold: number
}

export interface InterfaceScaleSettings {
  capsulePercent: number
}

export type ColorSettingKey =
  | 'actionStart'
  | 'actionEnd'
  | 'actionText'
  | 'focusRing'
  | 'selection'
  | 'panelBackground'
  | 'panelText'
  | 'success'
  | 'warning'
  | 'error'

export type ColorSettings = Record<ColorSettingKey, string>

interface PlatformSettings {
  bilibili: boolean
  douyin: boolean
  douyu: boolean
  huya: boolean
}

export interface SideChatCapsuleSettings {
  bilibili: boolean
  douyu: boolean
  huya: boolean
}

export interface NativeDanmakuCapsuleSettings {
  douyu: boolean
}

export interface ActionSettings {
  copy: boolean
  favorite: boolean
  plusOne: boolean
  reply: boolean
}

export interface ExtensionSettings {
  actions: ActionSettings
  altClick: boolean
  colors: Record<PlatformId, ColorSettings>
  enabled: boolean
  interfaceScale: InterfaceScaleSettings
  nativeDanmakuCapsule: NativeDanmakuCapsuleSettings
  platforms: PlatformSettings
  repeatReminder: RepeatReminderSettings
  sideChatCapsule: SideChatCapsuleSettings
}

export interface SharedExtensionApi {
  COLOR_SETTING_KEYS: readonly ColorSettingKey[]
  DEFAULT_SETTINGS: ExtensionSettings
  applyCapsuleScale(root: unknown, percent: unknown): void
  applyPlatformColors(root: unknown, colors: unknown): void
  detectPlatform(hostname: unknown, pathname: unknown): PlatformId | null
  extractSenderFromRecord(value: unknown): string
  isPlausibleMessage(value: unknown, maxLength?: number): boolean
  mergeSettings(saved?: unknown): ExtensionSettings
  normalizeHexColor(value: unknown): string
  normalizeSenderName(value: unknown): string
  normalizeWhitespace(value: unknown): string
  parseMessageText(value: unknown, maxLength?: number): string
  replyDraftValue(currentValue: unknown, sender: unknown): string
  replyMention(sender: unknown): string
}

export interface DouyinRuntimeRequest {
  attempt?: number
  href?: string
  type: 'danmaku-echo.ensure-douyin-runtime' | 'danmaku-echo.ensure-douyin-page-hook'
}

export interface DanmakuRichTextPart {
  resourceId?: string
  resourceUrl?: string
  text?: string
  type: 'emoji' | 'image' | 'text'
}

export interface DanmakuDescriptor {
  messageId?: string
  parts: DanmakuRichTextPart[]
  platform: PlatformId
  resourceIds: string[]
  senderId?: string
  senderName?: string
  source: 'chat' | 'video'
  text: string
}

export interface ActionResult {
  action: 'favorite' | 'plus-one' | 'reply'
  durationMs: number
  platformFeedback?: string
  reason?: string
  success: boolean
}

export interface LivePlatformAdapter {
  cleanup(): void
  describe(candidate: Element, source: DanmakuDescriptor['source']): DanmakuDescriptor | null
  findCandidate(path: EventTarget[]): { element: Element; source: DanmakuDescriptor['source'] } | null
  findOfficialEditor(options?: { reply?: boolean }): Element | null | Promise<Element | null>
  nativeCapsuleVisible(settings: ExtensionSettings): boolean
  resolveSender(descriptor: DanmakuDescriptor, candidate: Element): {
    id?: string
    name?: string
  }
}

export interface DiagnosticsEventV1 {
  at: number
  durationMs?: number
  outcome?: 'failure' | 'success' | 'warning'
  stage?: string
  type: string
}

export interface DiagnosticsSnapshotV1 {
  browser: string
  cacheCounts: Record<string, number>
  events: DiagnosticsEventV1[]
  extensionVersion: string
  featureFlags: Record<string, boolean>
  fullscreen: boolean
  observerCounts: Record<string, number>
  performance: Record<string, number>
  platform: PlatformId
  schemaVersion: 1
  selectorHits: Record<string, boolean>
}

export interface DiagnosticsRequest {
  type: 'danmaku-echo.diagnostics.snapshot'
}

declare global {
  var DanmakuEchoShared: SharedExtensionApi | undefined
}
