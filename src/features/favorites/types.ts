import type { PlatformId } from "../../core/types";

export const FAVORITES_SCHEMA_VERSION = 2;
export const FAVORITES_STORAGE_KEY = "danmakuEchoFavoritesV1";
export const FAVORITES_BACKUP_STORAGE_KEY = "danmakuEchoFavoritesBackupV2";
export const FAVORITES_IMPORT_BACKUP_STORAGE_KEY = "danmakuEchoFavoritesBeforeImportV2";
export const FAVORITE_WRITE_MESSAGE = "danmaku-echo.favorite-write";

export interface FavoriteAsset {
  keys: string[];
  src: string;
  token: string;
}

export type FavoritePart =
  | { text: string; type: "text" }
  | { asset: FavoriteAsset; type: "emoji" };

export interface FavoritePayload {
  assets: FavoriteAsset[];
  parts: FavoritePart[];
  plainText: string;
  text: string;
}

export interface FavoriteWriteRequest {
  direction?: "down" | "up";
  id?: string;
  operation?: "add-to-room" | "favorite" | "move" | "record-sent" | "remove" | "reorder" | "set-pinned" | "set-tags";
  placement?: "after" | "before";
  payload?: unknown;
  pinned?: boolean;
  room: RoomContext;
  tags?: string[];
  targetId?: string;
  targetRoomKey?: string;
  text?: string;
  type: typeof FAVORITE_WRITE_MESSAGE;
}

export interface FavoriteWriteResponse {
  added?: boolean;
  error?: string;
  ok: boolean;
}

export interface RoomContext {
  platform: PlatformId;
  roomId: string;
  roomKey: string;
  roomName: string;
  url: string;
}

export interface FavoriteOrigin {
  collectedAt: number;
  platform: PlatformId;
  roomId: string;
  roomKey: string;
  roomName: string;
}

export interface FavoriteRoomStats {
  addedToRoomAt?: number;
  customOrder: number;
  lastSentAt: number;
  pinned: boolean;
  sendCount: number;
}

export interface FavoriteDanmaku {
  createdAt: number;
  globalPinned: boolean;
  id: string;
  lastSentAt: number;
  normalizedText: string;
  origins: FavoriteOrigin[];
  payload: FavoritePayload;
  roomStats: Record<string, FavoriteRoomStats>;
  tags: string[];
  text: string;
  totalSendCount: number;
  updatedAt: number;
}

export interface FavoritesDatabase {
  items: FavoriteDanmaku[];
  revision: number;
  schemaVersion: 2;
  updatedAt: number;
  writeId: string;
}

export type FavoriteView = "all" | "current" | "other";
export type FavoriteSort = "custom" | "send-count" | "time-asc" | "time-desc";

export interface FavoriteDisplayItem extends FavoriteDanmaku {
  belongsToCurrentRoom: boolean;
  customOrder: number;
  pinned: boolean;
  sourceLabel: string;
  sortTimestamp: number;
}

export interface FavoriteRoomGroup {
  isCurrentRoom: boolean;
  items: FavoriteDisplayItem[];
  latestCollectedAt: number;
  platform: PlatformId;
  roomId: string;
  roomKey: string;
  roomName: string;
  totalSendCount: number;
}
