import { installRuntimeLogger } from '../../../core/runtime-logger'
import type { RuntimeLog } from '../../../core/runtime-log'
import { createDouyinPageToContentMessage, isDouyinContentToPageMessage } from '../protocol'

// Retain a small outbox for early startup warnings before the isolated world is ready.
// Replays use stable ids; the background store discards duplicates.
export function installDouyinPageLogging(): void {
  const outbox: RuntimeLog[] = []
  const post = (entry: RuntimeLog): void =>
    window.postMessage(createDouyinPageToContentMessage({ type: 'runtime-log', entry }), '*')
  installRuntimeLogger({
    source: 'douyin-page',
    captureConsole: false,
    extensionOnlyErrors: true,
    write(entry) {
      outbox.push(entry)
      if (outbox.length > 20) outbox.shift()
      post(entry)
    },
  })
  const onMessage = (event: MessageEvent<unknown>): void => {
    if (
      event.source === window &&
      isDouyinContentToPageMessage(event.data) &&
      event.data.type === 'ping'
    ) {
      outbox.splice(0).forEach(post)
    }
  }
  const onPageHide = (event: PageTransitionEvent): void => {
    if (event.persisted) return
    outbox.length = 0
    window.removeEventListener('message', onMessage)
    window.removeEventListener('pagehide', onPageHide)
  }
  window.addEventListener('message', onMessage)
  window.addEventListener('pagehide', onPageHide)
}
