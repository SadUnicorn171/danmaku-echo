<template>
  <div class="favorites-demo" :aria-label="t('settingsFavoritesPreviewAria')">
    <div class="favorites-demo__switch" role="group" :aria-label="t('favoritesPreviewMode')">
      <button v-for="mode in modes" :key="mode.key" type="button" :aria-pressed="view === mode.key" @click="view = mode.key">
        {{ t(mode.label) }}
      </button>
      <small>{{ t('favoritesPreviewExample') }}</small>
    </div>
    <div v-if="view === 'list'" class="favorites-demo__list">
      <p>{{ t('favoritesCurrent') }} · {{ t('favoritesCount', '3') }}</p>
      <ol>
        <li v-for="(message, index) in messages.slice(0, 3)" :key="message">
          <kbd>{{ index + 1 }}</kbd>
          <span>{{ t(message) }}</span>
          <span class="favorites-demo__send">{{ t('favoritesSend') }}</span>
        </li>
      </ol>
      <p class="favorites-demo__hint">{{ t('favoritesPreviewListHint') }}</p>
    </div>
    <div v-else class="favorites-demo__wheel-view">
      <div class="favorites-demo__wheel" :aria-label="t('favoritesWheelAria')">
        <svg class="favorites-demo__pie" viewBox="0 0 360 360" aria-hidden="true">
          <path v-for="(_, index) in wheelLabels" :key="index" :d="radialSectorPath(-90 + index * 45, 8)" :class="{ 'is-selected': index === 0 }" />
        </svg>
        <span v-for="(message, index) in wheelLabels" :key="message" :class="['favorites-demo__option', { 'is-selected': index === 0, 'is-navigation': index > 5 }]" :style="position(index)">
          <span>{{ t(message) }}</span>
        </span>
        <span class="favorites-demo__center" aria-hidden="true"><i /><i /></span>
      </div>
      <p class="favorites-demo__hint">{{ t('favoritesPreviewWheelHint') }}</p>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref } from 'vue'
import { radialSectorPath } from '../features/favorites/radial-geometry'
import { t } from '../composables/settings-language'

const view = ref<'list' | 'wheel'>('list')
const modes = [{ key: 'list', label: 'favoritesPreviewList' }, { key: 'wheel', label: 'favoritesPreviewWheel' }] as const
const messages = ['favoritesExampleGreat', 'favoritesExampleCheer', 'favoritesExampleWatch', 'favoritesExampleYes', 'favoritesExampleAmazing', 'favoritesExampleHere']
const wheelLabels = [...messages, 'favoritesRadialOther', 'favoritesRadialMore']
function position(index: number) {
  const angle = (-90 + index * 45) * Math.PI / 180
  return { left: `${50 + Math.cos(angle) * 36.67}%`, top: `${50 + Math.sin(angle) * 36.67}%` }
}
</script>

<style scoped>
.favorites-demo { min-width: 0; padding: 20px; border-radius: 16px; background: var(--surface-soft, #f7f5f2); }
.favorites-demo__switch { display: flex; align-items: center; flex-wrap: wrap; gap: 6px; }
.favorites-demo__switch button { min-height: 36px; padding: 6px 12px; border: 0; border-radius: 18px; background: transparent; color: var(--text-secondary); font: inherit; font-size: 13px; cursor: pointer; }
.favorites-demo__switch button[aria-pressed="true"] { background: var(--accent-soft); color: #853f00; font-weight: 600; }
.favorites-demo__switch button:hover { background: #fff; }
.favorites-demo__switch button:focus-visible { outline: 2px solid #853f00; outline-offset: 2px; }
.favorites-demo__switch small { margin-left: auto; color: var(--text-secondary); font-size: 11px; }
.favorites-demo__list > p { margin: 20px 0 10px; color: var(--text-secondary); font-size: 13px; }
.favorites-demo__list ol { padding: 0; margin: 0; list-style: none; }
.favorites-demo__list li { display: flex; align-items: center; gap: 12px; min-height: 60px; padding: 12px 0; border-top: 1px solid var(--border); font-size: 14px; }
.favorites-demo__list li > span:not(.favorites-demo__send) { flex: 1; overflow-wrap: anywhere; }
.favorites-demo__list kbd { color: var(--text-secondary); font: inherit; font-size: 12px; }
.favorites-demo__send { padding: 6px 14px; border-radius: 18px; background: var(--accent); color: var(--text); font-size: 12px; white-space: nowrap; }
.favorites-demo__wheel { position: relative; width: min(100%, 300px); aspect-ratio: 1; margin: 18px auto 0; }
.favorites-demo__pie { position: absolute; inset: 0; width: 100%; height: 100%; }
.favorites-demo__pie path { fill: rgb(36 26 20 / 80%); }
.favorites-demo__pie path.is-selected { fill: var(--accent); }
.favorites-demo__option { position: absolute; display: grid; place-items: center; width: 23.33%; aspect-ratio: 1; padding: 7px; background: transparent; color: #fff; transform: translate(-50%, -50%); font-size: 11px; text-align: center; }
.favorites-demo__option > span { display: -webkit-box; overflow: hidden; -webkit-box-orient: vertical; -webkit-line-clamp: 2; overflow-wrap: anywhere; }
.favorites-demo__option.is-selected { color: #241a14; }
.favorites-demo__center { position: absolute; inset: 39.44%; display: flex; align-items: center; justify-content: center; gap: 7px; border-radius: 50%; background: var(--accent); }
.favorites-demo__center i { width: 6px; height: 14px; border-radius: 6px; background: #fff; }
.favorites-demo__hint { margin: 18px 0 0; color: var(--text-secondary); font-size: 12px; line-height: 1.6; }
.favorites-demo__wheel-view > p { text-align: center; }
@media (max-width: 400px) { .favorites-demo { padding: 16px; } .favorites-demo__switch button { padding-inline: 8px; } }
</style>
