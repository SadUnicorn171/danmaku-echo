<template>
  <header class="topbar">
    <h1>{{ activeSectionTitle }}</h1>
    <div class="topbar__actions">
      <div class="resource-links">
        <a
          href="https://github.com/SadUnicorn171/danmaku-echo#使用方法"
          target="_blank"
          rel="noreferrer"
          :title="t('settingsHelp')"
          :aria-label="t('settingsHelp')"
        >
          <img class="resource-links__icon" src="/assets/icons/about.svg" alt="" aria-hidden="true">
          <span>{{ t('settingsHelp') }}</span>
        </a>
        <button
          id="feedback-copy"
          class="feedback-copy"
          type="button"
          :title="t('settingsCopyFeedbackTitle')"
          :aria-label="t('settingsCopyFeedbackAria', feedbackEmail)"
          @click="emit('copy-feedback', feedbackEmail)"
        >
          <img class="resource-links__icon" src="/assets/icons/chat.svg" alt="" aria-hidden="true">
          <span>{{ t('settingsFeedback') }}</span>
          <code>{{ feedbackEmail }}</code>
        </button>
        <button
          id="diagnostics-copy"
          class="feedback-copy"
          type="button"
          :title="t('settingsCopyDiagnosticsTitle')"
          :aria-label="t('settingsCopyDiagnostics')"
          @click="emit('copy-diagnostics')"
        >
          <img class="resource-links__icon" src="/assets/icons/more-all.svg" alt="" aria-hidden="true">
          <span>{{ t('settingsCopyDiagnostics') }}</span>
        </button>
      </div>
      <label class="master-control" for="enabled">
        <span>{{ t('settingsGlobalStatus') }}</span>
        <input
          id="enabled"
          v-model="enabled"
          type="checkbox"
          role="switch"
          :aria-label="t('ariaEnableExtension')"
          @change="emit('save')"
        >
      </label>
    </div>
  </header>
</template>

<script setup lang="ts">
import { t } from '../composables/settings-language'

defineProps<{
  activeSectionTitle: string
  feedbackEmail: string
}>()

const enabled = defineModel<boolean>('enabled', { required: true })
const emit = defineEmits<{
  'copy-diagnostics': []
  'copy-feedback': [email: string]
  save: []
}>()
</script>

<style scoped lang="scss">
.topbar {
  align-items: center;
  background: var(--surface);
  border-bottom: 0;
  display: flex;
  flex: 0 0 92px;
  gap: 20px;
  min-height: 92px;
  justify-content: space-between;
  padding: 20px 48px;
  position: relative;
  z-index: 2;
}

.topbar h1 {
  flex: 0 0 auto;
  font-size: 24px;
  font-weight: 600;
  line-height: 32px;
  margin: 0;
  white-space: nowrap;
}

.topbar__actions,
.resource-links,
.resource-links a,
.resource-links button,
.master-control {
  align-items: center;
  display: flex;
}

.topbar__actions {
  flex: 0 0 auto;
  gap: 16px;
  margin-left: auto;
}

.resource-links {
  border-right: 0;
  flex: 0 0 auto;
  gap: 16px;
  padding-right: 20px;
}

.resource-links a,
.resource-links button {
  background: transparent;
  border: 0;
  color: var(--text-secondary);
  cursor: pointer;
  font-size: 13px;
  gap: 4px;
  line-height: 20px;
  margin: 0;
  padding: 6px 0;
  text-decoration: none;
  white-space: nowrap;
}

.resource-links a:hover,
.resource-links button:hover {
  color: var(--text);
}

.resource-links a:focus-visible,
.resource-links button:focus-visible {
  border-radius: 3px;
  outline: 2px solid var(--accent);
  outline-offset: 2px;
}

.feedback-copy code {
  color: var(--text);
  font: 500 12px/20px ui-monospace, "Cascadia Mono", Consolas, monospace;
  white-space: nowrap;
  user-select: text;
}

.resource-links__icon {
  display: block;
  flex: 0 0 14px;
  height: 14px;
  object-fit: contain;
  opacity: 0.72;
  width: 14px;
}

.resource-links a:hover .resource-links__icon,
.resource-links button:hover .resource-links__icon {
  opacity: 1;
}

.master-control {
  padding: 3px 14px;
  border-radius: 26px;
  background: var(--canvas);
  cursor: pointer;
  flex: 0 0 auto;
  font-size: 13px;
  gap: 8px;
  line-height: 20px;
  white-space: nowrap;
}

@media (max-width: 1200px) {
  .topbar {
    padding-left: 20px;
    padding-right: 20px;
  }

  .topbar__actions,
  .resource-links {
    gap: 12px;
  }

  .resource-links {
    padding-right: 16px;
  }

  .feedback-copy code {
    display: none;
  }
}

@media (max-width: 900px) {
  .topbar {
    gap: 12px;
    padding-left: 16px;
    padding-right: 16px;
  }

  .topbar__actions {
    gap: 10px;
  }

  .resource-links {
    gap: 4px;
    padding-right: 10px;
  }

  .resource-links a,
  .resource-links button {
    height: 28px;
    justify-content: center;
    width: 28px;
  }

  .resource-links > a span,
  .resource-links > button span {
    display: none;
  }
}
@media (max-width: 700px) {
  .topbar { height: auto; min-height: 72px; flex-basis: auto; flex-wrap: wrap; gap: 8px; padding: 10px 16px; }
  .topbar h1 { font-size: 21px; white-space: normal; }
  .topbar__actions { flex-wrap: wrap; }
}
</style>
