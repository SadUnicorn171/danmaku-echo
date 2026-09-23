<template>
  <div class="color-field" :data-color-key="colorKey">
    <label class="color-field__label" :for="id">
      <span>{{ label }}</span>
      <small>{{ t("colorDefaultValue", defaultValue) }}</small>
    </label>
    <div class="color-control">
      <input
        class="color-picker"
        type="color"
        :value="modelValue || defaultValue"
        :aria-label="t('colorPickerAria', label)"
        @input="onPickerInput"
      >
      <input
        :id="id"
        v-model="draft"
        class="color-text"
        type="text"
        inputmode="text"
        maxlength="7"
        :placeholder="t('colorDefaultValue', defaultValue)"
        :aria-invalid="invalid"
        spellcheck="false"
        autocomplete="off"
        @input="onTextInput"
        @change="onTextChange"
      >
      <button class="color-reset" type="button" :aria-label="t('colorResetAria', label)" @click="reset">
        {{ t("colorDefault") }}
      </button>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, watch } from "vue";
import { normalizeHexColor } from "../core/shared";
import type { ColorSettingKey } from "../core/types";
import { t } from "../composables/settings-language";

const props = defineProps<{
  colorKey: ColorSettingKey;
  defaultValue: string;
  id: string;
  label: string;
  modelValue: string;
}>();

const emit = defineEmits<{
  invalid: [];
  "update:modelValue": [value: string];
}>();

const draft = ref(props.modelValue);
const invalid = ref(false);

watch(() => props.modelValue, (value) => {
  draft.value = value;
  invalid.value = false;
});

function commit(raw: string, showError: boolean): void {
  const trimmed = raw.trim();
  const value = normalizeHexColor(trimmed);
  invalid.value = Boolean(trimmed && !value);
  if (invalid.value) {
    if (showError) emit("invalid");
    return;
  }
  draft.value = value;
  emit("update:modelValue", value);
}

function onTextInput(): void {
  commit(draft.value, false);
}

function onTextChange(): void {
  commit(draft.value, true);
}

function onPickerInput(event: Event): void {
  commit((event.currentTarget as HTMLInputElement).value, false);
}

function reset(): void {
  draft.value = "";
  invalid.value = false;
  emit("update:modelValue", "");
}
</script>

<style lang="scss">
.color-field {
  border-bottom: 1px solid #dedfdf;
  min-width: 0;
  padding: 12px 16px 14px;
}

.color-field:nth-child(odd) {
  border-right: 1px solid #dedfdf;
}

.color-field__label {
  align-items: baseline;
  display: flex;
  flex-wrap: wrap;
  gap: 2px 8px;
  justify-content: space-between;
  margin-bottom: 8px;
}

.color-field__label span {
  font-size: 13px;
  font-weight: 500;
  line-height: 20px;
}

.color-field__label small {
  color: var(--text-secondary);
  font-family: Consolas, monospace;
  font-size: 10px;
  line-height: 16px;
}

.color-control {
  align-items: stretch;
  display: grid;
  gap: 6px;
  grid-template-columns: 34px minmax(0, 1fr) max-content;
}

.color-picker {
  background: transparent;
  border: 0;
  cursor: pointer;
  height: 32px;
  margin: 0;
  padding: 0;
  width: 34px;
}

.color-picker::-webkit-color-swatch-wrapper {
  padding: 0;
}

.color-picker::-webkit-color-swatch {
  border: 1px solid var(--border);
  border-radius: 4px;
}

.color-text {
  background: #fff;
  border: 1px solid var(--border);
  border-radius: 4px;
  color: var(--text);
  font-family: Consolas, monospace;
  font-size: 12px;
  height: 32px;
  min-width: 0;
  padding: 0 9px;
  text-transform: uppercase;
  transition: border-color 140ms ease;
}

.color-text::placeholder {
  color: var(--text-muted);
  opacity: 1;
  text-transform: none;
}

.color-text:focus {
  border-color: #fd8101;
  outline: none;
}

.color-text[aria-invalid="true"] {
  border-color: var(--danger);
  outline: 2px solid rgb(201 76 76 / 16%);
}

.color-reset,
.platform-color-reset {
  background: #fff;
  border: 1px solid var(--border);
  border-radius: 4px;
  color: var(--text-secondary);
  cursor: pointer;
  font-size: 12px;
  transition: background-color 140ms ease, color 140ms ease;
}

.color-reset:hover,
.platform-color-reset:hover {
  background: var(--surface-muted);
  color: var(--text);
}

.color-reset {
  height: 32px;
  min-width: 46px;
  padding: 0 8px;
  white-space: nowrap;
}
</style>
