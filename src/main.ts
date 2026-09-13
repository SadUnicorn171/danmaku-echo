import { createApp } from 'vue'
import App from './App.vue'
import { installRuntimeLogger } from './core/runtime-logger'

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
