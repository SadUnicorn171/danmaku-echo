<template>
  <details class="color-platform" :data-color-platform="platform" :open="open">
    <summary>
      <span class="color-platform__identity">
        <img class="color-platform__mark" :src="`../assets/icons/${platform}.svg`" alt="">
        <span>
          <strong>{{ label }}</strong>
          <small>{{ customCount ? t("settingsCustomColorCount", String(customCount)) : t("colorUsingDefaults") }}</small>
        </span>
      </span>
      <svg viewBox="0 0 24 24" aria-hidden="true"><path d="m8 10 4 4 4-4"/></svg>
    </summary>
    <div class="color-platform__body">
      <div class="color-grid">
        <ColorField
          v-for="field in fields"
          :id="`color-${platform}-${field.key}`"
          :key="field.key"
          :color-key="field.key"
          :default-value="field.defaultValue"
          :label="field.label"
          :model-value="colors[field.key]"
          @invalid="emit('invalid')"
          @update:model-value="emit('updateColor', field.key, $event)"
        />
      </div>
      <button class="platform-color-reset" type="button" @click="emit('reset')">
        {{ t("colorResetPlatform", label) }}
      </button>
    </div>
  </details>
</template>

<script setup lang="ts">
import { computed } from "vue";
import type { ColorSettingKey, ColorSettings, PlatformId } from "../core/types";
import ColorField from "./ColorField.vue";
import { t } from "../composables/settings-language";

const props = defineProps<{
  colors: ColorSettings;
  fields: ReadonlyArray<{ defaultValue: string; key: ColorSettingKey; label: string }>;
  label: string;
  open?: boolean;
  platform: PlatformId;
}>();

const emit = defineEmits<{
  invalid: [];
  reset: [];
  updateColor: [key: ColorSettingKey, value: string];
}>();

const customCount = computed(() => Object.values(props.colors).filter(Boolean).length);
</script>

<style lang="scss">
.color-section-heading {
  align-items: flex-end;
  display: flex;
  justify-content: space-between;
}

.color-section-heading > div {
  min-width: 0;
}

.color-section-heading p {
  color: var(--text-secondary);
  font-size: 13px;
  line-height: 20px;
  margin: 4px 0 0;
}

.color-count {
  color: var(--text-muted);
  flex: 0 0 auto;
  font-size: 12px;
  line-height: 20px;
  margin-left: 16px;
}

.color-platform-list {
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.color-platform {
  background: var(--surface);
  border: 1px solid var(--border);
  border-radius: 4px;
  box-shadow: var(--shadow);
  overflow: hidden;
}

.color-platform summary {
  align-items: center;
  cursor: pointer;
  display: flex;
  justify-content: space-between;
  list-style: none;
  min-height: 62px;
  padding: 10px 16px;
  transition: background-color 140ms ease;
}

.color-platform summary::-webkit-details-marker {
  display: none;
}

.color-platform summary:hover {
  background: rgb(255 255 255 / 58%);
}

.color-platform summary:focus-visible {
  outline: 2px solid rgb(39 174 96 / 38%);
  outline-offset: -2px;
}

.color-platform summary > svg {
  fill: none;
  height: 18px;
  stroke: var(--text-muted);
  stroke-linecap: round;
  stroke-linejoin: round;
  stroke-width: 1.7;
  transition: transform 140ms ease;
  width: 18px;
}

.color-platform[open] summary > svg {
  transform: rotate(180deg);
}

.color-platform__identity {
  align-items: center;
  display: flex;
  gap: 12px;
}

.color-platform__identity > span:last-child {
  align-items: flex-start;
  display: flex;
  flex-direction: column;
}

.color-platform__identity strong {
  font-family: Inter, "Segoe UI", sans-serif;
  font-size: 15px;
  font-weight: 500;
  line-height: 22px;
}

.color-platform__identity small {
  color: var(--text-muted);
  font-size: 12px;
  line-height: 18px;
}

.color-platform__mark {
  border-radius: 4px;
  display: block;
  flex: 0 0 30px;
  height: 30px;
  object-fit: contain;
  width: 30px;
}

.color-platform__body {
  border-top: 1px solid var(--border);
}

.color-grid {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
}

.color-text:focus,
.color-picker:focus-visible,
.color-reset:focus-visible,
.platform-color-reset:focus-visible {
  outline: 2px solid rgb(39 174 96 / 38%);
  outline-offset: 1px;
}

.platform-color-reset {
  display: block;
  margin: 12px 16px;
  min-height: 32px;
  padding: 5px 10px;
}

.platform-color-reset:hover {
  background: var(--surface-muted);
  color: var(--text);
}
</style>
