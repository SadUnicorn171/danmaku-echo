import type { RichMessagePayload } from './rich-message'

export interface LivePlatformSender {
  prepareFavorite(payload: RichMessagePayload): Promise<RichMessagePayload>
  sendFavorite(payload: RichMessagePayload): Promise<boolean>
  sendRich(payload: RichMessagePayload): Promise<boolean>
  sendText(message: string): Promise<boolean>
}
