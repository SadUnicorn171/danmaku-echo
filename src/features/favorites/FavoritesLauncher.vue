<template>
  <div
    v-if="state.mode !== 'closed'"
    :class="['bcp-favorites-layer', `is-${state.mode}`]"
    data-bcp-favorites-owned="true"
    @pointerdown.self="emit('close')"
  >
    <section
      v-if="state.mode === 'panel'"
      ref="panelRef"
      class="bcp-favorites-panel"
      data-bcp-favorites-owned="true"
      role="dialog"
      aria-modal="true"
      aria-labelledby="bcp-favorites-title"
      tabindex="-1"
      @pointerdown.stop
      @keydown.ctrl.k.prevent="focusSearch"
    >
      <header class="bcp-favorites-header">
        <div class="bcp-favorites-brand">
          <span class="bcp-favorites-brand-mark" aria-hidden="true">+1</span>
          <span class="bcp-favorites-heading">
            <strong id="bcp-favorites-title">{{ t("settingsFavorites") }}</strong>
          </span>
        </div>
        <button
          type="button"
          class="bcp-favorites-icon-button bcp-favorites-close"
          :aria-label="t('favoritesClosePanel')"
          :title="t('favoritesCloseEsc')"
          @click="emit('close')"
        >
          &#10005;
        </button>
      </header>

      <div class="bcp-favorites-subtitle">{{ t("favoritesSubtitle") }}</div>

      <div class="bcp-favorites-divider" aria-hidden="true" />

      <div class="bcp-favorites-room">
        <span class="bcp-favorites-room-icon" aria-hidden="true">
          <img src="../../../public/assets/icons/LiveStreamRoom.svg" alt="" style="height: 32px;width: 32px;">
        </span>
        <span class="bcp-favorites-room-copy">
          <strong :title="state.room.roomName">{{ state.room.roomName }}</strong>
        </span>
        <span class="bcp-favorites-room-count">
          <strong>{{ t("favoritesCount", String(state.currentCount)) }}</strong>
        </span>
      </div>

      <div class="bcp-favorites-divider" aria-hidden="true" />

      <div class="bcp-favorites-toolbar">
        <nav class="bcp-favorites-tabs" :aria-label="t('favoritesScopeAria')" role="tablist">
          <button
            v-for="tab in tabs"
            :key="tab.key"
            type="button"
            role="tab"
            :data-view="tab.key"
            :aria-selected="state.view === tab.key"
            :class="{ 'is-active': state.view === tab.key }"
            @click="emit('changeView', tab.key)"
          >
            <span>{{ tab.label }}</span>
            <small>{{ tabCount(tab.key) }}</small>
          </button>
        </nav>

        <label class="bcp-favorites-search">
          <svg viewBox="0 0 24 24" aria-hidden="true">
            <circle cx="10.75" cy="10.75" r="5.75" />
            <path d="m15 15 4 4" />
          </svg>
          <span class="bcp-favorites-visually-hidden">{{ t("favoritesSearchAria") }}</span>
          <input
            ref="searchRef"
            :value="state.search"
            type="search"
            :placeholder="selectedRoom ? t('favoritesSearchRoom') : t('favoritesSearchAll')"
            autocomplete="off"
            @input="emit('search', ($event.target as HTMLInputElement).value)"
          >
          <button
            v-if="state.search"
            type="button"
            :aria-label="t('favoritesClearSearch')"
            :title="t('favoritesClearSearch')"
            @click="emit('search', '')"
          >
            <svg viewBox="0 0 24 24" aria-hidden="true"><path d="m8 8 8 8M16 8l-8 8" /></svg>
          </button>
          <kbd v-else>Ctrl K</kbd>
        </label>
      </div>

      <div class="bcp-favorites-divider" aria-hidden="true" />

      <div class="bcp-favorites-list-heading">
        <span class="bcp-favorites-list-title">
          <button
            v-if="selectedRoom"
            type="button"
            class="bcp-favorites-room-back"
            :aria-label="t('favoritesBackToRooms')"
            :title="t('favoritesBackToRoomsEsc')"
            @click="emit('backToRooms')"
          >
            &#8249;
          </button>
          <strong :title="selectedRoom?.roomName">{{ selectedRoom?.roomName || activeTab.label }}</strong>
          <small>{{ listSummary }}</small>
        </span>
        <label class="bcp-favorites-sort">
          <span>{{ t("favoritesSort") }}</span>
          <select
            :value="state.sort"
            :aria-label="t('favoritesSortAria')"
            @change="emit('sort', ($event.target as HTMLSelectElement).value as FavoriteSort)"
          >
            <option value="send-count">{{ t("favoritesSortSendCount") }}</option>
            <option value="custom">{{ t("favoritesSortCustom") }}</option>
            <option value="time-desc">{{ t("favoritesSortTimeDesc") }}</option>
            <option value="time-asc">{{ t("favoritesSortTimeAsc") }}</option>
          </select>
          <svg viewBox="0 0 24 24" aria-hidden="true"><path d="m8 10 4 4 4-4" /></svg>
        </label>
      </div>

      <div v-if="state.loading" class="bcp-favorites-loading" role="status" :aria-label="t('favoritesLoading')">
        <span v-for="index in 3" :key="index" class="bcp-favorites-skeleton" />
      </div>

      <div v-else-if="!hasResults" class="bcp-favorites-empty" role="status">
        <span class="bcp-favorites-empty-mark" aria-hidden="true">
          <svg viewBox="0 0 24 24">
            <path d="M7.5 4.25h9a1 1 0 0 1 1 1v14.1l-5.5-3.2-5.5 3.2V5.25a1 1 0 0 1 1-1Z" />
            <path d="m9.5 10.5 1.6 1.6 3.4-3.4" />
          </svg>
        </span>
        <strong>{{ emptyState.title }}</strong>
        <p>{{ emptyState.detail }}</p>
        <button
          v-if="emptyState.action"
          type="button"
          @click="emit('changeView', emptyState.action.view)"
        >
          {{ emptyState.action.label }}
        </button>
      </div>

      <ol
        v-else-if="state.view === 'current'"
        class="bcp-favorites-list"
        role="tabpanel"
        :aria-label="state.sort === 'custom' ? t('favoritesFixedOrderAria') : undefined"
      >
        <FavoriteItemRow
          v-for="(item, index) in state.items"
          :key="item.id"
          :item="item"
          :pending-remove-id="pendingRemoveId"
          :shortcut-index="index"
          :custom-sorting="state.sort === 'custom'"
          :dragging="draggingId === item.id"
          :drop-position="dropTargetId === item.id ? dropPosition : ''"
          @add-to-room="emit('addToRoom', $event)"
          @drag-end="finishDrag"
          @drag-over="previewDrag"
          @drag-start="startDrag"
          @drop="dropFavorite"
          @move="(id, direction) => emit('move', id, direction)"
          @pin="(id, pinned) => emit('pin', id, pinned)"
          @request-remove="confirmRemove"
          @send="emit('send', $event)"
          @tags="(id, tags) => emit('tags', id, tags)"
        />
      </ol>

      <ul v-else-if="!selectedRoom" class="bcp-favorites-groups" role="tabpanel">
        <li
          v-for="group in visibleGroups"
          :key="group.roomKey"
          class="bcp-favorites-group"
        >
          <button
            type="button"
            class="bcp-favorites-group-toggle"
            :aria-label="t('favoritesEnterRoomAria', group.roomName)"
            @click="emit('selectRoom', group.roomKey)"
          >
            <span class="bcp-favorites-group-copy">
              <strong :title="group.roomName">{{ group.roomName }}</strong>
              <small>
                {{ t('favoritesGroupMeta', [group.isCurrentRoom ? t('favoritesCurrentRoom') : platformLabel(group.platform), String(group.items.length), String(group.totalSendCount)]) }}
              </small>
            </span>
            <span class="bcp-favorites-group-count">{{ group.items.length }}</span>
            <span class="bcp-favorites-group-chevron" aria-hidden="true">
              <svg viewBox="0 0 24 24"><path d="m9 6 6 6-6 6" /></svg>
            </span>
          </button>
        </li>
      </ul>

      <ol
        v-else
        class="bcp-favorites-list bcp-favorites-room-items"
        role="tabpanel"
        :aria-label="state.sort === 'custom' ? t('favoritesFixedOrderAria') : undefined"
      >
        <FavoriteItemRow
          v-for="(item, index) in selectedItems"
          :key="`${selectedRoom.roomKey}:${item.id}`"
          :item="item"
          :pending-remove-id="pendingRemoveId"
          :shortcut-index="index"
          :custom-sorting="state.sort === 'custom'"
          :dragging="draggingId === item.id"
          :drop-position="dropTargetId === item.id ? dropPosition : ''"
          @add-to-room="emit('addToRoom', $event)"
          @drag-end="finishDrag"
          @drag-over="previewDrag"
          @drag-start="startDrag"
          @drop="dropFavorite"
          @move="(id, direction) => emit('move', id, direction)"
          @pin="(id, pinned) => emit('pin', id, pinned)"
          @request-remove="confirmRemove"
          @send="emit('send', $event)"
          @tags="(id, tags) => emit('tags', id, tags)"
        />
      </ol>

      <div class="bcp-favorites-divider" aria-hidden="true" />

      <footer class="bcp-favorites-footer">
        <span class="bcp-favorites-shortcut-group">
          <kbd>Alt+Q</kbd>
          <span>{{ t("favoritesShortcutOpen") }}</span>
        </span>
        <span class="bcp-favorites-shortcut-group">
          <kbd>Alt+Q</kbd>
          <span>{{ t("favoritesShortcutWheel") }}</span>
        </span>
        <span class="bcp-favorites-shortcut-group">
          <kbd>1-9</kbd>
          <span>{{ t("favoritesShortcutSend") }}</span>
        </span>
        <span class="bcp-favorites-shortcut-group">
          <kbd>Esc</kbd>
          <span>{{ selectedRoom ? t('favoritesBackToRoom') : t('favoritesClose') }}</span>
        </span>
      </footer>
    </section>

    <div
      v-else-if="state.mode === 'radial'"
      class="bcp-favorites-radial"
      :style="{ left: `${state.centerX}px`, top: `${state.centerY}px` }"
      data-bcp-favorites-owned="true"
      role="menu"
      :aria-label="t('favoritesWheelAria')"
    >
      <div class="bcp-favorites-radial-hint" aria-hidden="true">
        {{ t("favoritesWheelHint") }}
      </div>
      <div
        :class="[
          'bcp-favorites-radial-center',
          { 'has-selection': selectedOption },
          selectedOption ? `is-${selectedOption.kind}` : 'is-idle'
        ]"
        :style="radialBotStyle"
      >
        <span class="bcp-favorites-radial-bot" aria-hidden="true">
          <span class="bcp-favorites-radial-bot-eyes">
            <span
              :key="selectedOption?.key || 'idle'"
              class="bcp-favorites-radial-bot-expression"
            >
              <span class="bcp-favorites-radial-bot-eye" />
              <span class="bcp-favorites-radial-bot-eye" />
            </span>
          </span>
        </span>
      </div>
      <button
        v-for="option in state.radialOptions"
        :key="option.key"
        type="button"
        :class="['bcp-favorites-radial-item', `is-${option.kind}`, {
          'is-selected': option.key === state.selectedRadialKey
        }]"
        :style="{
          left: `${Math.cos(option.angle * Math.PI / 180) * 132}px`,
          top: `${Math.sin(option.angle * Math.PI / 180) * 132}px`
        }"
        tabindex="-1"
      >
        <span>{{ option.label }}</span>
        <small>{{ option.detail }}</small>
      </button>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, nextTick, ref, watch, type CSSProperties } from "vue";
import FavoriteItemRow from "./FavoriteItemRow.vue";
import type { PlatformId } from "../../core/types";
import type { FavoriteDisplayItem, FavoriteSort, FavoriteView } from "./types";
import type { FavoritesLauncherState } from "./launcher";
import { t } from "../../core/i18n";

const props = defineProps<{ state: FavoritesLauncherState }>();
const emit = defineEmits<{
  addToRoom: [id: string];
  changeView: [view: FavoriteView];
  close: [];
  move: [id: string, direction: "down" | "up"];
  pin: [id: string, pinned: boolean];
  remove: [id: string];
  reorder: [id: string, targetId: string, placement: "after" | "before"];
  search: [value: string];
  send: [id: string];
  selectRoom: [roomKey: string];
  sort: [sort: FavoriteSort];
  tags: [id: string, tags: string[]];
  backToRooms: [];
}>();

const panelRef = ref<HTMLElement | null>(null);
const searchRef = ref<HTMLInputElement | null>(null);
const pendingRemoveId = ref("");
const draggingId = ref("");
const dropTargetId = ref("");
const dropPosition = ref<"" | "after" | "before">("");
const tabs: Array<{ key: FavoriteView; label: string }> = [
  { key: "current", label: t("favoritesCurrent") },
  { key: "other", label: t("favoritesOtherRooms") },
  { key: "all", label: t("favoritesAll") }
];

const activeTab = computed(() => tabs.find((tab) => tab.key === props.state.view) || tabs[0]);
const selectedRoom = computed(() => props.state.groups
  .find((group) => group.roomKey === props.state.selectedRoomKey));
const normalizedSearch = computed(() => props.state.search.replace(/\s+/g, " ").trim().toLowerCase());
const visibleGroups = computed(() => {
  if (!normalizedSearch.value) return props.state.groups;
  return props.state.groups.filter((group) => group.roomName.toLowerCase().includes(normalizedSearch.value)
    || group.items.some((item) => item.normalizedText.includes(normalizedSearch.value)
      || item.tags.some((tag) => tag.toLowerCase().includes(normalizedSearch.value))));
});
const selectedItems = computed(() => {
  const group = selectedRoom.value;
  if (!group) return [];
  if (!normalizedSearch.value || group.roomName.toLowerCase().includes(normalizedSearch.value)) {
    return group.items;
  }
  return group.items.filter((item) => item.normalizedText.includes(normalizedSearch.value)
    || item.tags.some((tag) => tag.toLowerCase().includes(normalizedSearch.value)));
});
const sortableItems = computed(() => props.state.view === "current"
  ? props.state.items
  : selectedItems.value);
const selectedOption = computed(() => props.state.radialOptions
  .find((option) => option.key === props.state.selectedRadialKey));
const radialBotStyle = computed<CSSProperties>(() => ({
  "--bcp-favorites-gaze-angle": `${props.state.radialGazeAngle - 90}deg`,
  "--bcp-favorites-gaze-x": `${props.state.radialGazeX}px`,
  "--bcp-favorites-gaze-y": `${props.state.radialGazeY}px`
}));
const hasResults = computed(() => props.state.view === "current"
  ? Boolean(props.state.items.length)
  : selectedRoom.value
    ? Boolean(selectedItems.value.length)
    : Boolean(visibleGroups.value.length));
const listSummary = computed(() => props.state.search
  ? props.state.view === "current"
    ? t("favoritesMatches", String(props.state.items.length))
    : selectedRoom.value
      ? t("favoritesMatches", String(selectedItems.value.length))
      : t("favoritesRoomMatches", String(visibleGroups.value.length))
  : props.state.view === "current"
    ? t("favoritesCurrentSummary")
    : selectedRoom.value
      ? t("favoritesSelectedRoomSummary", String(selectedRoom.value.items.length))
    : props.state.view === "other"
      ? t("favoritesOtherSummary", String(props.state.groups.length))
      : t("favoritesAllSummary", String(props.state.groups.length)));
const emptyState = computed(() => {
  if (props.state.search) {
    return {
      title: t("favoritesNoMatches"),
      detail: selectedRoom.value
        ? t("favoritesNoMatchesRoomDetail")
        : t("favoritesNoMatchesDetail"),
      action: null
    };
  }
  if (props.state.view === "current") {
    return {
      title: t("favoritesCurrentEmpty"),
      detail: t("favoritesCurrentEmptyDetail"),
      action: props.state.otherCount
        ? { label: t("favoritesViewOther", String(props.state.otherCount)), view: "other" as const }
        : null
    };
  }
  if (props.state.view === "other") {
    return {
      title: t("favoritesOtherEmpty"),
      detail: t("favoritesOtherEmptyDetail"),
      action: { label: t("favoritesBackCurrent"), view: "current" as const }
    };
  }
  return {
    title: t("favoritesAllEmpty"),
    detail: t("favoritesAllEmptyDetail"),
    action: null
  };
});

function tabCount(view: FavoriteView): number {
  if (view === "current") return props.state.currentCount;
  if (view === "other") return props.state.otherCount;
  return props.state.totalCount;
}

function confirmRemove(id: string): void {
  if (pendingRemoveId.value === id) {
    pendingRemoveId.value = "";
    emit("remove", id);
    return;
  }
  pendingRemoveId.value = id;
}

function platformLabel(platform: PlatformId): string {
  if (platform === "bilibili") return t("platformBilibili");
  if (platform === "douyin") return t("platformDouyin");
  if (platform === "douyu") return t("platformDouyu");
  return t("platformHuya");
}

function focusSearch(): void {
  searchRef.value?.focus({ preventScroll: true });
}

function finishDrag(): void {
  draggingId.value = "";
  dropTargetId.value = "";
  dropPosition.value = "";
}

function sortableItem(id: string): FavoriteDisplayItem | undefined {
  return sortableItems.value.find((item) => item.id === id);
}

function dragPlacement(event: DragEvent): "after" | "before" | "" {
  const element = event.currentTarget;
  if (!(element instanceof HTMLElement)) return "";
  const bounds = element.getBoundingClientRect();
  return event.clientY < bounds.top + bounds.height / 2 ? "before" : "after";
}

function startDrag(id: string, event: DragEvent): void {
  if (props.state.sort !== "custom" || !event.dataTransfer) return;
  draggingId.value = id;
  event.dataTransfer.effectAllowed = "move";
  event.dataTransfer.setData("text/plain", id);
}

function previewDrag(targetId: string, event: DragEvent): void {
  const sourceId = draggingId.value || event.dataTransfer?.getData("text/plain") || "";
  const source = sortableItem(sourceId);
  const target = sortableItem(targetId);
  if (!source || !target || source.id === target.id || source.pinned !== target.pinned) {
    dropTargetId.value = "";
    dropPosition.value = "";
    return;
  }
  const placement = dragPlacement(event);
  if (!placement) return;
  event.preventDefault();
  if (event.dataTransfer) event.dataTransfer.dropEffect = "move";
  if (dropTargetId.value === targetId && dropPosition.value === placement) return;
  dropTargetId.value = targetId;
  dropPosition.value = placement;
}

function dropFavorite(targetId: string, event: DragEvent): void {
  const sourceId = draggingId.value || event.dataTransfer?.getData("text/plain") || "";
  const source = sortableItem(sourceId);
  const target = sortableItem(targetId);
  const placement = dropTargetId.value === targetId
    ? dropPosition.value
    : dragPlacement(event);
  if (source && target && source.id !== target.id && source.pinned === target.pinned && placement) {
    event.preventDefault();
    emit("reorder", source.id, target.id, placement);
  }
  finishDrag();
}

watch(() => [props.state.mode, props.state.view, props.state.search,
  props.state.sort, props.state.selectedRoomKey], () => {
  pendingRemoveId.value = "";
  finishDrag();
});

watch(() => props.state.mode, async (mode) => {
  if (mode !== "panel") return;
  await nextTick();
  panelRef.value?.focus({ preventScroll: true });
});
</script>
