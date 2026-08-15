<template>
  <div
    :class="classes.bar"
    :hidden="!visible || visibleActions.length === 0"
    role="toolbar"
    :aria-label="t('actionToolbar')"
    :data-bcp-one-owned="variant === 'common' ? 'true' : undefined"
    :data-bcp-douyin-owned="variant === 'douyin' ? 'true' : undefined"
    @pointerenter="emit('pointerenter')"
    @pointerleave="emit('pointerleave')"
    @pointerdown="emit('pointerdown', $event)"
    @mousedown="emit('pointerdown', $event)"
  >
    <template v-for="(action, index) in visibleActions" :key="action.key">
      <span
        v-if="index > 0"
        :class="classes.divider"
        aria-hidden="true"
        :data-bcp-one-owned="variant === 'common' ? 'true' : undefined"
        :data-bcp-douyin-owned="variant === 'douyin' ? 'true' : undefined"
      />
      <button
        type="button"
        :class="[classes.item, action.key === 'plusOne' && classes.plusOne]"
        :data-action="action.dataAction"
        :data-bcp-one-owned="variant === 'common' ? 'true' : undefined"
        :data-bcp-douyin-owned="variant === 'douyin' ? 'true' : undefined"
        :hidden="!visible"
        :disabled="action.key === 'plusOne' && (sending || cooldownSeconds > 0)"
        :title="actionTitle(action.key, action.label)"
        :aria-label="actionTitle(action.key, action.label)"
        @click="activate(action.key, $event)"
        @pointerenter="action.key === 'plusOne' && emit('pointerenter')"
      >
        {{ actionLabel(action.key, action.label) }}
      </button>
    </template>
  </div>
</template>

<script setup lang="ts">
import { computed } from "vue";
import type { ActionSettings } from "../../core/types";
import { t } from "../../core/i18n";

type ActionKey = keyof ActionSettings;

const props = withDefaults(defineProps<{
  actions: ActionSettings;
  cooldownSeconds?: number;
  message?: string;
  sender?: string;
  sending?: boolean;
  variant: "common" | "douyin";
  visible: boolean;
}>(), {
  message: "",
  cooldownSeconds: 0,
  sender: "",
  sending: false
});

const emit = defineEmits<{
  copy: [event: MouseEvent];
  favorite: [event: MouseEvent];
  placeholder: [event: MouseEvent, action: "reply"];
  plusOne: [event: MouseEvent];
  pointerdown: [event: MouseEvent | PointerEvent];
  pointerenter: [];
  pointerleave: [];
}>();

const classes = computed(() => props.variant === "common" ? {
  bar: "bcp-one-actions",
  divider: "bcp-one-action-divider",
  item: "bcp-one-action",
  plusOne: "bcp-one-button"
} : {
  bar: "bcp-douyin-actions",
  divider: "bcp-douyin-action-divider",
  item: "bcp-douyin-action-item",
  plusOne: "bcp-douyin-button"
});

const visibleActions = computed(() => [
  { key: "plusOne" as const, label: t("actionPlusOne"), dataAction: "plus-one" },
  { key: "reply" as const, label: t("actionReply"), dataAction: "reply" },
  { key: "favorite" as const, label: t("actionFavorite"), dataAction: "favorite" },
  { key: "copy" as const, label: t("actionCopy"), dataAction: "copy" }
].filter((action) => props.actions[action.key]));

function activate(action: ActionKey, event: MouseEvent): void {
  if (action === "plusOne") {
    emit("plusOne", event);
  } else if (action === "favorite") {
    emit("favorite", event);
  } else if (action === "copy") {
    emit("copy", event);
  } else {
    emit("placeholder", event, "reply");
  }
}

function actionTitle(action: ActionKey, label: string): string {
  if (action === "plusOne") {
    if (props.cooldownSeconds > 0) return t("actionCooldownTitle", String(props.cooldownSeconds));
    return t("actionRepeatTitle", props.message);
  }
  if (action === "reply") {
    return props.sender
      ? t("actionReplyUserTitle", props.sender)
      : t("actionReplyMessageTitle", props.message);
  }
  if (action === "copy") return t("actionCopyTitle", props.message);
  return label;
}

function actionLabel(action: ActionKey, label: string): string {
  if (action !== "plusOne") return label;
  if (props.sending) return "…";
  return props.cooldownSeconds > 0 ? `${props.cooldownSeconds}s` : label;
}

</script>
