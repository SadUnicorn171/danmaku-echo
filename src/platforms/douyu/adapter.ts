import { createSelectorPlatformAdapter } from '../live/selector-adapter'
import { DOUYU_PLATFORM_CONFIG } from './config'
import {
  DOUYU_NATIVE_DANMAKU_ACTION_MARKER,
  DOUYU_NATIVE_DANMAKU_ACTION_SELECTORS,
  DOUYU_NATIVE_DANMAKU_CAPSULE_CONTAINER_SELECTORS,
  DOUYU_NATIVE_DANMAKU_CAPSULE_DECORATION_SELECTORS,
  DOUYU_NATIVE_DANMAKU_CAPSULE_DETACHED_DECORATION_SELECTORS,
  DouyuNativeCapsuleVisibilityController,
  findDouyuNativeDanmakuCapsuleTargets,
} from './native-capsule'
import { DouyuNativeHoverController } from './native-hover'
import { DouyuNativeMotionFallback } from './native-motion-fallback'
import { douyuOverlayTextElements } from './message-content'

export interface DouyuRuntimeBoundary {
  actionMarker: typeof DOUYU_NATIVE_DANMAKU_ACTION_MARKER
  actionSelectors: readonly string[]
  capsuleContainerSelectors: readonly string[]
  capsuleDecorationSelectors: readonly string[]
  capsuleDetachedDecorationSelectors: readonly string[]
  capsuleTargets(root: Element): Element[]
  capsuleVisibility: DouyuNativeCapsuleVisibilityController
  hover: DouyuNativeHoverController
  motionFallback: DouyuNativeMotionFallback
  overlayTextElements(candidate: Element): Element[]
}

export function createDouyuAdapter() {
  return {
    ...createSelectorPlatformAdapter({
      config: DOUYU_PLATFORM_CONFIG,
      messageElements: (candidate) => douyuOverlayTextElements(candidate),
      nativeCapsuleVisible: (settings) => settings.nativeDanmakuCapsule.douyu,
      platform: 'douyu',
    }),
    douyu: {
      actionMarker: DOUYU_NATIVE_DANMAKU_ACTION_MARKER,
      actionSelectors: DOUYU_NATIVE_DANMAKU_ACTION_SELECTORS,
      capsuleContainerSelectors: DOUYU_NATIVE_DANMAKU_CAPSULE_CONTAINER_SELECTORS,
      capsuleDecorationSelectors: DOUYU_NATIVE_DANMAKU_CAPSULE_DECORATION_SELECTORS,
      capsuleDetachedDecorationSelectors:
        DOUYU_NATIVE_DANMAKU_CAPSULE_DETACHED_DECORATION_SELECTORS,
      capsuleTargets: findDouyuNativeDanmakuCapsuleTargets,
      capsuleVisibility: new DouyuNativeCapsuleVisibilityController(),
      hover: new DouyuNativeHoverController(),
      motionFallback: new DouyuNativeMotionFallback(),
      overlayTextElements: douyuOverlayTextElements,
    } satisfies DouyuRuntimeBoundary,
  }
}
