import type { DanmakuRichTextPart } from '../../core/types'

export type RepeatReminderSource = 'chat' | 'video'

export interface RepeatReminderObservation {
  messageId?: string
  observedAt: number
  parts: DanmakuRichTextPart[]
  resourceIds: string[]
  senderId?: string
  senderName?: string
  source: RepeatReminderSource
  text: string
}

export interface RepeatReminderSuggestion {
  count: number
  id: string
  senders: number
  text: string
  threshold: number
  windowMs: number
}
