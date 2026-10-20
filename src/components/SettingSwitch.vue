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
  min-height: 76px;
  padding: 16px 24px;
  transition: background-color 140ms ease;
}

.setting-row + .setting-row {
  position: relative;
}

.setting-row + .setting-row::before {
  content: "";
  position: absolute;
  top: 0;
  left: 24px;
  right: 24px;
  border-top: 1px solid var(--border);
}

.setting-row:hover {
  background: #fffaf5;
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
  font-size: 15px;
  font-weight: 500;
  line-height: 24px;
}

.setting-copy small {
  color: var(--text-secondary);
  font-size: 12px;
  line-height: 20px;
}

input[role="switch"] {
  appearance: none;
  background: #dbd6d1;
  border: 1px solid transparent;
  border-radius: 20px;
  box-sizing: border-box;
  cursor: pointer;
  flex: 0 0 44px;
  height: 26px;
  margin: 0;
  padding: 0;
  position: relative;
  transition: background-color 140ms ease, border-color 140ms ease;
  width: 44px;
}

input[role="switch"]::after {
  background: #fff;
  border: 0;
  border-radius: 50%;
  box-sizing: border-box;
  box-shadow: none;
  content: "";
  height: 20px;
  left: 2px;
  position: absolute;
  top: 2px;
  transition: transform 200ms var(--ease-spring);
  width: 20px;
}

input[role="switch"]:checked {
  background: var(--accent);
  border-color: var(--accent);
}

input[role="switch"]:checked::after {
  border-color: #fff;
  transform: translateX(18px);
}

input[role="switch"]:focus-visible {
  outline: 3px solid var(--accent);
  outline-offset: 3px;
}

input[role="switch"]:disabled {
  cursor: not-allowed;
  opacity: .58;
}

@media (max-width: 700px) {
  .setting-row { padding: 16px 18px; }
  .setting-row + .setting-row::before { left: 18px; right: 18px; }
}

@media (prefers-reduced-motion: reduce) {
  .setting-row,
  input[role="switch"],
  input[role="switch"]::after {
    transition: none;
  }
}
</style>
