<template>
  <b ref="element" class="animated-count" :aria-label="String(value)"
    ><span aria-hidden="true">{{ display }}</span></b
  >
</template>
<script setup lang="ts">
import { onUnmounted, ref, watch } from 'vue'
import { subscribeUiMotion, uiMotionAllowed } from '../core/ui-motion'
const props = defineProps<{ value: number; ready: boolean }>()
const element = ref<HTMLElement | null>(null)
const display = ref(props.value)
let frame = 0
function settle() {
  cancelAnimationFrame(frame)
  frame = 0
  display.value = props.value
}
const unsubscribe = subscribeUiMotion((allowed) => {
  if (!allowed) settle()
})
watch(
  () => [props.value, props.ready] as const,
  ([value, ready], [, wasReady]) => {
    cancelAnimationFrame(frame)
    const rect = element.value?.getBoundingClientRect()
    if (
      !ready ||
      !wasReady ||
      !uiMotionAllowed() ||
      !rect ||
      rect.bottom <= 0 ||
      rect.top >= innerHeight
    ) {
      settle()
      return
    }
    const from = display.value
    const start = performance.now()
    const tick = (now: number) => {
      const progress = Math.min(1, (now - start) / 220)
      display.value = Math.round(from + (value - from) * (1 - (1 - progress) ** 3))
      frame = progress < 1 ? requestAnimationFrame(tick) : 0
    }
    frame = requestAnimationFrame(tick)
  },
)
onUnmounted(() => {
  cancelAnimationFrame(frame)
  unsubscribe()
})
</script>
<style scoped>
.animated-count {
  font-variant-numeric: tabular-nums;
  min-width: 3ch;
}
</style>
