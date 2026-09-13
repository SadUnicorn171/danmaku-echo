import { installRuntimeLogger } from '../core/runtime-logger'
import { startLiveContentApp } from './content-app'

installRuntimeLogger({ source: 'live-content', extensionOnlyErrors: true })
startLiveContentApp()
