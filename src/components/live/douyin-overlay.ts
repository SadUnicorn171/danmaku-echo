import { createApp, nextTick, reactive } from "vue";
import type { ActionSettings } from "../../core/types";
import DouyinOverlay from "./DouyinOverlay.vue";

export interface DouyinOverlayState {
  actions: ActionSettings;
  cardActive: boolean;
  cardMounted: boolean;
  cardVisible: boolean;
  content: unknown[];
  cooldownSeconds: number;
  left: number;
  measuring: boolean;
  message: string;
  sender: string;
  metadata: {
    kind: string;
    message: string;
    selectionId: string;
    selectionPhase: string;
    trackId: string;
  };
  previewStyle: Record<string, unknown>;
  sending: boolean;
  side: string;
  toast: null | { id: number; message: string; tone: string; visible: boolean };
  top: number;
}

interface DouyinOverlayCallbacks {
  onCardEnter(): void;
  onCardLeave(): void;
  onCardMove(): void;
  onCopy(event: MouseEvent): void;
  onFavorite(event: MouseEvent): void;
  onPlaceholder(event: MouseEvent, action: "reply"): void;
  onPlusOne(event: MouseEvent): void;
  onPointerDown(event: MouseEvent | PointerEvent): void;
}

export function createDouyinOverlay(callbacks: DouyinOverlayCallbacks) {
  const portal = document.createElement("div");
  portal.className = "bcp-douyin-portal";
  portal.dataset.bcpDouyinOwned = "true";
  const state = reactive<DouyinOverlayState>({
    actions: { copy: false, plusOne: true, reply: true, favorite: true },
    cardActive: false,
    cardMounted: false,
    cardVisible: false,
    content: [],
    cooldownSeconds: 0,
    left: 0,
    measuring: true,
    message: "",
    sender: "",
    metadata: { kind: "", message: "", selectionId: "", selectionPhase: "", trackId: "" },
    previewStyle: {},
    sending: false,
    side: "right",
    toast: null,
    top: 0
  });
  createApp(DouyinOverlay, {
    state,
    onCardEnter: callbacks.onCardEnter,
    onCardLeave: callbacks.onCardLeave,
    onCardMove: callbacks.onCardMove,
    onCopy: callbacks.onCopy,
    onPlaceholder: callbacks.onPlaceholder,
    onFavorite: callbacks.onFavorite,
    onPlusOne: callbacks.onPlusOne,
    onPointerdown: callbacks.onPointerDown
  }).mount(portal);
  let toastId = 0;
  let toastTimer: ReturnType<typeof setTimeout> | undefined;

  function ensureHost(host: Element): HTMLElement {
    if (portal.parentNode !== host) {
      try {
        host.appendChild(portal);
      } catch {
        document.documentElement.appendChild(portal);
      }
    }
    return portal;
  }

  function card(): HTMLElement | null {
    return portal.querySelector<HTMLElement>(".bcp-douyin-card");
  }

  function plusOneButton(): HTMLButtonElement | null {
    return portal.querySelector<HTMLButtonElement>(".bcp-douyin-button");
  }

  function showToast(message: string, tone = "info"): void {
    if (toastTimer !== undefined) clearTimeout(toastTimer);
    toastId += 1;
    state.toast = { id: toastId, message, tone, visible: false };
    void nextTick(() => requestAnimationFrame(() => {
      if (state.toast?.id === toastId) state.toast.visible = true;
    }));
    toastTimer = setTimeout(() => {
      if (state.toast?.id !== toastId) return;
      state.toast.visible = false;
      setTimeout(() => {
        if (state.toast?.id === toastId) state.toast = null;
      }, 180);
    }, message.length > 80 ? 6000 : tone === "error" ? 3600 : 2400);
  }

  return {
    card,
    dismissToast(): void {
      if (toastTimer !== undefined) clearTimeout(toastTimer);
      toastTimer = undefined;
      state.toast = null;
    },
    ensureHost,
    hideCard(): void {
      state.cardActive = false;
      state.cardVisible = false;
      state.content = [];
      state.sending = false;
    },
    plusOneButton,
    portal,
    positionCard(left: number, top: number, side: string): void {
      state.left = Math.round(left);
      state.top = Math.round(top);
      state.side = side;
      state.measuring = false;
      requestAnimationFrame(() => {
        if (state.cardVisible) state.cardActive = true;
      });
    },
    prepareCard(candidate: Record<string, unknown>, metadata: DouyinOverlayState["metadata"]): void {
      state.cardMounted = true;
      state.cardActive = false;
      state.cardVisible = true;
      state.measuring = true;
      state.message = String(candidate.message || "");
      state.sender = String(candidate.sender || "");
      state.content = Array.isArray(candidate.content) ? candidate.content : [];
      state.previewStyle = candidate.style && typeof candidate.style === "object"
        ? candidate.style as Record<string, unknown>
        : {};
      state.metadata = metadata;
      state.sending = false;
    },
    setActions(actions: ActionSettings): void {
      state.actions = { ...actions };
      if (!Object.values(actions).some(Boolean)) state.cardVisible = false;
    },
    setCooldown(remainingMs: number): void {
      state.cooldownSeconds = Math.max(0, Math.ceil(Number(remainingMs) / 1_000));
    },
    setSelectionPhase(selectionPhase: string): void {
      state.metadata.selectionPhase = selectionPhase;
    },
    setSending(sending: boolean): void {
      state.sending = sending;
    },
    showToast
  };
}
