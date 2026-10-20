<template>
  <aside class="sidebar" :aria-label="t('settingsNavigation')">
    <div class="brand">
      <img class="brand__mark" src="/assets/icons/icon-128.png" alt="">
      <span class="brand__copy">
        <strong>{{ t('settingsBrandName') }}</strong>
        <small id="version">v{{ version }}</small>
      </span>
    </div>

    <div class="language-switch" role="group" aria-label="界面语言 / Interface language">
      <button type="button" lang="zh-CN" :aria-pressed="language === 'zh-CN'"
        :disabled="languageSaving" @click="emit('language', 'zh-CN')">中文</button>
      <button type="button" lang="en" :aria-pressed="language === 'en'"
        :disabled="languageSaving" @click="emit('language', 'en')">English</button>
    </div>

    <nav class="nav-list">
      <a
        :class="['nav-item', { 'is-active': activeSection === 'general-settings' }]"
        href="#general-settings"
        :aria-current="activeSection === 'general-settings' ? 'location' : undefined"
        @click.prevent="emit('navigate', 'general-settings')"
      >
        <img class="nav-item__icon" src="/assets/icons/settings.svg" alt="" aria-hidden="true">
        <span>{{ t('settingsGeneral') }}</span>
      </a>
      <a
        :class="['nav-item', { 'is-active': activeSection === 'repeat-reminder-settings' }]"
        href="#repeat-reminder-settings"
        :aria-current="activeSection === 'repeat-reminder-settings' ? 'location' : undefined"
        @click.prevent="emit('navigate', 'repeat-reminder-settings')"
      >
        <img class="nav-item__icon" src="/assets/icons/radar.svg" alt="" aria-hidden="true">
        <span>{{ t('settingsRepeatReminder') }}</span>
      </a>
      <a
        :class="['nav-item', { 'is-active': activeSection === 'platform-connections' }]"
        href="#platform-connections"
        :aria-current="activeSection === 'platform-connections' ? 'location' : undefined"
        @click.prevent="emit('navigate', 'platform-connections')"
      >
        <img class="nav-item__icon" src="/assets/icons/live-room.svg" alt="" aria-hidden="true">
        <span>{{ t('settingsPlatforms') }}</span>
      </a>
      <a
        :class="['nav-item', { 'is-active': activeSection === 'side-chat-capsule' }]"
        href="#side-chat-capsule"
        :aria-current="activeSection === 'side-chat-capsule' ? 'location' : undefined"
        @click.prevent="emit('navigate', 'side-chat-capsule')"
      >
        <img class="nav-item__icon" src="/assets/icons/chat.svg" alt="" aria-hidden="true">
        <span>{{ t('settingsSideCapsule') }}</span>
      </a>
      <a
        :class="['nav-item', { 'is-active': activeSection === 'native-danmaku-capsule' }]"
        href="#native-danmaku-capsule"
        :aria-current="activeSection === 'native-danmaku-capsule' ? 'location' : undefined"
        @click.prevent="emit('navigate', 'native-danmaku-capsule')"
      >
        <img class="nav-item__icon" src="/assets/icons/capsule.svg" alt="" aria-hidden="true">
        <span>{{ t('settingsNativeCapsule') }}</span>
      </a>
      <a :class="['nav-item', { 'is-active': activeSection === 'douyin-native-settings' }]"
        href="#douyin-native-settings" :aria-current="activeSection === 'douyin-native-settings' ? 'location' : undefined"
        @click.prevent="emit('navigate', 'douyin-native-settings')">
        <img class="nav-item__icon" src="/assets/icons/settings.svg" alt="" aria-hidden="true">
        <span>{{ t('settingsDouyinNativeTitle') }}</span>
      </a>
      <a
        :class="['nav-item', { 'is-active': activeSection === 'platform-colors' }]"
        href="#platform-colors"
        :aria-current="activeSection === 'platform-colors' ? 'location' : undefined"
        @click.prevent="emit('navigate', 'platform-colors')"
      >
        <img class="nav-item__icon" src="/assets/icons/colors.svg" alt="" aria-hidden="true">
        <span>{{ t('settingsColors') }}</span>
      </a>
      <a
        :class="['nav-item', { 'is-active': activeSection === 'favorites-guide' }]"
        href="#favorites-guide"
        :aria-current="activeSection === 'favorites-guide' ? 'location' : undefined"
        @click.prevent="emit('navigate', 'favorites-guide')"
      >
        <img class="nav-item__icon" src="/assets/icons/favorite-filled.svg" alt="" aria-hidden="true">
        <span>{{ t('settingsFavorites') }}</span>
      </a>
      <a class="nav-item" href="https://github.com/SadUnicorn171/danmaku-echo" target="_blank" rel="noreferrer">
        <img class="nav-item__icon" src="/assets/icons/about.svg" alt="" aria-hidden="true">
        <span>{{ t('settingsAbout') }}</span>
      </a>
    </nav>
  </aside>
</template>

<script setup lang="ts">
import type { SettingsSectionId } from '../core/settings-sections'
import { t, type SettingsLanguage } from '../composables/settings-language'

defineProps<{
  activeSection: SettingsSectionId
  version: string
  language: SettingsLanguage
  languageSaving: boolean
}>()

const emit = defineEmits<{
  navigate: [section: SettingsSectionId]
  language: [language: SettingsLanguage]
}>()
</script>

<style scoped lang="scss">
.sidebar {
  background: var(--surface);
  display: flex;
  flex: 0 0 248px;
  flex-direction: column;
  padding: 32px 20px;
  overflow-y: auto;
  position: relative;
  z-index: 2;
}
.brand { display: flex; align-items: center; gap: 12px; margin-bottom: 26px; padding: 0 12px; }
.brand__mark { display: block; width: 36px; height: 36px; object-fit: contain; }
.brand__copy { display: flex; flex-direction: column; gap: 4px; min-width: 0; }
.brand__copy strong { font-size: 19px; font-weight: 600; line-height: 26px; letter-spacing: -.02em; }
.brand__copy small { color: var(--text-secondary); font-size: 11px; font-variant-numeric: tabular-nums; }
.language-switch { display: flex; gap: 2px; align-self: flex-start; margin: 0 0 26px; padding: 4px; border-radius: 24px; background: var(--canvas); }
.language-switch button { min-height: 32px; padding: 6px 14px; border: 0; border-radius: 20px; background: transparent; color: var(--text-secondary); font: inherit; font-size: 12px; cursor: pointer; transition: background-color 140ms ease, color 140ms ease, transform 140ms ease; }
.language-switch button[aria-pressed="true"] { background: var(--surface); color: var(--accent-text); font-weight: 600; }
.language-switch button:hover:not(:disabled) { color: var(--text); }
.language-switch button:active:not(:disabled) { transform: scale(.97); }
.language-switch button:disabled { cursor: wait; opacity: .6; }
.nav-list { display: flex; flex-direction: column; gap: 6px; }
.nav-item { display: flex; align-items: center; min-height: 46px; padding: 12px 16px; gap: 12px; border-radius: 14px; color: var(--text-secondary); font-size: 14px; line-height: 22px; text-decoration: none; transition: background-color 140ms ease, color 140ms ease; }
.nav-item:hover { background: var(--canvas); color: var(--text); }
.nav-item:focus-visible { outline: 2px solid var(--accent); outline-offset: -2px; }
.nav-item.is-active { background: var(--accent-soft); color: var(--accent-text); font-weight: 600; }
.nav-item__icon { flex: 0 0 18px; width: 18px; height: 18px; object-fit: contain; opacity: .7; filter: grayscale(1); }
.nav-item.is-active .nav-item__icon { opacity: 1; }
.nav-item:last-child { margin-top: 24px; }
@media (max-width: 1100px) {
  .sidebar { flex-basis: 218px; padding: 28px 14px; }
  .brand { padding: 0 8px; }
  .brand__copy strong { font-size: 17px; }
}
@media (max-width: 700px) {
  .sidebar { display: grid; grid-template-columns: minmax(0, 1fr) auto; flex: 0 0 auto; gap: 16px; padding: 18px 16px 10px; overflow: visible; }
  .brand { margin: 0; padding: 0; gap: 8px; min-width: 0; }
  .brand__mark { width: 30px; height: 30px; }
  .brand__copy strong { font-size: 15px; line-height: 20px; }
  .language-switch { margin: 0; align-self: center; }
  .language-switch button { padding: 6px 10px; }
  .nav-list { grid-column: 1 / -1; flex-direction: row; overflow-x: auto; min-width: 0; padding: 2px 0; scrollbar-width: thin; }
  .nav-item { flex: 0 0 auto; min-height: 40px; padding: 9px 14px; border-radius: 22px; font-size: 12px; }
  .nav-item__icon { display: none; }
  .nav-item:last-child { margin-top: 0; }
}
</style>
