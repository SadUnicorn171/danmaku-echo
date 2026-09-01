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
import { t } from '../core/i18n'

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
  border-bottom: 1px solid var(--border);
  box-shadow: var(--shadow);
  display: flex;
  flex: 0 0 56px;
  gap: 20px;
  height: 56px;
  justify-content: space-between;
  padding: 0 24px;
  position: relative;
  z-index: 2;
}

.topbar h1 {
  flex: 0 0 auto;
  font-size: 18px;
  font-weight: 500;
  line-height: 28px;
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
  border-right: 1px solid var(--border);
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
  font-size: 14px;
  gap: 4px;
  line-height: 20px;
  margin: 0;
  padding: 0;
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
  outline: 2px solid rgb(39 174 96 / 38%);
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
  cursor: pointer;
  flex: 0 0 auto;
  font-size: 14px;
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
</style>
