<template>
  <li
    :class="{
      'is-pinned': item.pinned,
      'is-draggable': customSorting,
      'is-dragging': dragging,
      'is-drop-before': dropPosition === 'before',
      'is-drop-after': dropPosition === 'after'
    }"
    @dragover="emit('dragOver', item.id, $event)"
    @drop="emit('drop', item.id, $event)"
  >
    <img
      v-if="customSorting"
      class="bcp-favorites-drag-handle"
      src="../../../public/assets/icons/drag.svg"
      alt=""
      draggable="true"
      :title="t('favoritesDragHandle')"
      aria-hidden="true"
      @dragstart.stop="emit('dragStart', item.id, $event)"
      @dragend="emit('dragEnd')"
    >
    <span v-if="customSorting" class="bcp-favorites-visually-hidden">
      {{ t("favoritesDragHint") }}
    </span>
    <span
      v-if="shortcutIndex >= 0 && shortcutIndex < 9"
      class="bcp-favorites-shortcut"
      :aria-label="t('favoritesShortcutAria', String(shortcutIndex + 1))"
    >
      <kbd>{{ shortcutIndex + 1 }}</kbd>
    </span>

    <span class="bcp-favorites-item-copy">
      <strong class="bcp-favorites-text" :title="item.text">{{ item.text }}</strong>
      <span v-if="item.tags.length" class="bcp-favorites-tags" :aria-label="t('favoritesTagsAria')">
        <span v-for="tag in item.tags" :key="tag">#{{ tag }}</span>
      </span>
      <span class="bcp-favorites-meta">
        <span :class="['bcp-favorites-scope', { 'is-local': item.belongsToCurrentRoom }]">
          {{ item.belongsToCurrentRoom ? t('favoritesScopeCurrent') : t('favoritesScopeOther') }}
        </span>
        <span :title="collectedAtTitle">{{ t('favoritesCollectedAt', collectedAtLabel) }}</span>
        <span>{{ t('favoritesSentCount', String(item.totalSendCount)) }}</span>
      </span>
    </span>

    <span class="bcp-favorites-item-actions">
      <span v-if="customSorting" class="bcp-favorites-order-actions">
        <button
          type="button"
          class="bcp-favorites-secondary"
          :aria-label="t('favoritesMoveUpAria', item.text)"
          :title="t('favoritesMoveUp')"
          @click="emit('move', item.id, 'up')"
        >&#8593;</button>
        <button
          type="button"
          class="bcp-favorites-secondary"
          :aria-label="t('favoritesMoveDownAria', item.text)"
          :title="t('favoritesMoveDown')"
          @click="emit('move', item.id, 'down')"
        >&#8595;</button>
      </span>
      <button
        type="button"
        :class="['bcp-favorites-secondary', 'bcp-favorites-pin', { 'is-active': item.pinned }]"
        :aria-pressed="item.pinned"
        :aria-label="t(item.pinned ? 'favoritesUnpinAria' : 'favoritesPinAria', item.text)"
        :title="t(item.pinned ? 'favoritesUnpin' : 'favoritesPin')"
        @click="emit('pin', item.id, !item.pinned)"
      >{{ t(item.pinned ? "favoritesUnpin" : "favoritesPin") }}</button>
      <button
        type="button"
        class="bcp-favorites-secondary bcp-favorites-tags-button"
        :aria-expanded="editingTags"
        :aria-label="t('favoritesEditTagsAria', item.text)"
        :title="t('favoritesEditTags')"
        @click="openTags"
      >{{ t("favoritesTags") }}</button>
      <button
        v-if="!item.belongsToCurrentRoom"
        type="button"
        class="bcp-favorites-secondary"
        :aria-label="t('favoritesAddRoomAria', item.text)"
        :title="t('favoritesAddRoom')"
        @click="emit('addToRoom', item.id)"
      >
        {{ t("favoritesAddRoom") }}
      </button>
      <button
        type="button"
        class="bcp-favorites-send"
        :aria-label="t('favoritesSendAria', item.text)"
        :title="t('favoritesSendTitle', item.text)"
        @click="emit('send', item.id)"
      >
        {{ t("favoritesSend") }}
      </button>
      <button
        type="button"
        :class="['bcp-favorites-remove', { 'is-confirming': pendingRemoveId === item.id }]"
        :aria-label="pendingRemoveId === item.id ? t('favoritesConfirmRemoveAria', item.text) : t('favoritesRemoveAria', item.text)"
        :title="pendingRemoveId === item.id ? t('favoritesConfirmRemoveTitle') : t('favoritesRemoveTitle')"
        @click="emit('requestRemove', item.id)"
      >
        {{ pendingRemoveId === item.id ? t('favoritesConfirm') : t('favoritesRemove') }}
      </button>
    </span>
    <form v-if="editingTags" class="bcp-favorites-tag-editor" @submit.prevent="saveTags">
      <label>
        <span class="bcp-favorites-visually-hidden">{{ t("favoritesTagsInputAria") }}</span>
        <input
          ref="tagsInput"
          v-model="tagDraft"
          maxlength="200"
          :placeholder="t('favoritesTagsPlaceholder')"
          @keydown.esc.prevent="editingTags = false"
        >
      </label>
      <button type="submit" class="bcp-favorites-send">{{ t("favoritesTagsSave") }}</button>
      <button type="button" class="bcp-favorites-secondary" @click="editingTags = false">
        {{ t("favoritesTagsCancel") }}
      </button>
    </form>
  </li>
</template>

<script setup lang="ts">
import { computed, nextTick, ref } from "vue";
import type { FavoriteDisplayItem } from "./types";
import { t, uiLocale } from "../../core/i18n";

const props = defineProps<{
  item: FavoriteDisplayItem;
  customSorting: boolean;
  dragging: boolean;
  dropPosition: "" | "after" | "before";
  pendingRemoveId: string;
  shortcutIndex: number;
}>();

const emit = defineEmits<{
  addToRoom: [id: string];
  dragEnd: [];
  dragOver: [id: string, event: DragEvent];
  dragStart: [id: string, event: DragEvent];
  drop: [id: string, event: DragEvent];
  move: [id: string, direction: "down" | "up"];
  pin: [id: string, pinned: boolean];
  requestRemove: [id: string];
  send: [id: string];
  tags: [id: string, tags: string[]];
}>();

const editingTags = ref(false);
const tagDraft = ref("");
const tagsInput = ref<HTMLInputElement | null>(null);

function openTags(): void {
  editingTags.value = !editingTags.value;
  tagDraft.value = props.item.tags.join(", ");
  if (editingTags.value) void nextTick(() => tagsInput.value?.focus());
}

function saveTags(): void {
  const tags = tagDraft.value.split(/[,，;；\n]+/)
    .map((tag) => tag.trim())
    .filter(Boolean);
  emit("tags", props.item.id, tags);
  editingTags.value = false;
}

const collectedAt = computed(() => new Date(props.item.sortTimestamp));
const collectedAtLabel = computed(() => {
  const now = new Date();
  return collectedAt.value.getFullYear() === now.getFullYear()
    ? new Intl.DateTimeFormat(uiLocale(), { month: "2-digit", day: "2-digit" }).format(collectedAt.value)
    : new Intl.DateTimeFormat(uiLocale(), { year: "numeric", month: "2-digit", day: "2-digit" }).format(collectedAt.value);
});
const collectedAtTitle = computed(() => new Intl.DateTimeFormat(uiLocale(), {
  dateStyle: "medium",
  timeStyle: "short"
}).format(collectedAt.value));
</script>
