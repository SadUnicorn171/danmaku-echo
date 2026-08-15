import type {
  FavoriteDanmaku,
  FavoriteDisplayItem,
  FavoriteRoomGroup,
  FavoriteSort,
  FavoriteView,
  RoomContext
} from "./types";

export function belongsToRoom(item: FavoriteDanmaku, roomKey: string): boolean {
  return item.origins.some((origin) => origin.roomKey === roomKey)
    || Boolean(item.roomStats[roomKey]?.addedToRoomAt);
}

function collectedAt(item: FavoriteDanmaku, roomKey?: string): number {
  const originTimes = item.origins
    .filter((origin) => !roomKey || origin.roomKey === roomKey)
    .map((origin) => Number(origin.collectedAt) || 0);
  const addedAt = roomKey ? Number(item.roomStats[roomKey]?.addedToRoomAt) || 0 : 0;
  return Math.max(item.createdAt, addedAt, ...originTimes);
}

function sourceLabel(item: FavoriteDanmaku, room: RoomContext, roomKey?: string): string {
  const selected = roomKey
    ? item.origins.find((origin) => origin.roomKey === roomKey)
    : undefined;
  const current = item.origins.find((origin) => origin.roomKey === room.roomKey);
  const origin = selected || current || item.origins.at(-1);
  if (!origin) return "本地收藏";
  return origin.roomKey === room.roomKey ? "本房收藏" : `来自 ${origin.roomName}`;
}

function compareFavorites(
  first: FavoriteDisplayItem,
  second: FavoriteDisplayItem,
  sort: FavoriteSort
): number {
  if (first.pinned !== second.pinned) return Number(second.pinned) - Number(first.pinned);
  if (sort === "custom") {
    return first.customOrder - second.customOrder
      || first.sortTimestamp - second.sortTimestamp
      || first.id.localeCompare(second.id);
  }
  if (sort === "time-asc") {
    return first.sortTimestamp - second.sortTimestamp
      || first.createdAt - second.createdAt
      || first.id.localeCompare(second.id);
  }
  if (sort === "time-desc") {
    return second.sortTimestamp - first.sortTimestamp
      || second.createdAt - first.createdAt
      || first.id.localeCompare(second.id);
  }
  return second.totalSendCount - first.totalSendCount
    || second.lastSentAt - first.lastSentAt
    || second.sortTimestamp - first.sortTimestamp
    || first.id.localeCompare(second.id);
}

function displayItem(
  item: FavoriteDanmaku,
  room: RoomContext,
  roomKey?: string
): FavoriteDisplayItem {
  return {
    ...item,
    belongsToCurrentRoom: belongsToRoom(item, room.roomKey),
    customOrder: Number(item.roomStats[roomKey || room.roomKey]?.customOrder) || 0,
    pinned: Boolean(item.roomStats[roomKey || room.roomKey]?.pinned || (!roomKey && item.globalPinned)),
    sourceLabel: sourceLabel(item, room, roomKey),
    sortTimestamp: collectedAt(item, roomKey)
  };
}

function fallbackRoom(roomKey: string): Pick<FavoriteRoomGroup, "platform" | "roomId" | "roomKey" | "roomName"> {
  const separator = roomKey.indexOf(":");
  const platform = separator > 0 ? roomKey.slice(0, separator) : "bilibili";
  const roomId = separator > 0 ? roomKey.slice(separator + 1) : roomKey;
  return {
    platform: platform === "douyin" || platform === "douyu" || platform === "huya"
      ? platform
      : "bilibili",
    roomId,
    roomKey,
    roomName: `直播间 ${roomId}`
  };
}

export function rankedFavorites(
  items: FavoriteDanmaku[],
  room: RoomContext,
  view: FavoriteView,
  search = "",
  sort: FavoriteSort = "send-count"
): FavoriteDisplayItem[] {
  const query = search.replace(/\s+/g, " ").trim().toLowerCase();
  return items
    .filter((item) => {
      const current = belongsToRoom(item, room.roomKey);
      if (view === "current" && !current) return false;
      if (view === "other" && current) return false;
      return !query || item.normalizedText.includes(query)
        || item.tags.some((tag) => tag.toLowerCase().includes(query));
    })
    .map((item) => displayItem(item, room, view === "current" ? room.roomKey : undefined))
    .sort((first, second) => compareFavorites(first, second, sort));
}

export function groupedFavorites(
  items: FavoriteDanmaku[],
  room: RoomContext,
  view: Exclude<FavoriteView, "current">,
  search = "",
  sort: FavoriteSort = "send-count"
): FavoriteRoomGroup[] {
  const query = search.replace(/\s+/g, " ").trim().toLowerCase();
  const roomItems = new Map<string, {
    metadata: Pick<FavoriteRoomGroup, "platform" | "roomId" | "roomKey" | "roomName">;
    items: FavoriteDanmaku[];
  }>();

  for (const item of items) {
    const memberships = new Map(item.origins.map((origin) => [origin.roomKey, {
      platform: origin.platform,
      roomId: origin.roomId,
      roomKey: origin.roomKey,
      roomName: origin.roomName
    }]));
    Object.entries(item.roomStats).forEach(([roomKey, stats]) => {
      if (stats.addedToRoomAt && !memberships.has(roomKey)) {
        memberships.set(roomKey, roomKey === room.roomKey ? room : fallbackRoom(roomKey));
      }
    });
    memberships.forEach((metadata, roomKey) => {
      if (view === "other" && roomKey === room.roomKey) return;
      const roomMatches = metadata.roomName.toLowerCase().includes(query);
      if (query && !roomMatches && !item.normalizedText.includes(query)
          && !item.tags.some((tag) => tag.toLowerCase().includes(query))) return;
      const group = roomItems.get(roomKey) || { metadata, items: [] };
      group.items.push(item);
      roomItems.set(roomKey, group);
    });
  }

  return Array.from(roomItems.values(), ({ metadata, items: groupItems }) => {
    const displayItems = groupItems
      .map((item) => displayItem(item, room, metadata.roomKey))
      .sort((first, second) => compareFavorites(first, second, sort));
    return {
      ...metadata,
      isCurrentRoom: metadata.roomKey === room.roomKey,
      items: displayItems,
      latestCollectedAt: Math.max(...displayItems.map((item) => item.sortTimestamp)),
      totalSendCount: displayItems.reduce((total, item) => total + item.totalSendCount, 0)
    };
  }).sort((first, second) => Number(second.isCurrentRoom) - Number(first.isCurrentRoom)
    || second.latestCollectedAt - first.latestCollectedAt
    || first.roomName.localeCompare(second.roomName, "zh-CN"));
}
