import { createApp, nextTick, reactive } from "vue";
import type { PlatformId } from "../../core/types";
import { t } from "../../core/i18n";
import favoritesStyles from "../../assets/styles/favorites.scss?inline";
import FavoritesLauncher from "./FavoritesLauncher.vue";
import { createFavoritesRepository } from "./repository";
import { currentRoomContext } from "./room-context";
import { groupedFavorites, rankedFavorites } from "./ranking";
import {
  FAVORITES_STORAGE_KEY,
  FAVORITE_WRITE_MESSAGE,
  type FavoriteDisplayItem,
  type FavoritePayload,
  type FavoriteRoomGroup,
  type FavoriteSort,
  type FavoriteView,
  type FavoriteWriteRequest,
  type FavoriteWriteResponse,
  type RoomContext
} from "./types";

export interface RadialOption {
  angle: number;
  detail: string;
  favoriteId?: string;
  key: string;
  kind: "favorite" | "more" | "other";
  label: string;
}

export interface FavoritesLauncherState {
  centerX: number;
  centerY: number;
  currentCount: number;
  groups: FavoriteRoomGroup[];
  items: FavoriteDisplayItem[];
  loading: boolean;
  mode: "closed" | "panel" | "radial";
  otherCount: number;
  radialOptions: RadialOption[];
  radialGazeAngle: number;
  radialGazeX: number;
  radialGazeY: number;
  room: RoomContext;
  search: string;
  selectedRadialKey: string;
  selectedRoomKey: string;
  sort: FavoriteSort;
  totalCount: number;
  view: FavoriteView;
}

interface FavoritesRuntimeOptions {
  enabled(): boolean;
  platform: PlatformId;
  sendFavorite(payload: FavoritePayload): Promise<boolean>;
  showToast(message: string, tone?: string): void;
}

export interface FavoritesRuntime {
  destroy(): void;
  favoriteText(text: string, payload?: unknown): Promise<boolean | null>;
  openPanel(view?: FavoriteView): void;
}

type FavoritesRuntimeScope = typeof globalThis & {
  __danmakuEchoFavoritesRuntime?: FavoritesRuntime;
};

const HOLD_DELAY = 180;
const RADIAL_CANCEL_RADIUS = 42;
const RADIAL_MAX_RADIUS = 230;
const FAVORITES_UI_VERSION = 3;
const OWNER_SELECTOR = "[data-bcp-favorites-runtime-owner='true']";
const STALE_PORTAL_SELECTOR = ".bcp-favorites-host, .bcp-favorites-portal";
const OPEN_REQUEST_EVENT = "danmaku-echo:favorites-open";
const FAVORITE_WRITE_TIMEOUT = 6_000;

function runtimeId(extensionId: string): string {
  const random = typeof globalThis.crypto?.randomUUID === "function"
    ? globalThis.crypto.randomUUID()
    : `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
  return `${extensionId}:${random}`;
}

function claimUiOwnership(ownerId: string, extensionId: string): HTMLElement | null {
  const markers = Array.from(document.querySelectorAll<HTMLElement>(OWNER_SELECTOR));
  const current = markers
    .sort((first, second) => Number(second.dataset.bcpFavoritesUiVersion || 0)
      - Number(first.dataset.bcpFavoritesUiVersion || 0))[0];
  const currentVersion = Number(current?.dataset.bcpFavoritesUiVersion || 0);
  if (current && (currentVersion > FAVORITES_UI_VERSION
      || (currentVersion === FAVORITES_UI_VERSION
        && current.dataset.bcpFavoritesExtensionId !== extensionId))) {
    markers.slice(1).forEach((marker) => marker.remove());
    return null;
  }
  markers.forEach((marker) => marker.remove());
  const marker = document.createElement("span");
  marker.hidden = true;
  marker.dataset.bcpFavoritesRuntimeOwner = "true";
  marker.dataset.bcpFavoritesExtensionId = extensionId;
  marker.dataset.bcpFavoritesOwnerId = ownerId;
  marker.dataset.bcpFavoritesUiVersion = String(FAVORITES_UI_VERSION);
  marker.dataset.bcpOneOwned = "true";
  document.documentElement.appendChild(marker);
  return marker;
}

function extensionContextAvailable(extensionId: string): boolean {
  try {
    return Boolean(globalThis.chrome?.runtime?.id)
      && globalThis.chrome.runtime.id === extensionId;
  } catch {
    return false;
  }
}

function favoriteErrorMessage(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error || "");
  return /extension context invalidated|receiving end does not exist|message port closed/i.test(message)
    ? t("favoritesExtensionUpdated")
    : message || t("favoritesActionFailed");
}

function mutateFavoriteInBackground(
  request: Omit<FavoriteWriteRequest, "type">
): Promise<FavoriteWriteResponse> {
  return new Promise((resolve, reject) => {
    let settled = false;
    const timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      reject(new Error(t("favoritesServiceTimeout")));
    }, FAVORITE_WRITE_TIMEOUT);
    try {
      chrome.runtime.sendMessage({ ...request, type: FAVORITE_WRITE_MESSAGE }, (
        response: FavoriteWriteResponse | undefined
      ) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        try {
          const error = chrome.runtime.lastError;
          if (error) {
            reject(new Error(error.message));
          } else if (!response?.ok) {
            reject(new Error(response?.error || t("favoritesServiceUnavailable")));
          } else {
            resolve(response);
          }
        } catch (error) {
          reject(error);
        }
      });
    } catch (error) {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      reject(error);
    }
  });
}

function writeFavoriteInBackground(
  text: string,
  room: RoomContext,
  payload?: unknown
): Promise<FavoriteWriteResponse> {
  return mutateFavoriteInBackground({
    operation: "favorite",
    payload,
    room,
    text
  });
}

function editableTarget(target: EventTarget | null): boolean {
  return target instanceof Element && Boolean(target.closest(
    "input, textarea, select, [contenteditable]:not([contenteditable='false']), [role='textbox']"
  ));
}

function shortLabel(text: string): string {
  const chars = Array.from(text);
  return chars.length > 8 ? `${chars.slice(0, 8).join("")}…` : text;
}

function angularDistance(first: number, second: number): number {
  return Math.abs(((first - second + 540) % 360) - 180);
}

export function createFavoritesRuntime(options: FavoritesRuntimeOptions) {
  const storage = globalThis.chrome?.storage?.local;
  if (!storage) {
    return null;
  }
  const runtimeScope = globalThis as FavoritesRuntimeScope;
  runtimeScope.__danmakuEchoFavoritesRuntime?.destroy();
  const repository = createFavoritesRepository(storage);
  const room = (): RoomContext => currentRoomContext(options.platform);
  const extensionId = globalThis.chrome?.runtime?.id || "standalone";
  const ownerId = runtimeId(extensionId);
  const ownerMarker = claimUiOwnership(ownerId, extensionId);

  if (!ownerMarker) {
    let destroyed = false;
    const passiveRuntime: FavoritesRuntime = {
      destroy(): void {
        destroyed = true;
        if (runtimeScope.__danmakuEchoFavoritesRuntime === passiveRuntime) {
          delete runtimeScope.__danmakuEchoFavoritesRuntime;
        }
      },
      async favoriteText(): Promise<null> {
        // The page-level Douyin renderer broadcasts its request to every
        // isolated extension world. Only the runtime owning the current UI may
        // write storage or show feedback; stale/passive runtimes yield silently.
        return null;
      },
      openPanel(view: FavoriteView = "current"): void {
        if (destroyed || !options.enabled()) return;
        document.dispatchEvent(new CustomEvent(OPEN_REQUEST_EVENT, { detail: { view } }));
      }
    };
    runtimeScope.__danmakuEchoFavoritesRuntime = passiveRuntime;
    return passiveRuntime;
  }
  const activeOwnerMarker = ownerMarker;

  document.querySelectorAll(STALE_PORTAL_SELECTOR).forEach((node) => node.remove());
  const initialRoom = currentRoomContext(options.platform);
  const state = reactive<FavoritesLauncherState>({
    centerX: innerWidth / 2,
    centerY: innerHeight / 2,
    currentCount: 0,
    groups: [],
    items: [],
    loading: true,
    mode: "closed",
    otherCount: 0,
    radialOptions: [],
    radialGazeAngle: -45,
    radialGazeX: 5.5,
    radialGazeY: -5.5,
    room: initialRoom,
    search: "",
    selectedRadialKey: "",
    selectedRoomKey: "",
    sort: "send-count",
    totalCount: 0,
    view: "current"
  });
  const portal = document.createElement("div");
  portal.className = "bcp-favorites-host";
  portal.dataset.bcpFavoritesOwned = "true";
  portal.dataset.bcpFavoritesUiVersion = String(FAVORITES_UI_VERSION);
  portal.dataset.bcpFavoritesOwnerId = ownerId;
  portal.dataset.bcpOneOwned = "true";
  portal.dataset.bcpDouyinOwned = "true";
  portal.style.setProperty("all", "initial", "important");
  portal.style.setProperty("position", "fixed", "important");
  portal.style.setProperty("inset", "0", "important");
  portal.style.setProperty("z-index", "2147483647", "important");
  portal.style.setProperty("pointer-events", "none", "important");
  const shadowRoot = portal.attachShadow({ mode: "open" });
  const style = document.createElement("style");
  style.textContent = favoritesStyles;
  const mountPoint = document.createElement("div");
  mountPoint.className = "bcp-favorites-portal";
  shadowRoot.append(style, mountPoint);
  const app = createApp(FavoritesLauncher, {
    state,
    onAddToRoom: (id: string) => void addToRoom(id),
    onBackToRooms: () => backToRooms(),
    onChangeView: (view: FavoriteView) => changeView(view),
    onClose: close,
    onMove: (id: string, direction: "down" | "up") => void move(id, direction),
    onPin: (id: string, pinned: boolean) => void setPinned(id, pinned),
    onRemove: (id: string) => void remove(id),
    onReorder: (id: string, targetId: string, placement: "after" | "before") =>
      void reorder(id, targetId, placement),
    onSearch: (value: string) => {
      state.search = value;
      refresh();
    },
    onSend: (id: string) => void sendById(id),
    onSelectRoom: (roomKey: string) => selectRoom(roomKey),
    onSort: (sort: FavoriteSort) => changeSort(sort),
    onTags: (id: string, tags: string[]) => void setTags(id, tags),
  });
  app.mount(mountPoint);

  let pointerX = innerWidth / 2;
  let pointerY = innerHeight / 2;
  let hotkeyDown = false;
  let holdTimer: ReturnType<typeof setTimeout> | undefined;
  let restoreFocus: HTMLElement | null = null;
  let unsubscribe = () => {};
  let destroyed = false;

  const onVisibilityChange = () => {
    if (document.hidden) cancelGesture();
  };
  const onWindowBlur = () => cancelGesture();

  function ownsUi(): boolean {
    return activeOwnerMarker.isConnected
      && activeOwnerMarker.dataset.bcpFavoritesOwnerId === ownerId
      && activeOwnerMarker.dataset.bcpFavoritesExtensionId === extensionId
      && Number(activeOwnerMarker.dataset.bcpFavoritesUiVersion) === FAVORITES_UI_VERSION;
  }

  function removeForeignPortal(node: Node): void {
    if (node instanceof Element && node.matches(STALE_PORTAL_SELECTOR) && node !== portal) {
      node.remove();
    }
  }

  const uiObserver = new MutationObserver((records) => {
    if (!ownsUi()) {
      runtime.destroy();
      return;
    }
    records.forEach((record) => record.addedNodes.forEach(removeForeignPortal));
  });

  const onExternalOpen = (event: Event) => {
    const requested = (event as CustomEvent<{ view?: FavoriteView }>).detail?.view;
    openPanel(requested === "other" || requested === "all" ? requested : "current");
  };

  function ensureHost(): void {
    if (destroyed) return;
    if (!ownsUi()) {
      runtime.destroy();
      return;
    }
    const host = document.fullscreenElement || document.documentElement;
    if (portal.parentNode !== host) host.appendChild(portal);
  }

  function refresh(): void {
    state.room = room();
    state.currentCount = rankedFavorites(
      repository.database.items,
      state.room,
      "current"
    ).length;
    const otherGroups = groupedFavorites(repository.database.items, state.room, "other");
    state.otherCount = new Set(otherGroups.flatMap((group) => group.items.map((item) => item.id))).size;
    state.totalCount = repository.database.items.length;
    state.items = state.view === "current"
      ? rankedFavorites(repository.database.items, state.room, "current", state.search, state.sort)
      : [];
    state.groups = state.view === "current"
      ? []
      : groupedFavorites(repository.database.items, state.room, state.view, "", state.sort);
    if (state.selectedRoomKey
        && !state.groups.some((group) => group.roomKey === state.selectedRoomKey)) {
      state.selectedRoomKey = "";
    }
  }

  function radialOptions(): RadialOption[] {
    const current = rankedFavorites(
      repository.database.items,
      room(),
      "current",
      "",
      "custom"
    ).slice(0, 6);
    const raw: Array<Omit<RadialOption, "angle">> = current.map((item) => ({
      detail: item.text,
      favoriteId: item.id,
      key: `favorite:${item.id}`,
      kind: "favorite",
      label: shortLabel(item.text)
    }));
    raw.push({ detail: t("favoritesRadialOtherDetail"), key: "other", kind: "other", label: t("favoritesRadialOther") });
    raw.push({ detail: t("favoritesRadialMoreDetail"), key: "more", kind: "more", label: t("favoritesRadialMore") });
    return raw.map((option, index) => ({
      ...option,
      angle: -90 + index * (360 / raw.length)
    }));
  }

  function close(): void {
    const focusTarget = state.mode === "panel" ? restoreFocus : null;
    state.mode = "closed";
    state.selectedRadialKey = "";
    restoreFocus = null;
    if (focusTarget?.isConnected) {
      void nextTick(() => focusTarget.focus({ preventScroll: true }));
    }
  }

  function openPanel(view: FavoriteView = "current"): void {
    if (!options.enabled()) return;
    const activeElement = document.activeElement;
    if (activeElement instanceof HTMLElement
        && !portal.contains(activeElement) && !shadowRoot.contains(activeElement)) {
      restoreFocus = activeElement;
    }
    ensureHost();
    state.view = view;
    state.search = "";
    state.selectedRoomKey = "";
    state.mode = "panel";
    refresh();
  }

  function openRadial(): void {
    if (!options.enabled()) return;
    ensureHost();
    const horizontalInset = Math.min(190, innerWidth / 2);
    const verticalInset = Math.min(235, innerHeight / 2);
    state.centerX = Math.max(horizontalInset, Math.min(pointerX, innerWidth - horizontalInset));
    state.centerY = Math.max(verticalInset, Math.min(pointerY, innerHeight - verticalInset));
    state.radialOptions = radialOptions();
    state.selectedRadialKey = "";
    state.radialGazeAngle = -45;
    state.radialGazeX = 5.5;
    state.radialGazeY = -5.5;
    state.mode = "radial";
    updateRadialGaze(pointerX - state.centerX, pointerY - state.centerY);
  }

  function updateRadialGaze(deltaX: number, deltaY: number): number {
    const distance = Math.hypot(deltaX, deltaY);
    if (distance < 1) {
      return distance;
    }
    const angle = Math.atan2(deltaY, deltaX) * 180 / Math.PI;
    const gazeDistance = Math.min(10, distance * 0.16);
    state.radialGazeAngle = angle;
    state.radialGazeX = Math.cos(angle * Math.PI / 180) * gazeDistance;
    state.radialGazeY = Math.sin(angle * Math.PI / 180) * gazeDistance;
    return distance;
  }

  function updateRadialSelection(x: number, y: number): void {
    if (state.mode !== "radial") return;
    const deltaX = x - state.centerX;
    const deltaY = y - state.centerY;
    const distance = updateRadialGaze(deltaX, deltaY);
    if (distance < RADIAL_CANCEL_RADIUS || distance > RADIAL_MAX_RADIUS) {
      state.selectedRadialKey = "";
      return;
    }
    const angle = Math.atan2(deltaY, deltaX) * 180 / Math.PI;
    const selected = [...state.radialOptions]
      .sort((first, second) => angularDistance(first.angle, angle) - angularDistance(second.angle, angle))[0];
    state.selectedRadialKey = selected?.key || "";
  }

  async function sendById(id: string): Promise<void> {
    const item = repository.database.items.find((entry) => entry.id === id);
    if (!item) return;
    portal.dataset.bcpFavoritesLastSend = item.text;
    portal.dataset.bcpFavoritesLastSendResult = "pending";
    close();
    const currentRoom = room();
    const success = await options.sendFavorite(item.payload);
    portal.dataset.bcpFavoritesLastSendResult = success ? "success" : "failed";
    if (success) {
      try {
        await mutateFavoriteInBackground({ id, operation: "record-sent", room: currentRoom });
      } catch (error) {
        options.showToast(t("favoritesSendCountSaveFailed", favoriteErrorMessage(error)), "warning");
      }
    }
  }

  async function addToRoom(id: string): Promise<void> {
    try {
      await mutateFavoriteInBackground({ id, operation: "add-to-room", room: room() });
      options.showToast(t("favoritesAddedToRoom"), "success");
    } catch (error) {
      options.showToast(favoriteErrorMessage(error), "error");
    }
  }

  async function remove(id: string): Promise<void> {
    try {
      await mutateFavoriteInBackground({ id, operation: "remove", room: room() });
      options.showToast(t("favoritesRemoved"), "success");
    } catch (error) {
      options.showToast(favoriteErrorMessage(error), "error");
    }
  }

  function activeRoomKey(): string {
    return state.view === "current"
      ? state.room.roomKey
      : state.selectedRoomKey || state.room.roomKey;
  }

  async function setPinned(id: string, pinned: boolean): Promise<void> {
    try {
      await mutateFavoriteInBackground({
        id,
        operation: "set-pinned",
        pinned,
        room: room(),
        targetRoomKey: activeRoomKey()
      });
      options.showToast(t(pinned ? "favoritesPinned" : "favoritesUnpinned"), "success");
    } catch (error) {
      options.showToast(favoriteErrorMessage(error), "error");
    }
  }

  async function setTags(id: string, tags: string[]): Promise<void> {
    try {
      await mutateFavoriteInBackground({ id, operation: "set-tags", room: room(), tags });
      options.showToast(t("favoritesTagsSaved"), "success");
    } catch (error) {
      options.showToast(favoriteErrorMessage(error), "error");
    }
  }

  async function move(id: string, direction: "down" | "up"): Promise<void> {
    try {
      await mutateFavoriteInBackground({
        direction,
        id,
        operation: "move",
        room: room(),
        targetRoomKey: activeRoomKey()
      });
    } catch (error) {
      options.showToast(favoriteErrorMessage(error), "error");
    }
  }

  async function reorder(
    id: string,
    targetId: string,
    placement: "after" | "before"
  ): Promise<void> {
    try {
      await mutateFavoriteInBackground({
        id,
        operation: "reorder",
        placement,
        room: room(),
        targetId,
        targetRoomKey: activeRoomKey()
      });
      options.showToast(t("favoritesOrderSaved"), "success");
    } catch (error) {
      options.showToast(favoriteErrorMessage(error), "error");
    }
  }

  function changeView(view: FavoriteView): void {
    state.view = view;
    state.selectedRoomKey = "";
    refresh();
  }

  function changeSort(sort: FavoriteSort): void {
    state.sort = sort;
    refresh();
  }

  function selectRoom(roomKey: string): void {
    if (state.view === "current" || !state.groups.some((group) => group.roomKey === roomKey)) return;
    state.selectedRoomKey = roomKey;
    state.search = "";
  }

  function backToRooms(): void {
    state.selectedRoomKey = "";
    state.search = "";
  }

  function visiblePanelItems(): FavoriteDisplayItem[] {
    if (state.view === "current") return state.items;
    const group = state.groups.find((entry) => entry.roomKey === state.selectedRoomKey);
    if (!group) return [];
    const query = state.search.replace(/\s+/g, " ").trim().toLowerCase();
    if (!query || group.roomName.toLowerCase().includes(query)) return group.items;
    return group.items.filter((item) => item.normalizedText.includes(query)
      || item.tags.some((tag) => tag.toLowerCase().includes(query)));
  }

  function onPointerMove(event: PointerEvent): void {
    pointerX = event.clientX;
    pointerY = event.clientY;
    updateRadialSelection(pointerX, pointerY);
  }

  function onKeyDown(event: KeyboardEvent): void {
    if (event.key === "Escape" && state.mode !== "closed") {
      event.preventDefault();
      event.stopImmediatePropagation();
      if (state.mode === "panel" && state.selectedRoomKey) backToRooms();
      else close();
      return;
    }
    if (state.mode === "panel" && !editableTarget(event.target)
        && /^[1-9]$/.test(event.key)) {
      const item = visiblePanelItems()[Number(event.key) - 1];
      if (item) {
        event.preventDefault();
        event.stopImmediatePropagation();
        void sendById(item.id);
      }
      return;
    }
    if (event.code !== "KeyQ" || !event.altKey || event.ctrlKey || event.metaKey
        || event.repeat || editableTarget(event.target) || !options.enabled()) {
      return;
    }
    event.preventDefault();
    event.stopImmediatePropagation();
    hotkeyDown = true;
    holdTimer = setTimeout(() => {
      holdTimer = undefined;
      if (hotkeyDown) openRadial();
    }, HOLD_DELAY);
  }

  function onKeyUp(event: KeyboardEvent): void {
    if (event.code !== "KeyQ" || !hotkeyDown) return;
    event.preventDefault();
    event.stopImmediatePropagation();
    hotkeyDown = false;
    if (holdTimer !== undefined) {
      clearTimeout(holdTimer);
      holdTimer = undefined;
      if (state.mode === "panel") close();
      else openPanel("current");
      return;
    }
    if (state.mode !== "radial") return;
    const option = state.radialOptions.find((entry) => entry.key === state.selectedRadialKey);
    if (!option) {
      close();
    } else if (option.favoriteId) {
      void sendById(option.favoriteId);
    } else {
      openPanel(option.kind === "other" ? "other" : "all");
    }
  }

  function cancelGesture(): void {
    hotkeyDown = false;
    if (holdTimer !== undefined) clearTimeout(holdTimer);
    holdTimer = undefined;
    if (state.mode === "radial") close();
  }

  const storageChanged: Parameters<typeof chrome.storage.onChanged.addListener>[0] = (
    changes,
    areaName
  ) => {
    if (areaName === "local" && changes[FAVORITES_STORAGE_KEY]) {
      void repository.load().catch((error) => {
        console.warn("[Danmaku Echo] favorites refresh failed", error);
      });
    }
  };

  const runtime: FavoritesRuntime = {
    destroy(): void {
      if (destroyed) return;
      destroyed = true;
      cancelGesture();
      unsubscribe();
      uiObserver.disconnect();
      try {
        chrome.storage.onChanged.removeListener(storageChanged);
      } catch {
        // Reloading the unpacked extension invalidates the old isolated world.
      }
      document.removeEventListener(OPEN_REQUEST_EVENT, onExternalOpen);
      document.removeEventListener("pointermove", onPointerMove, true);
      document.removeEventListener("keydown", onKeyDown, true);
      document.removeEventListener("keyup", onKeyUp, true);
      document.removeEventListener("fullscreenchange", ensureHost, true);
      document.removeEventListener("webkitfullscreenchange", ensureHost, true);
      document.removeEventListener("visibilitychange", onVisibilityChange);
      window.removeEventListener("blur", onWindowBlur);
      app.unmount();
      portal.remove();
      if (activeOwnerMarker.dataset.bcpFavoritesOwnerId === ownerId) activeOwnerMarker.remove();
      if (runtimeScope.__danmakuEchoFavoritesRuntime === runtime) {
        delete runtimeScope.__danmakuEchoFavoritesRuntime;
      }
    },
    async favoriteText(text: string, payload?: unknown): Promise<boolean | null> {
      if (!options.enabled()) return false;
      if (!extensionContextAvailable(extensionId)) {
        options.showToast(t("favoritesExtensionUpdated"), "error");
        return false;
      }
      const pendingFeedback = setTimeout(() => {
        options.showToast(t("favoritesSaving"), "info");
      }, 300);
      try {
        const currentRoom = room();
        const response = await writeFavoriteInBackground(text, currentRoom, payload);
        const added = Boolean(response.added);
        options.showToast(added ? t("toastFavoriteSaved") : t("favoritesAlreadySaved"), "success");
        return true;
      } catch (error) {
        options.showToast(favoriteErrorMessage(error), "error");
        return false;
      } finally {
        clearTimeout(pendingFeedback);
      }
    },
    openPanel
  };
  runtimeScope.__danmakuEchoFavoritesRuntime = runtime;
  ensureHost();
  unsubscribe = repository.subscribe(() => {
    state.loading = false;
    refresh();
  });
  void repository.load().then(() => {
    if (repository.recoveredFromBackup) {
      options.showToast(t("favoritesRecovered"), "warning");
    }
  }).catch((error) => {
    state.loading = false;
    options.showToast(favoriteErrorMessage(error), "error");
    console.warn("[Danmaku Echo] favorites load failed", error);
  });
  uiObserver.observe(document.documentElement, { childList: true, subtree: true });
  document.addEventListener(OPEN_REQUEST_EVENT, onExternalOpen);
  document.addEventListener("pointermove", onPointerMove, true);
  document.addEventListener("keydown", onKeyDown, true);
  document.addEventListener("keyup", onKeyUp, true);
  document.addEventListener("fullscreenchange", ensureHost, true);
  document.addEventListener("webkitfullscreenchange", ensureHost, true);
  document.addEventListener("visibilitychange", onVisibilityChange);
  window.addEventListener("blur", onWindowBlur);
  chrome.storage.onChanged.addListener(storageChanged);

  return runtime;
}
