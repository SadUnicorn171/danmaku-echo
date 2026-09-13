import { installDouyinPageLogging } from '../platforms/douyin/page/runtime-logging'
import { createDouyinPageAppRuntime } from '../platforms/douyin/page/page-app'

const currentRuntime = globalThis.__danmakuEchoDouyinPageRuntime

if (currentRuntime) {
  currentRuntime.start()
} else if (!globalThis.__bulletPlusOneDouyinCanvasHook) {
  installDouyinPageLogging()
  const pageRuntime = createDouyinPageAppRuntime()
  globalThis.__danmakuEchoDouyinPageRuntime = pageRuntime
  globalThis.__bulletPlusOneDouyinCanvasHook = true
  pageRuntime.start()
}
