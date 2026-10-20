<template>
  <div class="action-preview" :aria-label="t('settingsActionPreview')">
    <div class="action-preview__copy">
      <strong>{{ t('settingsActionPreview') }}</strong>
      <span>{{ t('settingsActionPreviewExample') }}</span>
    </div>
    <div v-if="enabled" class="action-preview__capsule">
      <span v-if="actions.plusOne">{{ t('actionPlusOne') }}</span>
      <span v-if="actions.reply">{{ t('actionReply') }}</span>
      <span v-if="actions.favorite">{{ t('actionFavorite') }}</span>
      <span v-if="actions.copy">{{ t('actionCopy') }}</span>
    </div>
    <span v-else class="action-preview__paused">{{ t('settingsActionPreviewPaused') }}</span>
  </div>
</template>

<script setup lang="ts">
import type { ActionSettings } from '../core/types'
import { t } from '../composables/settings-language'

defineProps<{ actions: ActionSettings; enabled: boolean }>()
</script>

<style scoped>
.action-preview {
  display: flex;
  align-items: center;
  justify-content: space-between;
  flex-wrap: wrap;
  gap: 20px;
  padding: 20px 24px;
  border-radius: var(--radius-group);
  background: var(--accent-soft);
}
.action-preview__copy { display: flex; flex-direction: column; gap: 5px; }
.action-preview__copy strong { font-size: 14px; font-weight: 600; }
.action-preview__copy > span, .action-preview__paused { color: var(--text-secondary); font-size: 13px; }
.action-preview__capsule {
  display: flex;
  flex-wrap: wrap;
  gap: 16px;
  padding: 10px 18px;
  border-radius: 24px;
  background: var(--accent);
  color: var(--text);
  font-size: 13px;
  font-weight: 600;
}
@media (max-width: 700px) {
  .action-preview { padding: 20px; }
}
</style>
