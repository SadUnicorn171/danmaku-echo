import type {
  ActionSettings,
  ExtensionSettings,
  PlatformId
} from "../../core/types";

export type MessageSurface = "chat" | "overlay" | null;

export function shouldHideNativeDanmakuCapsule(
  settings: Pick<
    ExtensionSettings,
    "enabled" | "nativeDanmakuCapsule" | "platforms"
  >,
  platform: PlatformId
): boolean {
  return platform === "douyu"
    && settings.enabled
    && settings.platforms.douyu
    && !settings.nativeDanmakuCapsule.douyu;
}

export function visibleActionsForSurface(
  settings: Pick<ExtensionSettings, "actions" | "sideChatCapsule">,
  platform: PlatformId,
  surface: MessageSurface
): ActionSettings {
  const sideChatControlsCapsule = surface === "chat"
    && (platform === "huya" || platform === "bilibili" || platform === "douyu");
  if (sideChatControlsCapsule && !settings.sideChatCapsule[platform]) {
    return { copy: false, plusOne: false, reply: false, favorite: false };
  }
  return { ...settings.actions };
}
