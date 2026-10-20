import { createApp } from 'vue'
import App from './App.vue'
import { installRuntimeLogger } from './core/runtime-logger'

// The action popup sizes itself from its contents; give it intrinsic dimensions
// before mounting the viewport-based layout. Options tabs remain responsive.
if (typeof chrome !== 'undefined' && chrome.extension?.getViews?.({ type: 'popup' }).includes(window)) {
  document.documentElement.dataset.extensionPopup = ''
}

const logger = installRuntimeLogger({ source: 'settings' })
const app = createApp(App)
app.config.errorHandler = (error, _instance, info) => {
  logger.record('error', 'vue-error', { error, info })
  console.error(error)
}
app.config.warnHandler = (message, _instance, trace) => {
  logger.record('warn', 'vue-warning', { warning: message, trace })
  console.warn('[Vue warn] ' + message, trace)
}
app.mount('#app')
