<template>
  <div class="send-statistics" aria-labelledby="send-statistics-title">
    <div class="send-statistics-heading">
      <div>
        <strong id="send-statistics-title">{{ t('sendStatisticsTitle') }}</strong>
        <p>{{ t('sendStatisticsDescription') }}</p>
      </div>
      <div class="send-statistics-actions">
        <button type="button" :disabled="busy || !store" @click="refresh">{{ t('sendStatisticsRefresh') }}</button>
        <button type="button" :disabled="busy || !store" @click="exportStatistics">{{ t('sendStatisticsExport') }}</button>
        <button type="button" :disabled="busy || !store || totalCount === 0" @click="clearStatistics">{{ t('sendStatisticsClear') }}</button>
      </div>
    </div>
    <p v-if="lastFailureAt" class="send-statistics-warning" role="status">{{ t('sendStatisticsWriteWarning', formatSecond(lastFailureAt / 1000)) }}</p>
    <p v-if="hasUpdates" role="status">{{ t('sendStatisticsUpdates') }}</p>
    <div class="send-statistics-summary">
      <span><small>{{ t('sendStatisticsTotal') }}</small><b>{{ totalCount }}</b></span>
      <span><small>{{ t('sendStatisticsToday') }}</small><b>{{ todayCount }}</b></span>
      <span v-for="platform in platforms" :key="platform.id">
        <small>{{ t(platform.label) }}</small><b>{{ platformCount(platform.id) }}</b>
      </span>
    </div>
    <div v-if="dailyCounts.length" class="send-statistics-daily">
      <span>{{ t('sendStatisticsDailyUtc') }}</span>
      <div class="send-statistics-daily-list">
        <div v-for="day in dailyCounts" :key="day.date">
          <time :datetime="day.date">{{ day.date }}</time><b>{{ day.count }}</b>
        </div>
      </div>
    </div>
    <form class="send-statistics-filters" @submit.prevent="applyFilters">
      <label>{{ t('sendStatisticsFrom') }}<input v-model="draft.from" type="date" :max="draft.to || undefined"></label>
      <label>{{ t('sendStatisticsTo') }}<input v-model="draft.to" type="date" :min="draft.from || undefined"></label>
      <label>{{ t('sendStatisticsPlatform') }}<select v-model="draft.platform"><option value="">{{ t('sendStatisticsAllPlatforms') }}</option><option v-for="platform in platforms" :key="platform.id" :value="platform.id">{{ t(platform.label) }}</option></select></label>
      <label>{{ t('sendStatisticsRoom') }}<input v-model="draft.room" type="search" maxlength="300"></label>
      <label>{{ t('sendStatisticsSearch') }}<input v-model="draft.text" type="search" maxlength="1000"></label>
      <button type="submit" :disabled="busy || !store">{{ t('sendStatisticsApply') }}</button>
    </form>
    <p>{{ t('sendStatisticsFilterHelp') }}</p>
    <div v-if="recentSeconds.length" class="send-statistics-recent">
      <span>{{ t('sendStatisticsRecent') }}</span>
      <div v-for="bucket in recentSeconds" :key="bucket.key">
        <div class="send-statistics-second">
          <time :datetime="new Date(bucket.second * 1000).toISOString()">{{ formatSecond(bucket.second) }}</time>
          <b>×{{ bucket.events.length }}</b>
        </div>
        <ul class="send-statistics-messages">
          <li v-for="event in bucket.events" :key="event.id">
            <span class="send-statistics-text" :class="{ 'is-unavailable': !event.text }">{{ event.text === undefined ? t('sendStatisticsLegacyText') : (event.text || t('sendStatisticsNoText')) }}</span>
            <small>{{ eventRoom(event) }} · {{ t(event.confirmation === 'platform' ? 'sendStatisticsPlatformConfirmed' : event.confirmation === 'page' ? 'sendStatisticsPageConfirmed' : 'sendStatisticsConfirmationLegacy') }}</small>
          </li>
        </ul>
      </div>
    </div>
    <p v-else-if="!unavailableDays.length" class="send-statistics-empty">{{ t(store ? (totalCount ? 'sendStatisticsNoMatches' : 'sendStatisticsEmpty') : 'sendStatisticsUnavailable') }}</p>
    <nav v-if="store" class="send-statistics-pagination" :aria-label="t('sendStatisticsPages')">
      <button type="button" :disabled="busy || !cursors.length" @click="previousPage">{{ t('sendStatisticsPrevious') }}</button>
      <span>{{ t('sendStatisticsPage', String(cursors.length + 1)) }}</span>
      <button type="button" :disabled="busy || !nextCursor" @click="nextPage">{{ t('sendStatisticsNext') }}</button>
    </nav>
    <p v-if="unavailableDays.length" class="send-statistics-warning">
      {{ t('sendStatisticsPartial', String(unavailableDays.length)) }}
    </p>
  </div>
</template>

<script setup lang="ts">
import { computed, onMounted, onUnmounted, reactive, ref } from 'vue'
import { t } from '../composables/settings-language'
import type { PlatformId } from '../core/types'
import { createSendStatisticsStore } from '../features/send-statistics/store'
import { SEND_STATISTICS_MESSAGE, type ConfirmedSend, type StatisticsCursor, type StatisticsFilter } from '../features/send-statistics/types'

const emit = defineEmits<{ status: [message: string, kind: 'error' | 'saved'] }>()
const busy = ref(false)
const events = ref<ConfirmedSend[]>([])
const unavailableDays = ref<string[]>([])
const store = globalThis.chrome?.storage?.local
  ? createSendStatisticsStore(chrome.storage.local) : null
const platforms: { id: PlatformId; label: string }[] = [
  { id: 'bilibili', label: 'platformBilibili' },
  { id: 'douyin', label: 'platformDouyin' },
  { id: 'douyu', label: 'platformDouyu' },
  { id: 'huya', label: 'platformHuya' },
]
const summary = ref<Awaited<ReturnType<NonNullable<typeof store>['summary']>>>({ days: [], unavailableDays: [], lastFailureAt: undefined })
const lastFailureAt = computed(() => summary.value.lastFailureAt)
const totalCount = computed(() => summary.value.days.reduce((sum, day) => sum + day.total, 0))
const todayCount = computed(() => summary.value.days.find((day) => day.date === new Date().toISOString().slice(0, 10))?.total || 0)
const dailyCounts = computed(() => summary.value.days.map((day) => ({ date: day.date, count: day.total })).reverse())
const draft = reactive({ from: '', to: '', platform: '', room: '', text: '' })
const filter = ref<StatisticsFilter>({})
const cursors = ref<(StatisticsCursor | undefined)[]>([])
const currentCursor = ref<StatisticsCursor>()
const nextCursor = ref<StatisticsCursor>()
const hasUpdates = ref(false)
const recentSeconds = computed(() => {
  const buckets = new Map<number, { key: string; second: number; events: ConfirmedSend[] }>()
  for (const event of events.value) {
    const bucket = buckets.get(event.sentAtSec)
    if (bucket) bucket.events.push(event)
    else buckets.set(event.sentAtSec, {
      key: String(event.sentAtSec), second: event.sentAtSec, events: [event],
    })
  }
  return [...buckets.values()].sort((a, b) => b.second - a.second)
})
function eventRoom(event: ConfirmedSend): string {
  return `${t(platforms.find((item) => item.id === event.platform)!.label)} · ${event.roomId}`
}
function platformCount(platform: PlatformId): number {
  return summary.value.days.reduce((sum, day) => sum + (day.platforms[platform] || 0), 0)
}
function formatSecond(second: number): string {
  return new Date(second * 1_000).toLocaleString(undefined, {
    year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit',
    minute: '2-digit', second: '2-digit', hour12: false,
  })
}
function failureText(error: unknown): string {
  if (error instanceof Error && error.message === 'invalid-send-statistics-filter') return t('sendStatisticsInvalidDates')
  if (error instanceof Error && /^(invalid|missing)-send-statistics-/.test(error.message)) {
    return t('sendStatisticsDataInvalid')
  }
  return t('sendStatisticsFailed')
}
async function applyFilters(): Promise<void> {
  if (draft.from && draft.to && draft.from > draft.to) {
    emit('status', t('sendStatisticsInvalidDates'), 'error')
    return
  }
  filter.value = { ...draft, platform: (draft.platform || undefined) as PlatformId | undefined }
  cursors.value = []
  currentCursor.value = undefined
  await refresh()
}
async function nextPage(): Promise<void> {
  if (!nextCursor.value) return
  cursors.value.push(currentCursor.value)
  currentCursor.value = nextCursor.value
  await refresh()
}
async function previousPage(): Promise<void> {
  currentCursor.value = cursors.value.pop()
  await refresh()
}
async function refresh(): Promise<void> {
  if (!store) return
  busy.value = true
  try {
    const totals = await store.summary()
    const result = await store.query(filter.value, currentCursor.value)
    summary.value = totals
    events.value = result.events
    nextCursor.value = result.nextCursor
    unavailableDays.value = [...new Set([...totals.unavailableDays, ...result.unavailableDays])]
    hasUpdates.value = false
  } catch (error) {
    emit('status', failureText(error), 'error')
  } finally {
    busy.value = false
  }
}
async function exportStatistics(): Promise<void> {
  if (!store) return
  busy.value = true
  let url = ''
  try {
    const data = await store.export(filter.value)
    url = URL.createObjectURL(new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' }))
    const anchor = document.createElement('a')
    anchor.href = url
    anchor.download = `danmaku-echo-send-statistics-${new Date().toISOString().slice(0, 10)}.json`
    document.body.append(anchor)
    anchor.click()
    anchor.remove()
    emit('status', t(data.unavailableDays.length ? 'sendStatisticsExportedPartial' : 'sendStatisticsExported'), 'saved')
  } catch (error) {
    emit('status', failureText(error), 'error')
  } finally {
    if (url) setTimeout(() => URL.revokeObjectURL(url), 1_000)
    busy.value = false
  }
}
async function clearStatistics(): Promise<void> {
  if (!store) return
  if (!window.confirm(t('sendStatisticsClearFilteredConfirm'))) return
  busy.value = true
  try {
    const response = await chrome.runtime.sendMessage({ type: SEND_STATISTICS_MESSAGE, action: 'clear', filter: filter.value })
      .catch(() => { throw new Error('statistics-worker-unavailable') })
    if (!response?.ok) throw new Error(response?.error || 'statistics-clear-failed')
    cursors.value = []
    currentCursor.value = undefined
    await refresh()
    emit('status', t('sendStatisticsCleared'), 'saved')
  } catch (error) {
    emit('status', error instanceof Error && error.message === 'statistics-worker-unavailable'
      ? t('sendStatisticsWorkerUnavailable') : failureText(error), 'error')
  } finally {
    busy.value = false
  }
}
const storageChanged = (changes: Record<string, chrome.storage.StorageChange>, area: string) => {
  if (area === 'local' && Object.keys(changes).some((key) => key.startsWith('danmakuEchoSendStatistics'))) hasUpdates.value = true
}
onMounted(() => {
  if (store) void refresh()
  globalThis.chrome?.storage?.onChanged?.addListener(storageChanged)
})
onUnmounted(() => globalThis.chrome?.storage?.onChanged?.removeListener(storageChanged))
</script>

<style scoped>
.send-statistics { padding: 16px; }
.send-statistics-heading, .send-statistics-actions { display: flex; align-items: center; gap: 12px; flex-wrap: wrap; }
.send-statistics-heading { justify-content: space-between; }
strong { font-size: 14px; font-weight: 500; }
p { margin: 6px 0 0; color: var(--text-secondary); font-size: 12px; line-height: 1.6; }
button { min-height: 34px; padding: 8px 12px; border: 1px solid var(--border); border-radius: 6px; background: var(--surface); color: inherit; cursor: pointer; font: inherit; font-size: 12px; }
button:hover:not(:disabled) { border-color: #fd8101; background: var(--surface-muted); }
button:focus-visible { outline: 2px solid #fd8101; outline-offset: 2px; }
button:disabled { opacity: .5; cursor: default; }
.send-statistics-summary { display: flex; gap: 20px; flex-wrap: wrap; padding: 16px 0; border-bottom: 1px solid var(--border); }
.send-statistics-summary > span { display: grid; gap: 4px; min-width: 55px; }
small, .send-statistics-recent > span { color: var(--text-secondary); font-size: 12px; }
b { font-size: 17px; font-weight: 600; font-variant-numeric: tabular-nums; }
.send-statistics-recent { padding-top: 14px; }
.send-statistics-daily { padding-top: 14px; }
.send-statistics-daily > span { color: var(--text-secondary); font-size: 12px; }
.send-statistics-daily-list { max-height: 150px; overflow: auto; margin-top: 6px; }
.send-statistics-daily-list > div { display: flex; justify-content: space-between; padding: 6px 0; border-bottom: 1px solid var(--border); font-size: 12px; }
.send-statistics-daily-list b { font-size: 12px; }
.send-statistics-recent > div { padding: 10px 0; border-bottom: 1px solid var(--border); font-size: 12px; }
.send-statistics-second { display: flex; gap: 12px; justify-content: space-between; align-items: baseline; }
time { min-width: 150px; font-variant-numeric: tabular-nums; }
.send-statistics-messages { list-style: none; padding: 0; margin: 8px 0 0; max-height: 240px; overflow: auto; }
.send-statistics-messages li { display: grid; gap: 4px; padding: 4px 0; overflow-wrap: anywhere; line-height: 1.6; }
.send-statistics-text { white-space: pre-wrap; }
.send-statistics-text.is-unavailable { color: var(--text-secondary); }
.send-statistics-recent b { font-size: 12px; }
.send-statistics-empty { padding-top: 10px; }
.send-statistics-warning { color: #9b6000; }
.send-statistics-filters { display: flex; flex-wrap: wrap; align-items: end; gap: 10px; margin-top: 16px; }
.send-statistics-filters label { display: grid; gap: 5px; font-size: 12px; min-width: 0; flex: 1 1 140px; }
.send-statistics-filters input, .send-statistics-filters select { width: 100%; min-width: 0; min-height: 34px; box-sizing: border-box; padding: 6px 8px; border: 1px solid var(--border); border-radius: 6px; color: inherit; background: var(--surface); font: inherit; }
.send-statistics-filters :is(input, select):focus-visible { outline: 2px solid #fd8101; outline-offset: 2px; }
.send-statistics-pagination { display: flex; justify-content: flex-end; align-items: center; gap: 12px; margin-top: 12px; font-size: 12px; }
</style>
