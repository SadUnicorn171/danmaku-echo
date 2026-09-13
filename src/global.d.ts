import type { DiagnosticsSnapshotV1, SharedExtensionApi } from './core/types'
import type { DouyinContentDebugState } from './platforms/douyin/content/runtime-state'
import type { DouyinPageRuntime } from './platforms/douyin/page/page-runtime'
import type { DouyinPageDebugState } from './platforms/douyin/page/runtime-types'

declare global {
  var DanmakuEchoShared: SharedExtensionApi | undefined
  var __bulletPlusOneLoaded: boolean | undefined
  var __danmakuEchoDouyinLoaded: boolean | undefined
  var __danmakuEchoDouyinContentDebug: DouyinContentDebugState | undefined
  var __danmakuEchoDouyinDebug: DouyinPageDebugState | undefined
  var __danmakuEchoDouyinPageRuntime: DouyinPageRuntime | undefined
  var __danmakuEchoDouyinBootstrapLoaded: boolean | undefined
  var __bulletPlusOneDouyinCanvasHook: boolean | undefined
  var __danmakuEchoDiagnostics: DiagnosticsSnapshotV1 | undefined
}

export {}
