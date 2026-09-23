<template>
  <label class="platform-row" :data-platform="platform" :data-enabled="String(modelValue)">
    <input
      :id="`platform-${platform}`"
      class="platform-input"
      type="checkbox"
      :checked="modelValue"
      @change="onChange"
    >
    <span class="platform-identity">
      <span :class="['platform-logo', `platform-logo--${platform}`]" aria-hidden="true">
        <img :src="`../assets/icons/${platform}.svg`" alt="">
      </span>
      <strong>{{ label }}</strong>
    </span>
    <span class="platform-status">
      <svg class="platform-status__on" viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="8"/><path d="m8.5 12 2.25 2.25 4.75-5"/></svg>
      <svg class="platform-status__off" viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="8"/><path d="M12 8.5v4.25"/><circle cx="12" cy="15.5" r=".55" class="filled"/></svg>
      <span>{{ modelValue ? t("settingsEnabled") : t("settingsDisabled") }}</span>
    </span>
  </label>
</template>

<script setup lang="ts">
import type { PlatformId } from "../core/types";
import { t } from "../composables/settings-language";

defineProps<{
  label: string;
  modelValue: boolean;
  platform: PlatformId;
}>();

const emit = defineEmits<{
  change: [];
  "update:modelValue": [value: boolean];
}>();

function onChange(event: Event): void {
  emit("update:modelValue", (event.currentTarget as HTMLInputElement).checked);
  emit("change");
}
</script>

<style lang="scss">
.platform-card {
  overflow: hidden;
}

.platform-feature-heading {
  align-items: flex-start;
  background: #f7f7f5;
  border-bottom: 1px solid var(--border);
  border-top: 1px solid var(--border);
  display: flex;
  flex-direction: column;
  gap: 4px;
  padding: 14px 20px;
}

.platform-feature-heading strong {
  color: #1f1f1f;
  font-size: 14px;
  font-weight: 600;
  line-height: 20px;
}

.platform-feature-heading small {
  color: var(--text-secondary);
  font-size: 13px;
  line-height: 20px;
}

.platform-row {
  align-items: center;
  cursor: pointer;
  display: flex;
  gap: 16px;
  justify-content: space-between;
  min-height: 58px;
  padding: 15px 16px;
  position: relative;
  transition: background-color 140ms ease, opacity 140ms ease;
}

.platform-row + .platform-row {
  border-top: 1px solid var(--border);
}

.platform-row:hover {
  background: rgb(255 255 255 / 60%);
}

.platform-row:has(.platform-input:focus-visible) {
  outline: 2px solid rgb(39 174 96 / 38%);
  outline-offset: -2px;
}

.platform-row[data-enabled="false"] {
  opacity: .62;
}

.platform-input {
  height: 1px;
  margin: -1px;
  opacity: 0;
  overflow: hidden;
  position: absolute;
  width: 1px;
}

.platform-identity,
.platform-status {
  align-items: center;
  display: flex;
}

.platform-identity {
  gap: 12px;
  min-width: 0;
}

.platform-identity strong {
  font-family: inherit;
  font-size: 16px;
  font-weight: 500;
  line-height: 24px;
}

.platform-logo {
  border-radius: 2px;
  box-shadow: 0 1px 2px rgb(0 0 0 / 8%);
  display: block;
  flex: 0 0 24px;
  height: 24px;
  overflow: hidden;
}

.platform-logo img {
  display: block;
  height: 100%;
  object-fit: contain;
  width: 100%;
}

.platform-status {
  color: #5e5e5e;
  flex-shrink: 0;
  font-size: 14px;
  gap: 6px;
  line-height: 20px;
}

.platform-status svg {
  fill: none;
  height: 14px;
  stroke: currentColor;
  stroke-linecap: round;
  stroke-linejoin: round;
  stroke-width: 1.7;
  width: 14px;
}

.platform-status__off {
  display: none;
}

.platform-row[data-enabled="false"] .platform-status__on {
  display: none;
}

.platform-row[data-enabled="false"] .platform-status__off {
  display: block;
}
</style>
