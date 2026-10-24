<template>
  <div
    v-if="state.mode !== 'closed'"
    :class="['bcp-favorites-layer', `is-${state.mode}`, { 'is-closing': state.closing, 'is-submitted': state.mode === 'radial' && state.radialPhase === 'sending' }]"
    @click.capture="guardClosing"
    data-bcp-favorites-owned="true"
    @pointerdown.self="sortOpen ? closeSortMenu(true) : emit('close')"
  >
    <section
      v-if="state.mode === 'panel'"
      ref="panelRef"
      class="bcp-favorites-panel"
      data-bcp-favorites-owned="true"
      :aria-busy="state.loading"
      role="dialog"
      aria-modal="true"
      aria-labelledby="bcp-favorites-title"
      tabindex="-1"
      @pointerdown.stop="handlePanelPointerDown"
      @keydown.tab="trapPanelFocus"
      @keydown.ctrl.k.prevent="focusSearch"
    >
      <header class="bcp-favorites-header">
        <div class="bcp-favorites-brand">
          <svg class="bcp-favorites-brand-mark" viewBox="0 0 24 24" aria-hidden="true"><path d="M6 4h12v17l-6-4-6 4Z" /></svg>
          <span class="bcp-favorites-heading">
            <strong id="bcp-favorites-title">{{ t("settingsFavorites") }}</strong>
            <span class="bcp-favorites-subtitle">{{ t("favoritesSubtitle") }}</span>
          </span>
        </div>
        <button
          type="button"
          class="bcp-favorites-icon-button bcp-favorites-close"
          :aria-label="t('favoritesClosePanel')"
          :title="t('favoritesCloseEsc')"
          @click="emit('close')"
        >
          <svg viewBox="0 0 24 24" aria-hidden="true"><path d="m6 6 12 12M18 6 6 18" /></svg>
        </button>
      </header>

      <div class="bcp-favorites-divider" aria-hidden="true" />

      <div class="bcp-favorites-room">
        <span class="bcp-favorites-room-icon" aria-hidden="true">
          <svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="2" /><path d="M7 7a7 7 0 0 0 0 10M17 7a7 7 0 0 1 0 10M4 4a11 11 0 0 0 0 16M20 4a11 11 0 0 1 0 16" /></svg>
        </span>
        <span class="bcp-favorites-room-copy">
          <small>{{ t("favoritesCurrentRoom") }}</small>
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
            <svg viewBox="0 0 24 24" aria-hidden="true"><path d="m14 6-6 6 6 6" /></svg>
          </button>
          <strong :title="selectedRoom?.roomName">{{ selectedRoom?.roomName || activeTab.label }}</strong>
          <small>{{ listSummary }}</small>
        </span>
        <div ref="sortRootRef" :class="['bcp-favorites-sort', { 'is-open': sortOpen }]">
          <span id="bcp-favorites-sort-label">{{ t("favoritesSort") }}</span>
          <button
            ref="sortTriggerRef"
            type="button"
            class="bcp-favorites-sort-trigger"
            aria-haspopup="listbox"
            :aria-expanded="sortOpen"
            aria-controls="bcp-favorites-sort-options"
            :aria-label="`${t('favoritesSortAria')}：${selectedSortOption.label}`"
            @click="toggleSortMenu"
            @keydown.down.prevent="openSortMenu('current')"
            @keydown.up.prevent="openSortMenu('last')"
            @keydown.home.prevent="openSortMenu('first')"
            @keydown.end.prevent="openSortMenu('last')"
            @keydown.esc.stop="closeSortMenu(false)"
          >
            <span>{{ selectedSortOption.label }}</span>
            <svg viewBox="0 0 24 24" aria-hidden="true"><path d="m8 10 4 4 4-4" /></svg>
          </button>
          <Transition :css="false" @leave="leaveSort" @leave-cancelled="cancelSortLeave">
          <div v-if="sortOpen" class="bcp-favorites-sort-popover"
            :role="narrow ? 'dialog' : undefined" :aria-modal="narrow ? true : undefined"
            :aria-label="narrow ? t('favoritesSort') : undefined"
            @keydown="handleSortKeydown">
          <button class="bcp-favorites-sort-backdrop" type="button" tabindex="-1" :aria-label="t('favoritesClosePanel')" @click="closeSortMenu(true)" />
          <div
            id="bcp-favorites-sort-options"
            ref="sortMenuRef"
            class="bcp-favorites-sort-menu"
          >
            <header v-if="narrow" class="bcp-favorites-sheet-heading"><strong>{{ t('favoritesSort') }}</strong><button type="button" @click="closeSortMenu(true)">{{ t('favoritesClose') }}</button></header>
            <div role="listbox" aria-labelledby="bcp-favorites-sort-label">
            <button
              v-for="(option, index) in sortOptions"
              :id="`bcp-favorites-sort-${option.key}`"
              :key="option.key"
              type="button"
              role="option"
              :class="{ 'is-selected': option.key === state.sort }"
              :aria-selected="option.key === state.sort"
              :tabindex="index === activeSortIndex ? 0 : -1"
              @click="selectSort(option.key)"
              @focus="activeSortIndex = index"
              @keydown.down.prevent="focusSortOption(index + 1)"
              @keydown.up.prevent="focusSortOption(index - 1)"
              @keydown.home.prevent="focusSortOption(0)"
              @keydown.end.prevent="focusSortOption(sortOptions.length - 1)"
              @keydown.esc.stop.prevent="closeSortMenu(true)"
              @keydown.tab="!narrow && closeSortMenu(false)"
            >
              <span>{{ option.label }}</span>
              <svg viewBox="0 0 24 24" aria-hidden="true"><path d="m6.5 12.5 3.5 3.5 7.5-8" /></svg>
            </button>
          </div>
          </div>
          </div>
          </Transition>
        </div>
      </div>

      <div v-if="state.loading && !hasResults" class="bcp-favorites-loading" role="status" aria-busy="true" :aria-label="t('favoritesLoading')">
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
          v-for="(item, index) in state.items.slice(0, visibleLimit)"
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
          v-for="group in visibleGroups.slice(0, visibleLimit)"
          :key="group.roomKey"
          class="bcp-favorites-group"
          :data-motion-id="group.roomKey"
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
          v-for="(item, index) in selectedItems.slice(0, visibleLimit)"
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

      <button v-if="!state.loading && listSize > visibleLimit" type="button" class="bcp-favorites-load-more" @click="visibleLimit += 50">
        {{ t('favoritesLoadMore', String(listSize - visibleLimit)) }}
      </button>
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
      :class="['bcp-favorites-radial', `is-${state.radialPhase}`, { 'is-submitted': state.radialPhase !== 'idle' }]"
      :aria-busy="state.radialPhase === 'sending'"
      :style="{ left: `${state.centerX}px`, top: `${state.centerY}px`, scale: state.radialScale }"
      data-bcp-favorites-owned="true"
      role="menu"
      :aria-label="t('favoritesWheelAria')"
    >
      <div v-if="state.radialPhase === 'idle'" class="bcp-favorites-radial-hint" aria-hidden="true">
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
      <div class="bcp-favorites-radial-sectors" :aria-hidden="state.radialPhase !== 'idle'">
        <svg class="bcp-favorites-radial-pie" viewBox="0 0 360 360" aria-hidden="true">
          <path v-for="option in state.radialOptions" :key="option.key"
            :d="radialSectorPath(option.angle, state.radialOptions.length)"
            :class="{ 'is-selected': option.key === state.selectedRadialKey }" />
        </svg>
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
          :aria-label="option.detail"
          :title="option.detail"
          tabindex="-1"
        >
          <span>{{ option.label }}</span>
          <small>{{ option.detail }}</small>
        </button>
      </div>
      <span class="bcp-favorites-visually-hidden" role="status">{{ radialStatus }}</span>
      <div v-if="state.radialPhase === 'idle'" class="bcp-favorites-radial-caption">
        <strong role="status">{{ selectedOption?.detail || t("favoritesWheelCancel") }}</strong>
        <span v-if="state.radialPhase === 'idle'">{{ selectedOption ? t(selectedOption.kind === "favorite" ? "favoritesWheelReleaseSend" : "favoritesWheelReleaseOpen") : t("favoritesWheelFirstSix") }}</span>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { createUiAnimator } from '../../core/ui-motion';
import { useFavoritesMotion } from "./use-favorites-motion";
import { computed, nextTick, onMounted, onUnmounted, ref, watch, type CSSProperties } from "vue";
import FavoriteItemRow from "./FavoriteItemRow.vue";
import { radialSectorPath } from "./radial-geometry";
import type { PlatformId } from "../../core/types";
import type { FavoriteDisplayItem, FavoriteSort, FavoriteView } from "./types";
import type { FavoritesLauncherState } from "./launcher";
import { t } from "../../core/i18n";

const props = defineProps<{ state: FavoritesLauncherState }>();
const radialStatus = computed(() => {
  if (props.state.radialPhase === 'sending') return t('favoritesWheelSending');
  return '';
});
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
const sortRootRef = ref<HTMLElement | null>(null);
const sortTriggerRef = ref<HTMLButtonElement | null>(null);
const sortMenuRef = ref<HTMLElement | null>(null);
const sortOpen = ref(false);
const visibleLimit = ref(50);
const listSize = computed(() => props.state.view === "current" ? props.state.items.length
  : selectedRoom.value ? selectedItems.value.length : visibleGroups.value.length);
const activeSortIndex = ref(0);
const pendingRemoveId = ref("");
const draggingId = ref("");
const dropTargetId = ref("");
const dropPosition = ref<"" | "after" | "before">("");
const tabs: Array<{ key: FavoriteView; label: string }> = [
  { key: "current", label: t("favoritesCurrent") },
  { key: "other", label: t("favoritesOtherRooms") },
  { key: "all", label: t("favoritesAll") }
];
const sortOptions: Array<{ key: FavoriteSort; label: string }> = [
  { key: "send-count", label: t("favoritesSortSendCount") },
  { key: "custom", label: t("favoritesSortCustom") },
  { key: "time-desc", label: t("favoritesSortTimeDesc") },
  { key: "time-asc", label: t("favoritesSortTimeAsc") }
];

const activeTab = computed(() => tabs.find((tab) => tab.key === props.state.view) || tabs[0]);
const selectedSortOption = computed(() => sortOptions
  .find((option) => option.key === props.state.sort) || sortOptions[0]);
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

const sortAnimator = createUiAnimator();
onUnmounted(() => sortAnimator.destroy());
function cancelSortLeave(element: Element): void { sortAnimator.clear(); element.removeAttribute('inert'); }
function leaveSort(element: Element, done: () => void): void {
  const menu = element.querySelector<HTMLElement>('.bcp-favorites-sort-menu');
  element.setAttribute('inert', '');
  const animation = menu && sortAnimator.play(menu, [{ opacity: 1 }, { opacity: 0 }], narrow.value ? 160 : 140);
  if (animation) void animation.finished.then(done, done);
  else done();
}
const narrow = ref(false);
let narrowMedia: MediaQueryList | undefined;
function syncNarrow(): void { narrow.value = narrowMedia?.matches ?? false; }
onMounted(() => {
  narrowMedia = window.matchMedia?.('(max-width: 480px)');
  syncNarrow();
  narrowMedia?.addEventListener?.('change', syncNarrow);
});
onUnmounted(() => narrowMedia?.removeEventListener?.('change', syncNarrow));
let pressedRow: string | undefined;
function trapPanelFocus(event: KeyboardEvent): void {
  if (event.key !== 'Tab' || event.defaultPrevented) return;
  const root = narrow.value && sortOpen.value ? sortMenuRef.value : panelRef.value;
  const controls = Array.from(root?.querySelectorAll<HTMLElement>('button:not(:disabled), input:not(:disabled), [tabindex="0"]') ?? [])
    .filter(element => element.getClientRects().length && element.tabIndex >= 0);
  const active = (root?.getRootNode() as ShadowRoot | undefined)?.activeElement;
  const first = controls[0], last = controls.at(-1);
  if (!first) { event.preventDefault(); panelRef.value?.focus(); }
  else if (event.shiftKey && (active === first || active === panelRef.value)) { event.preventDefault(); last?.focus(); }
  else if (!event.shiftKey && (active === last || active === panelRef.value)) { event.preventDefault(); first.focus(); }
}
function guardClosing(event: MouseEvent): void {
  const row = (event.target as Element).closest<HTMLElement>('[data-motion-id]')?.dataset.motionId;
  const movedTarget = event.detail > 0 && pressedRow !== undefined && row !== pressedRow;
  pressedRow = undefined;
  if (props.state.closing || movedTarget) { event.preventDefault(); event.stopImmediatePropagation(); }
}
function handleSortKeydown(event: KeyboardEvent): void {
  if (event.key === 'Escape') {
    event.preventDefault(); event.stopPropagation(); closeSortMenu(true);
  } else if (event.key === 'Tab' && narrow.value) {
    event.preventDefault(); event.stopPropagation();
    const controls = Array.from(sortMenuRef.value?.querySelectorAll<HTMLButtonElement>('button') ?? []);
    const active = (sortMenuRef.value?.getRootNode() as ShadowRoot)?.activeElement;
    const index = controls.indexOf(active as HTMLButtonElement);
    controls[(index + (event.shiftKey ? -1 : 1) + controls.length) % controls.length]?.focus();
  }
}

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
  closeSortMenu(false);
  searchRef.value?.focus({ preventScroll: true });
}

function sortOptionElements(): HTMLButtonElement[] {
  if (!sortMenuRef.value) return [];
  return Array.from(sortMenuRef.value.querySelectorAll<HTMLButtonElement>("[role='option']"));
}

function focusSortOption(index: number): void {
  const options = sortOptionElements();
  if (!options.length) return;
  const nextIndex = (index + options.length) % options.length;
  activeSortIndex.value = nextIndex;
  options[nextIndex]?.focus({ preventScroll: true });
}

async function openSortMenu(preferred: "current" | "first" | "last" = "current"): Promise<void> {
  const selectedIndex = sortOptions.findIndex((option) => option.key === props.state.sort);
  activeSortIndex.value = preferred === "first"
    ? 0
    : preferred === "last"
      ? sortOptions.length - 1
      : Math.max(0, selectedIndex);
  sortOpen.value = true;
  await nextTick();
  focusSortOption(activeSortIndex.value);
}

function closeSortMenu(restoreFocus: boolean): void {
  if (!sortOpen.value) return;
  sortOpen.value = false;
  if (restoreFocus) {
    void nextTick(() => sortTriggerRef.value?.focus({ preventScroll: true }));
  }
}

function toggleSortMenu(): void {
  if (sortOpen.value) {
    closeSortMenu(false);
    return;
  }
  void openSortMenu();
}

function selectSort(sort: FavoriteSort): void {
  closeSortMenu(true);
  if (sort !== props.state.sort) emit("sort", sort);
}

function handlePanelPointerDown(event: PointerEvent): void {
  const target = event.target;
  pressedRow = target instanceof Element ? target.closest<HTMLElement>('[data-motion-id]')?.dataset.motionId : undefined;
  if (target instanceof Node && sortRootRef.value?.contains(target)) return;
  closeSortMenu(false);
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
  visibleLimit.value = 50;
  closeSortMenu(false);
  pendingRemoveId.value = "";
  finishDrag();
});

useFavoritesMotion(() => props.state, panelRef, visibleLimit);

watch(() => props.state.mode, async (mode) => {
  if (mode !== "panel") return;
  await nextTick();
  panelRef.value?.focus({ preventScroll: true });
});
</script>

<style scoped>
.bcp-favorites-load-more { display: block; margin: 10px auto; border: 0; padding: 8px 12px; background: transparent; color: inherit; cursor: pointer; font: inherit; font-size: 12px; text-decoration: underline; text-underline-offset: 3px; }
.bcp-favorites-load-more:focus-visible { outline: 2px solid var(--bcp-action-start, #fd8101); outline-offset: 2px; }
</style>
