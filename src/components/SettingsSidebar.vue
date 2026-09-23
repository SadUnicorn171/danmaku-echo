<template>
  <aside class="sidebar" :aria-label="t('settingsNavigation')">
    <div class="brand">
      <img class="brand__mark" src="/assets/icons/icon-128.png" alt="">
      <span class="brand__copy">
        <strong>{{ t('extensionName') }}</strong>
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
  align-items: stretch;
  background: var(--surface);
  border-right: 1px solid var(--border);
  display: flex;
  flex: 0 0 240px;
  flex-direction: column;
  padding: 24px 17px 24px 16px;
  position: relative;
  z-index: 2;
}

.brand {
  align-items: center;
  display: flex;
  gap: 12px;
  margin-bottom: 16px;
  padding: 0 8px;
}

.brand__mark {
  border-radius: 4px;
  display: block;
  flex: 0 0 32px;
  height: 32px;
  object-fit: contain;
  width: 32px;
}

.brand__copy {
  align-items: flex-start;
  display: flex;
  flex-direction: column;
}

.brand__copy strong {
  font-size: 16px;
  font-weight: 500;
  line-height: 20px;
  white-space: nowrap;
}

.brand__copy small {
  color: var(--text-secondary);
  font-family: Bahnschrift, "Segoe UI", sans-serif;
  font-size: 11px;
  font-variant-numeric: tabular-nums;
  line-height: 16px;
}

.nav-list {
  display: flex;
  flex: 1;
  flex-direction: column;
  gap: 2px;
}

.language-switch {
  display: flex;
  gap: 2px;
  align-self: flex-start;
  margin: 0 8px 20px;
  padding: 2px;
  border: 1px solid var(--border);
  border-radius: 6px;
  background: var(--surface-muted);
}

.language-switch button {
  min-height: 28px;
  padding: 3px 12px;
  border: 0;
  border-radius: 4px;
  background: transparent;
  color: var(--text-secondary);
  font: inherit;
  font-size: 12px;
  cursor: pointer;
  transition: background-color 140ms ease, color 140ms ease;
}

.language-switch button[aria-pressed="true"] {
  background: var(--surface);
  color: #9a4d00;
  box-shadow: 0 1px 2px rgb(0 0 0 / 8%);
}

.language-switch button:hover:not(:disabled) {
  color: var(--text);
}

.language-switch button:disabled {
  cursor: wait;
}

.nav-item {
  align-items: center;
  border-radius: 6px;
  color: var(--text-secondary);
  display: flex;
  font-size: 14px;
  gap: 12px;
  line-height: 20px;
  min-height: 36px;
  padding: 8px 12px;
  text-decoration: none;
  transition: background-color 140ms ease, color 140ms ease;
}

.nav-item:hover {
  background: rgb(228 226 226 / 32%);
  color: var(--text);
}

.nav-item:focus-visible {
  outline: 2px solid rgb(39 174 96 / 38%);
  outline-offset: -2px;
}

.nav-item.is-active {
  background: rgb(228 226 226 / 50%);
  color: var(--text);
  font-weight: 600;
}

.nav-item__icon {
  display: block;
  flex: 0 0 16px;
  height: 16px;
  object-fit: contain;
  opacity: 0.72;
  transition: opacity 140ms ease, transform 140ms ease;
  width: 16px;
}

.nav-item:hover .nav-item__icon,
.nav-item.is-active .nav-item__icon {
  opacity: 1;
  transform: scale(1.04);
}

@media (max-width: 900px) {
  .sidebar {
    flex-basis: 200px;
    padding-left: 12px;
    padding-right: 12px;
  }
}
</style>
