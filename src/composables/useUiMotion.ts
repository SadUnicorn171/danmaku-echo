import { onMounted, onUnmounted, ref, watch } from 'vue'
import {
  mountUiMotion,
  setPerformanceMode,
  subscribeUiMotion,
  uiMotionAllowed,
} from '../core/ui-motion'

export function useUiMotion(performanceMode?: () => boolean) {
  const root = ref<HTMLElement | null>(null)
  const allowed = ref(uiMotionAllowed())
  let cleanup: (() => void) | undefined
  const unsubscribe = subscribeUiMotion((value) => {
    allowed.value = value
  })
  if (performanceMode)
    watch(performanceMode, setPerformanceMode, { immediate: true, flush: 'sync' })
  onMounted(() => {
    if (root.value) cleanup = mountUiMotion(root.value)
  })
  onUnmounted(() => {
    cleanup?.()
    unsubscribe()
  })
  return { root, allowed }
}
