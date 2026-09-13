import type { PlatformId } from '../../core/types'

export interface LivePlatformConfig {
  chatRoots: string[]
  inputs: string[]
  maxLength: number
  messageText: string[]
  messages: string[]
  name: string
  overlayMessages: string[]
  sendButtons: string[]
  userNames: string[]
  videoRoots: string[]
}

export type SupportedContentPlatform = Exclude<PlatformId, 'douyin'>

export function isSupportedContentPlatform(value: unknown): value is SupportedContentPlatform {
  return value === 'bilibili' || value === 'douyu' || value === 'huya'
}
