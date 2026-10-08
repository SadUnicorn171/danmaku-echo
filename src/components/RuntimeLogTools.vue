<template>
  <div class="runtime-log-tools" aria-labelledby="runtime-log-title">
    <div>
      <strong id="runtime-log-title">{{ t('runtimeLogTitle') }}</strong>
      <p>{{ t('runtimeLogDescription') }}</p>
    </div>
    <div class="runtime-log-actions">
      <button type="button" :disabled="busy" @click="exportLogs()">
        {{ t('runtimeLogExport') }}
      </button>
      <button type="button" :disabled="busy" @click="exportLogs(true)">{{ t('runtimeLogExportLatest') }}</button>
      <button type="button" :disabled="busy" @click="clearLogs">{{ t('runtimeLogClear') }}</button>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref } from 'vue'
import { LOG_MESSAGE } from '../core/runtime-log'
import { t } from '../composables/settings-language'

const emit = defineEmits<{ status: [message: string, kind: 'error' | 'saved'] }>()
const busy = ref(false)
async function request(action: 'export' | 'clear', latestFailure = false) {
  const response = await globalThis.chrome?.runtime?.sendMessage({ type: LOG_MESSAGE, action, ...(latestFailure ? { latestFailure: true } : {}) })
  if (!response?.ok) throw new Error('runtime-log-unavailable')
  return response.data
}
async function exportLogs(latestFailure = false): Promise<void> {
  busy.value = true
  let url = ''
  try {
    const bundle = await request('export', latestFailure)
    if (latestFailure && !bundle.entries.length) { emit('status', t('runtimeLogNoSendFailure'), 'saved'); return }
    url = URL.createObjectURL(
      new Blob([JSON.stringify(bundle, null, 2)], { type: 'application/json' }),
    )
    const anchor = document.createElement('a')
    anchor.href = url
    anchor.download =
      'danmaku-echo-logs-' + new Date().toISOString().replace(/[:.]/g, '-') + '.json'
    document.body.append(anchor)
    try {
      anchor.click()
    } finally {
      anchor.remove()
    }
    emit('status', t('runtimeLogExported'), 'saved')
  } catch {
    emit('status', t('runtimeLogFailed'), 'error')
  } finally {
    // Keep the object URL alive until the browser has started the download.
    if (url) setTimeout(() => URL.revokeObjectURL(url), 1000)
    busy.value = false
  }
}
async function clearLogs(): Promise<void> {
  busy.value = true
  try {
    await request('clear')
    emit('status', t('runtimeLogCleared'), 'saved')
  } catch {
    emit('status', t('runtimeLogFailed'), 'error')
  } finally {
    busy.value = false
  }
}
</script>

<style scoped>
.runtime-log-tools {
  padding: 16px;
  display: flex;
  gap: 16px;
  align-items: center;
  justify-content: space-between;
  flex-wrap: wrap;
}
strong {
  font-size: 14px;
  font-weight: 500;
}
p {
  color: var(--text-secondary);
  margin: 6px 0 0;
  font-size: 12px;
  line-height: 1.6;
}
.runtime-log-actions {
  display: flex;
  gap: 8px;
  flex-wrap: wrap;
}
button {
  padding: 8px 12px;
  border: 1px solid var(--border);
  border-radius: 6px;
  background: var(--surface);
  color: inherit;
  cursor: pointer;
  font: inherit;
  font-size: 12px;
  min-height: 34px;
  transition: background-color 140ms ease, border-color 140ms ease;
}
button:hover:not(:disabled) {
  background: var(--surface-muted);
  border-color: #fd8101;
}
button:focus-visible {
  outline: 2px solid #fd8101;
  outline-offset: 2px;
}
button:disabled {
  opacity: 0.5;
  cursor: wait;
}

@media (max-width: 900px) {
  .runtime-log-tools {
    align-items: stretch;
    flex-direction: column;
    gap: 12px;
  }
  .runtime-log-actions button {
    flex: 1;
  }
}
</style>
