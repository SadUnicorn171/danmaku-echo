import { installRuntimeLogger } from '../core/runtime-logger'
import { createDouyinContentApp } from '../platforms/douyin/content/content-app'

const shared = globalThis.DanmakuEchoShared

if (
  shared &&
  shared.detectPlatform(location.hostname, location.pathname) === 'douyin' &&
  !globalThis.__danmakuEchoDouyinLoaded
) {
  installRuntimeLogger({ source: 'douyin-isolated', extensionOnlyErrors: true })
  globalThis.__danmakuEchoDouyinLoaded = true
  const runtime = createDouyinContentApp(shared)
  void runtime.start()
}
