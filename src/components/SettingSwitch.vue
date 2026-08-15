<template>
  <label class="setting-row" :for="id">
    <span class="setting-copy">
      <strong>{{ title }}</strong>
      <small>{{ description }}</small>
    </span>
    <input
      :id="id"
      type="checkbox"
      role="switch"
      :aria-label="ariaLabel || title"
      :checked="modelValue"
      :disabled="disabled"
      @change="onChange"
    >
  </label>
</template>

<script setup lang="ts">
defineProps<{
  ariaLabel?: string;
  description: string;
  disabled?: boolean;
  id: string;
  modelValue: boolean;
  title: string;
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
.setting-row {
  align-items: center;
  cursor: pointer;
  display: flex;
  justify-content: space-between;
  min-height: 72px;
  padding: 15px 16px;
}

.setting-row + .setting-row {
  border-top: 1px solid var(--border);
}

.setting-row:hover {
  background: rgb(255 255 255 / 55%);
}

.setting-copy {
  align-items: flex-start;
  display: flex;
  flex: 1;
  flex-direction: column;
  gap: 2px;
  min-width: 0;
  padding-right: 16px;
}

.setting-copy strong {
  font-size: 16px;
  font-weight: 500;
  line-height: 24px;
}

.setting-copy small {
  color: var(--text-secondary);
  font-size: 14px;
  line-height: 20px;
}

input[role="switch"] {
  appearance: none;
  background: #e8e8e8;
  border: 1px solid var(--border);
  border-radius: 12px;
  cursor: pointer;
  flex: 0 0 36px;
  height: 20px;
  margin: 0;
  position: relative;
  transition: background-color 140ms ease, border-color 140ms ease;
  width: 36px;
}

input[role="switch"]::after {
  background: #fff;
  border: 1px solid #d4d5d5;
  border-radius: 50%;
  box-shadow: 0 1px 2px rgb(0 0 0 / 14%);
  content: "";
  height: 16px;
  left: 1px;
  position: absolute;
  top: 1px;
  transition: transform 140ms ease;
  width: 16px;
}

input[role="switch"]:checked {
  background: var(--success);
  border-color: var(--success);
}

input[role="switch"]:checked::after {
  border-color: #fff;
  transform: translateX(16px);
}

input[role="switch"]:focus-visible {
  outline: 3px solid rgb(39 174 96 / 28%);
  outline-offset: 3px;
}

input[role="switch"]:disabled {
  cursor: not-allowed;
  opacity: .58;
}
</style>
