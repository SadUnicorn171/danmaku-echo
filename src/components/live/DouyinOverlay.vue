<template>
  <div
    v-if="state.cardMounted"
    :class="['bcp-douyin-card', { 'is-visible': state.cardActive }]"
    :hidden="!state.cardVisible"
    data-bcp-douyin-owned="true"
    data-bcp-douyin-interaction-card="true"
    role="group"
    :data-track-id="state.metadata.trackId"
    :data-kind="state.metadata.kind"
    :data-message="state.metadata.message"
    :data-selection-id="state.metadata.selectionId"
    :data-selection-phase="state.metadata.selectionPhase"
    :data-side="state.side"
    :style="{
      left: `${state.left}px`,
      top: `${state.top}px`,
      visibility: state.measuring ? 'hidden' : undefined
    }"
    @pointerenter="emit('cardEnter')"
    @pointermove="emit('cardMove')"
    @pointerleave="emit('cardLeave')"
  >
    <div class="bcp-douyin-preview" data-bcp-douyin-owned="true" :title="state.message">
      <template v-if="hasRenderableContent(state.content)">
        <RichPreviewItem
          v-for="(item, index) in state.content"
          :key="index"
          :item="item"
          :inherited-style="state.previewStyle"
        />
      </template>
      <span v-else class="bcp-douyin-preview-text">{{ state.message }}</span>
    </div>
    <ActionBar
      :actions="state.actions"
      :cooldown-seconds="state.cooldownSeconds"
      :message="state.message"
      :sender="state.sender"
      :sending="state.sending"
      variant="douyin"
      :visible="state.cardVisible"
      @copy="(event) => emit('copy', event)"
      @placeholder="(event, action) => emit('placeholder', event, action)"
      @favorite="(event) => emit('favorite', event)"
      @plus-one="(event) => emit('plusOne', event)"
      @pointerdown="(event) => emit('pointerdown', event)"
    />
  </div>
  <FeedbackToast
    v-if="state.toast"
    :key="state.toast.id"
    :message="state.toast.message"
    :tone="state.toast.tone"
    variant="douyin"
    :visible="state.toast.visible"
  />
</template>

<script setup lang="ts">
import ActionBar from "./ActionBar.vue";
import FeedbackToast from "./FeedbackToast.vue";
import RichPreviewItem from "./RichPreviewItem.vue";
import type { DouyinOverlayState } from "./douyin-overlay";

defineProps<{ state: DouyinOverlayState }>();
const emit = defineEmits<{
  cardEnter: [];
  cardLeave: [];
  cardMove: [];
  copy: [event: MouseEvent];
  favorite: [event: MouseEvent];
  placeholder: [event: MouseEvent, action: "reply"];
  plusOne: [event: MouseEvent];
  pointerdown: [event: MouseEvent | PointerEvent];
}>();

function hasRenderableContent(content: unknown[]): boolean {
  return content.some((raw) => {
    if (!raw || typeof raw !== "object") return false;
    const item = raw as { content?: unknown[]; src?: unknown; text?: unknown; type?: unknown };
    if (item.type === "text") return Boolean(String(item.text ?? ""));
    if (item.type === "image") return typeof item.src === "string" && Boolean(item.src);
    return Array.isArray(item.content) && hasRenderableContent(item.content);
  });
}
</script>

<style lang="scss">
.bcp-douyin-portal {
  all: initial;
  display: block;
  height: 100%;
  inset: 0;
  isolation: isolate;
  pointer-events: none;
  position: fixed;
  width: 100%;
  z-index: 2147483647;
}

/*
 * Douyin's native barrage layer is a canvas.  The replacement layer keeps the
 * same fixed viewport geometry, while only individual barrage nodes take part
 * in hit testing. The layer clips moving nodes to the native Canvas viewport,
 * so a barrage is revealed progressively as it enters from the right. Width,
 * height and translate3d are supplied by the page hook.
 */
.bcp-douyin-dom-layer {
  all: initial;
  contain: layout style;
  display: block;
  isolation: isolate;
  overflow: hidden;
  pointer-events: none !important;
  position: fixed;
  z-index: 2147483646;
}

.bcp-douyin-dom-layer[hidden] {
  display: none !important;
}

.bcp-douyin-dom-track {
  --bcp-douyin-action-gap: 8px;
  --bcp-douyin-hover-trailing-space: 12px;
  align-items: center;
  backface-visibility: hidden;
  box-sizing: border-box;
  contain: layout style;
  column-gap: var(--bcp-douyin-action-gap);
  display: inline-flex;
  left: 0;
  margin: 0;
  max-width: none;
  min-width: 0;
  padding: 0 var(--bcp-douyin-hover-trailing-space) 0 0;
  pointer-events: auto !important;
  position: absolute;
  top: 0;
  transform-origin: left top;
  user-select: none;
  white-space: nowrap;
  will-change: transform;
  overflow: visible;
}

.bcp-douyin-dom-barrage {
  align-items: center;
  align-self: stretch;
  background: transparent;
  border: 0;
  border-radius: 6px;
  box-sizing: border-box;
  cursor: default;
  display: inline-flex;
  flex: 1 0 auto;
  margin: 0;
  min-width: 0;
  padding: 0;
  pointer-events: none !important;
  white-space: nowrap;
}

.bcp-douyin-dom-track[data-hovered='true'] > .bcp-douyin-dom-barrage,
.bcp-douyin-dom-track:focus-within > .bcp-douyin-dom-barrage {
  background: transparent;
  box-shadow: 0 0 0 3px var(--bcp-selection, #fd8101);
}

.bcp-douyin-dom-track[data-hovered='true'],
.bcp-douyin-dom-track:focus-within {
  z-index: 2;
}

.bcp-douyin-dom-content {
  align-items: center;
  align-self: stretch;
  box-sizing: border-box;
  display: inline-flex;
  flex: 0 0 auto;
  font: inherit;
  height: 100%;
  min-width: 0;
  overflow: visible;
  pointer-events: auto;
  white-space: nowrap;
}

/*
 * Keep the user's frame outside the rendered content. The gap prevents the
 * frame from covering text or image Emoji without changing barrage geometry.
 */
.bcp-douyin-dom-barrage[data-own='true'] .bcp-douyin-dom-content {
  background: color-mix(in srgb,
    var(--bcp-selection, #fd8101) 18%, transparent);
  border-radius: 7px;
  outline: 3px solid color-mix(in srgb,
    var(--bcp-selection, #fd8101) 96%, transparent);
  outline-offset: 3px;
}

/* The side chat keeps native interactions, but sent messages get a layout-neutral frame. */
[data-bcp-douyin-own-chat-content='true'] {
  background: rgb(255 91 52 / 14%) !important;
  border-radius: 7px !important;
  box-shadow: none !important;
  outline: 3px solid rgb(255 116 76 / 92%) !important;
  outline-offset: 3px !important;
}

/*
 * This column exists from the first rendered frame.  Hovering therefore never
 * changes the barrage's measured width or lane allocation.
 */
.bcp-douyin-dom-action {
  align-items: center;
  background: linear-gradient(0deg,
    var(--bcp-action-start, #fd8101),
    var(--bcp-action-end, #fd8101));
  border-radius: var(--bcp-capsule-radius, 16px);
  box-sizing: border-box;
  display: inline-flex;
  flex: 0 0 var(--bcp-douyin-action-space, 174px);
  flex-shrink: 0;
  height: var(--bcp-capsule-height, 40px);
  margin: 0;
  opacity: 0;
  overflow: hidden;
  padding: 0;
  pointer-events: none;
  position: relative;
  transition: opacity 90ms ease;
  visibility: hidden;
  width: var(--bcp-douyin-action-space, 174px);
  z-index: 3;
}

.bcp-douyin-dom-track[data-hovered='true'] > .bcp-douyin-dom-action,
.bcp-douyin-dom-track:focus-within > .bcp-douyin-dom-action,
.bcp-douyin-dom-track[data-sending='true'] > .bcp-douyin-dom-action {
  opacity: 1;
  pointer-events: auto;
  visibility: visible;
}

.bcp-douyin-dom-action[hidden] {
  display: none !important;
}

.bcp-douyin-dom-action-item {
  align-items: center;
  align-self: stretch;
  appearance: none;
  background: transparent;
  border: 0;
  box-sizing: border-box;
  color: var(--bcp-action-text, #fff);
  cursor: pointer;
  display: inline-flex;
  flex: 0 0 var(--bcp-capsule-item-width, 56px);
  font: 600 var(--bcp-capsule-item-font-size, 16px) / var(--bcp-capsule-item-line-height, 22px) "Inter", -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
  font-feature-settings: "ss01" on, "cv01" on;
  justify-content: center;
  min-width: var(--bcp-capsule-item-width, 56px);
  padding: 0 var(--bcp-capsule-item-padding, 12px);
  touch-action: manipulation;
  transition: background-color 140ms ease, transform 140ms ease;
  white-space: nowrap;
  width: var(--bcp-capsule-item-width, 56px);
}

.bcp-douyin-dom-action-item[data-action="plus-one"] {
  font-size: var(--bcp-capsule-plus-font-size, 14.4px);
}

.bcp-douyin-dom-action-item:hover {
  background: rgb(255 255 255 / 12%);
}

.bcp-douyin-dom-action-item:active {
  transform: scale(.96);
}

.bcp-douyin-dom-action-item:focus-visible {
  outline: 3px solid color-mix(in srgb,
    var(--bcp-focus-ring, #fd8101) 55%, transparent);
  outline-offset: -3px;
}

.bcp-douyin-dom-action-divider {
  align-self: center;
  background: #fff;
  border-radius: 999px;
  box-sizing: border-box;
  display: block;
  flex: 0 0 var(--bcp-capsule-divider-width, 2px);
  height: var(--bcp-capsule-divider-height, 24px);
  max-width: var(--bcp-capsule-divider-width, 2px);
  min-width: var(--bcp-capsule-divider-width, 2px);
  pointer-events: none;
  width: var(--bcp-capsule-divider-width, 2px);
}

.bcp-douyin-dom-track[data-sending='true']
  > .bcp-douyin-dom-action
  > .bcp-douyin-dom-action-item[data-action="plus-one"] {
  color: color-mix(in srgb, var(--bcp-action-text, #fff) 55%, transparent);
  cursor: wait;
}

.bcp-douyin-card {
  align-items: center;
  -webkit-backdrop-filter: blur(20px) saturate(180%);
  backdrop-filter: blur(20px) saturate(180%);
  background:
    linear-gradient(145deg,
      color-mix(in srgb, var(--bcp-panel-text, #fff) 12%, transparent),
      transparent 50%),
    color-mix(in srgb, var(--bcp-panel-background, #fd8101) 58%, transparent);
  border: 1px solid color-mix(in srgb,
    var(--bcp-panel-text, #fff) 20%, transparent);
  border-radius: 16px;
  box-shadow:
    0 12px 36px rgb(0 0 0 / 28%),
    inset 0 1px 0 rgb(255 255 255 / 24%),
    inset 0 -1px 0 rgb(0 0 0 / 10%);
  box-sizing: border-box;
  color: var(--bcp-panel-text, #fff);
  display: flex;
  font: 500 13px/1.25 -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
  gap: 8px;
  max-width: min(420px, calc(100vw - 16px));
  min-height: 38px;
  opacity: 0;
  padding: 5px 6px 5px 10px;
  pointer-events: auto !important;
  position: fixed;
  touch-action: none;
  transition: opacity 90ms ease;
  user-select: none;
  z-index: 2147483647;
}

.bcp-douyin-card.is-visible {
  opacity: 1;
}

.bcp-douyin-card::before {
  bottom: -8px;
  content: "";
  position: absolute;
  top: -8px;
  width: 16px;
}

.bcp-douyin-card[data-side="left"]::before {
  left: 100%;
}

.bcp-douyin-card[data-side="right"] {
  flex-direction: row-reverse;
}

.bcp-douyin-card[data-side="right"]::before {
  right: 100%;
}

.bcp-douyin-card[hidden] {
  display: none !important;
}

.bcp-douyin-preview {
  align-items: center;
  display: inline-flex;
  flex: 0 1 auto;
  gap: 2px;
  max-width: 220px;
  min-width: 0;
  overflow: hidden;
  white-space: nowrap;
}

.bcp-douyin-preview-text {
  display: inline-block;
  flex: 0 0 auto;
  font-size: 14px;
  line-height: 1.2;
  max-width: 210px;
  overflow: hidden;
  text-overflow: ellipsis;
  text-shadow: 0 1px 2px rgb(0 0 0 / 80%);
  white-space: nowrap;
}

.bcp-douyin-preview-image {
  display: inline-block;
  flex: 0 0 20px;
  height: 20px;
  object-fit: contain;
  width: 20px;
}

.bcp-douyin-actions {
  align-items: center;
  background: linear-gradient(0deg,
    var(--bcp-action-start, #fd8101),
    var(--bcp-action-end, #fd8101));
  border-radius: var(--bcp-capsule-radius, 16px);
  box-sizing: border-box;
  display: inline-flex;
  flex: 0 0 auto;
  height: var(--bcp-capsule-height, 40px);
  overflow: hidden;
  padding: 0;
  pointer-events: auto !important;
  width: max-content;
}

.bcp-douyin-actions[hidden] {
  display: none !important;
}

.bcp-douyin-action-item {
  appearance: none;
  align-items: center;
  align-self: stretch;
  background: transparent;
  border: 0;
  box-sizing: border-box;
  color: var(--bcp-action-text, #fff);
  cursor: pointer;
  display: inline-flex;
  flex: 0 0 var(--bcp-capsule-item-width, 56px);
  font: 600 var(--bcp-capsule-item-font-size, 16px) / var(--bcp-capsule-item-line-height, 22px) "Inter", -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
  font-feature-settings: "ss01" on, "cv01" on;
  justify-content: center;
  min-width: var(--bcp-capsule-item-width, 56px);
  padding: 0 var(--bcp-capsule-item-padding, 12px);
  pointer-events: auto !important;
  transition: background-color 140ms ease, transform 140ms ease;
  white-space: nowrap;
  width: var(--bcp-capsule-item-width, 56px);
}

.bcp-douyin-action-item[data-action="plus-one"] {
  font-size: var(--bcp-capsule-plus-font-size, 14.4px);
}

.bcp-douyin-action-item:hover {
  background: rgb(255 255 255 / 12%);
}

.bcp-douyin-action-item:active {
  transform: scale(.96);
}

.bcp-douyin-action-item:focus-visible {
  outline: 3px solid color-mix(in srgb,
    var(--bcp-focus-ring, #fd8101) 55%, transparent);
  outline-offset: -3px;
}

.bcp-douyin-action-item:disabled {
  cursor: wait;
  filter: grayscale(.2);
  opacity: .65;
}

.bcp-douyin-action-divider {
  align-self: center;
  background: #fff;
  border-radius: 999px;
  box-sizing: border-box;
  display: block;
  flex: 0 0 var(--bcp-capsule-divider-width, 2px);
  height: var(--bcp-capsule-divider-height, 24px);
  max-width: var(--bcp-capsule-divider-width, 2px);
  min-width: var(--bcp-capsule-divider-width, 2px);
  pointer-events: none;
  width: var(--bcp-capsule-divider-width, 2px);
}

.bcp-douyin-toast {
  align-items: center;
  background: var(--bcp-panel-background, #fd8101);
  border: 0;
  border-radius: 16px;
  box-sizing: border-box;
  color: var(--bcp-action-text, #fff);
  display: flex;
  font: 600 16px/22px "Inter", -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
  font-feature-settings: "ss01" on, "cv01" on;
  height: auto;
  justify-content: center;
  left: 50%;
  min-height: 36px;
  min-width: 84px;
  max-width: min(560px, calc(100vw - 32px));
  opacity: 0;
  overflow: visible;
  overflow-wrap: anywhere;
  padding: 9px 16px;
  pointer-events: none;
  position: fixed;
  top: 28px;
  transform: translate(-50%, -8px) scale(.96);
  transition: opacity 180ms ease, transform 180ms ease;
  text-align: center;
  white-space: normal;
  width: max-content;
  z-index: 2147483647;
}

.bcp-douyin-toast.is-visible {
  opacity: 1;
  transform: translate(-50%, 0) scale(1);
}

.bcp-douyin-toast--success {
  background: var(--bcp-success, #27ae60);
}

.bcp-douyin-toast--warning {
  background: var(--bcp-warning, #e6a000);
}

.bcp-douyin-toast--error {
  background: var(--bcp-error, #ff4747);
}

@media (prefers-reduced-motion: reduce) {
  .bcp-douyin-dom-action,
  .bcp-douyin-card,
  .bcp-douyin-toast {
    transition: none;
  }
}
</style>
