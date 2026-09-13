import { isPlausibleMessage } from '../../../core/shared'
import {
  allAssetsMatch,
  assetsMatch,
  payloadSignature,
  type RichPayload,
} from '../own-message'
import { comparableText, type EmojiAssetDescriptor } from '../rich-data'
import type { DouyinContentToPagePayload } from '../protocol'
import type { DouyinChatMessageDescriptor, DouyinChatParser } from './chat-parser'
import {
  CHAT_MESSAGE_SELECTORS,
  CHAT_ROOT_SELECTORS,
  EMOJI_ITEM_SELECTORS,
  EMOJI_SURFACE_SELECTORS,
  SEND_BUTTON_SELECTORS,
} from './dom-config'
import { closestAny, isDouyinOwnedNode, matchesAny } from './dom-query'
import type { DouyinEditorController } from './editor-controller'

interface OwnChatIntent {
  at: number
  baseline: Map<Element, string>
  id: string
  payload: RichPayload
  signature: string
  source: string
}

interface PendingManualEmojiIntent {
  at: number
  intentId: string
  payload: RichPayload
}

interface ManualInputSnapshot {
  at: number
  text: string
}

interface OwnChatFrameObserver {
  content: HTMLElement
  frame: HTMLElement
  frameRequest: number
  observer: ResizeObserver | null
}

export interface DouyinOwnMessageDebugDetails {
  [key: string]: unknown
}

export interface DouyinOwnMessageSnapshot {
  confirmedIntentCount: number
  frameCount: number
  manualInputSnapshotCount: number
  observerCount: number
  pendingIntentCount: number
  pendingManualEmojiCount: number
  timerCount: number
}

export interface DouyinOwnMessageControllerOptions {
  document: Document
  editor: DouyinEditorController
  enabled(): boolean
  maxLength?: number
  normalizePayload(value: unknown): RichPayload
  normalizeWhitespace(value: unknown): string
  onDebug?(type: string, details: DouyinOwnMessageDebugDetails, level?: 'info' | 'warn'): void
  onDescriptor?(descriptor: DouyinChatMessageDescriptor, observedAt: number): void
  onIntentQueued?(): void
  onMessageMarked?(): void
  parser: DouyinChatParser
  query(selectors: readonly string[], root?: ParentNode): Element[]
  readInputPayload(input: HTMLElement): RichPayload
  sendToPage(payload: DouyinContentToPagePayload): void
  now?: () => number
  requestFrame?: (callback: FrameRequestCallback) => number
  cancelFrame?: (handle: number) => void
}

export interface DouyinOwnMessageController {
  announce(message: unknown, sourceType: string): string
  announceManualInput(input: HTMLElement, sourceType: 'manual-button' | 'manual-enter'): string
  cancel(intentId: string): void
  clear(): void
  confirm(intentId: string): void
  destroy(): void
  refresh(): void
  rememberManualEmojiClick(event: Pick<MouseEvent, 'composedPath' | 'isTrusted' | 'target'>): string
  rememberManualInputValue(input: EventTarget | null): void
  snapshot(): DouyinOwnMessageSnapshot
  start(): void
}

const OWN_CHAT_MESSAGE_TTL = 12_000
const OWN_CHAT_FRAME_GAP = 3
const OWN_CHAT_FRAME_BORDER = 3
const MANUAL_INPUT_SNAPSHOT_TTL = 4_000
const MANUAL_INPUT_SNAPSHOT_LIMIT = 8
const MAX_INTENTS = 24
const MAX_MANUAL_EMOJI_INTENTS = 12
const CONFIRMED_INTENT_TTL = 10_000

function framePixels(value: number): string {
  return `${Math.round(Number(value || 0) * 4) / 4}px`
}

export function createDouyinOwnMessageController(
  options: DouyinOwnMessageControllerOptions,
): DouyinOwnMessageController {
  const document = options.document
  const maxLength = options.maxLength ?? 1_000
  const now = options.now ?? Date.now
  const requestFrame = options.requestFrame ?? requestAnimationFrame
  const cancelFrame = options.cancelFrame ?? cancelAnimationFrame
  const confirmedIntentIds = new Map<string, number>()
  const frameObservers = new WeakMap<HTMLElement, OwnChatFrameObserver>()
  const framedRows = new Set<HTMLElement>()
  const inputSnapshots = new Map<HTMLElement, ManualInputSnapshot>()
  const intents: OwnChatIntent[] = []
  const observers = new Map<Element, MutationObserver>()
  const pendingManualEmojiIntents: PendingManualEmojiIntent[] = []
  let nextIntentId = 1
  let scanTimer: ReturnType<typeof setTimeout> | 0 = 0
  let started = false

  function signature(value: RichPayload): string {
    return payloadSignature(options.normalizePayload(value), comparableText)
  }

  function payloadForRow(row: Element): RichPayload {
    return (
      options.parser.parse(row)?.payload ?? {
        assets: [],
        parts: [],
        plainText: '',
        text: '',
      }
    )
  }

  function payloadMatchesIntent(payload: RichPayload, intent: OwnChatIntent): boolean {
    const rowText = comparableText(payload.plainText || payload.text)
    const intentText = comparableText(intent.payload.plainText || intent.payload.text)
    const rowRaw = options.normalizeWhitespace(payload.text)
    const intentRaw = options.normalizeWhitespace(intent.payload.text)
    const textMatches =
      rowText || intentText ? rowText === intentText : Boolean(rowRaw && rowRaw === intentRaw)
    if (intent.payload.assets.length) {
      const expectedPlainText = comparableText(intent.payload.plainText)
      const actualPlainText = comparableText(payload.plainText)
      return (
        allAssetsMatch(intent.payload.assets, payload.assets) &&
        (!expectedPlainText || expectedPlainText === actualPlainText)
      )
    }
    return textMatches && Boolean(intentText || intentRaw)
  }

  function positionFrame(row: HTMLElement): void {
    const record = frameObservers.get(row)
    if (
      !record ||
      !row.isConnected ||
      row.dataset.bcpDouyinOwnChat !== 'true' ||
      !record.content.isConnected ||
      !record.frame.isConnected
    ) {
      return
    }
    const rowRect = row.getBoundingClientRect()
    const contentRect = record.content.getBoundingClientRect()
    if (!rowRect.width || !rowRect.height || !contentRect.width || !contentRect.height) return
    const scaleX = row.offsetWidth > 0 ? rowRect.width / row.offsetWidth : 1
    const scaleY = row.offsetHeight > 0 ? rowRect.height / row.offsetHeight : 1
    const safeScaleX = Number.isFinite(scaleX) && scaleX > 0 ? scaleX : 1
    const safeScaleY = Number.isFinite(scaleY) && scaleY > 0 ? scaleY : 1
    const horizontalInset = OWN_CHAT_FRAME_GAP + OWN_CHAT_FRAME_BORDER
    const verticalInset = OWN_CHAT_FRAME_GAP + OWN_CHAT_FRAME_BORDER
    const left =
      (contentRect.left - rowRect.left) / safeScaleX - Number(row.clientLeft || 0) - horizontalInset
    const top =
      (contentRect.top - rowRect.top) / safeScaleY - Number(row.clientTop || 0) - verticalInset
    record.frame.style.transform = `translate3d(${framePixels(left)}, ${framePixels(top)}, 0)`
    record.frame.style.width = framePixels(contentRect.width / safeScaleX + horizontalInset * 2)
    record.frame.style.height = framePixels(contentRect.height / safeScaleY + verticalInset * 2)
  }

  function scheduleFramePosition(row: HTMLElement): void {
    const record = frameObservers.get(row)
    if (!record || record.frameRequest) return
    record.frameRequest = requestFrame(() => {
      record.frameRequest = 0
      positionFrame(row)
    })
  }

  function removeFrame(row: HTMLElement): void {
    const record = frameObservers.get(row)
    if (record) {
      record.observer?.disconnect()
      if (record.frameRequest) cancelFrame(record.frameRequest)
      frameObservers.delete(row)
    }
    framedRows.delete(row)
    row.querySelectorAll("[data-bcp-douyin-own-chat-frame='true']").forEach((frame) => frame.remove())
    row.querySelectorAll<HTMLElement>("[data-bcp-douyin-own-chat-content='true']").forEach((content) => {
      delete content.dataset.bcpDouyinOwnChatContent
    })
    if (
      row.dataset.bcpDouyinOwnChatFramePositionOwned === 'true' &&
      row.style.position === 'relative'
    ) {
      row.style.position = row.dataset.bcpDouyinOwnChatFrameOriginalPosition || ''
    }
    delete row.dataset.bcpDouyinOwnChatFramePositionOwned
    delete row.dataset.bcpDouyinOwnChatFrameOriginalPosition
  }

  function clearMark(row: HTMLElement): void {
    removeFrame(row)
    delete row.dataset.bcpDouyinOwnChat
    delete row.dataset.bcpDouyinOwnChatSignature
  }

  function installFrame(row: HTMLElement, content: HTMLElement): void {
    const current = frameObservers.get(row)
    if (current?.content === content && current.frame.isConnected) {
      scheduleFramePosition(row)
      return
    }
    removeFrame(row)
    content.dataset.bcpDouyinOwnChatContent = 'true'
    if (getComputedStyle(row).position === 'static') {
      row.dataset.bcpDouyinOwnChatFrameOriginalPosition = row.style.position || ''
      row.dataset.bcpDouyinOwnChatFramePositionOwned = 'true'
      row.style.position = 'relative'
    }
    const frame = document.createElement('span')
    frame.dataset.bcpDouyinOwned = 'true'
    frame.dataset.bcpDouyinOwnChatFrame = 'true'
    frame.setAttribute('aria-hidden', 'true')
    row.append(frame)
    const observer =
      typeof ResizeObserver === 'function'
        ? new ResizeObserver(() => scheduleFramePosition(row))
        : null
    frameObservers.set(row, { content, frame, observer, frameRequest: 0 })
    framedRows.add(row)
    observer?.observe(row)
    observer?.observe(content)
    positionFrame(row)
    scheduleFramePosition(row)
  }

  function clearStaleMarks(): void {
    for (const row of framedRows) {
      if (!row.isConnected) {
        clearMark(row)
        continue
      }
      const currentSignature = signature(payloadForRow(row))
      if (currentSignature === row.dataset.bcpDouyinOwnChatSignature) {
        const content = options.parser.contentElement(row)
        if (content instanceof HTMLElement) installFrame(row, content)
        continue
      }
      clearMark(row)
    }
  }

  function forgetPendingManualEmojiIntent(intentId: string): void {
    const index = pendingManualEmojiIntents.findIndex((entry) => entry.intentId === intentId)
    if (index >= 0) pendingManualEmojiIntents.splice(index, 1)
  }

  function prune(currentTime = now()): void {
    for (let index = intents.length - 1; index >= 0; index -= 1) {
      if (currentTime - intents[index].at > OWN_CHAT_MESSAGE_TTL) intents.splice(index, 1)
    }
    for (let index = pendingManualEmojiIntents.length - 1; index >= 0; index -= 1) {
      if (currentTime - pendingManualEmojiIntents[index].at > OWN_CHAT_MESSAGE_TTL) {
        pendingManualEmojiIntents.splice(index, 1)
      }
    }
    for (const [intentId, confirmedAt] of confirmedIntentIds) {
      if (currentTime - confirmedAt > CONFIRMED_INTENT_TTL) confirmedIntentIds.delete(intentId)
    }
    for (const [input, snapshot] of inputSnapshots) {
      if (currentTime - snapshot.at > MANUAL_INPUT_SNAPSHOT_TTL || !input.isConnected) {
        inputSnapshots.delete(input)
      }
    }
  }

  function scan(): void {
    scanTimer = 0
    prune()
    clearStaleMarks()
    if (!intents.length) return
    const rows = options.query(CHAT_MESSAGE_SELECTORS).slice(-120).reverse()
    for (let intentIndex = 0; intentIndex < intents.length; intentIndex += 1) {
      const intent = intents[intentIndex]
      const row = rows.find((candidate) => {
        if (
          !(candidate instanceof HTMLElement) ||
          isDouyinOwnedNode(candidate) ||
          candidate.dataset.bcpDouyinOwnChat === 'true'
        ) {
          return false
        }
        const payload = payloadForRow(candidate)
        const currentSignature = signature(payload)
        if (intent.baseline.get(candidate) === currentSignature) return false
        return payloadMatchesIntent(payload, intent)
      })
      if (!(row instanceof HTMLElement)) continue
      const payload = payloadForRow(row)
      const content = options.parser.contentElement(row)
      row.dataset.bcpDouyinOwnChat = 'true'
      row.dataset.bcpDouyinOwnChatSignature = signature(payload)
      if (content instanceof HTMLElement) installFrame(row, content)
      intents.splice(intentIndex, 1)
      forgetPendingManualEmojiIntent(intent.id)
      intentIndex -= 1
      options.onMessageMarked?.()
      options.onDebug?.(
        'own-chat-message-marked',
        { assetCount: payload.assets.length, intentId: intent.id, signature: intent.signature, text: payload.text },
        'info',
      )
    }
    if (intents.length) scanTimer = setTimeout(scan, 120)
  }

  function scheduleScan(delay = 0): void {
    if (scanTimer) return
    scanTimer = setTimeout(scan, Math.max(0, delay))
  }

  function announce(message: unknown, sourceType: string): string {
    const payload = options.normalizePayload(message)
    if (!isPlausibleMessage(payload.text, maxLength)) return ''
    const intentId = `${now()}-${nextIntentId++}`
    const source = String(sourceType || 'unknown').slice(0, 40)
    const payloadKey = signature(payload)
    const rows = options.query(CHAT_MESSAGE_SELECTORS).slice(-120)
    const intent: OwnChatIntent = {
      at: now(),
      baseline: new Map(rows.map((row) => [row, signature(payloadForRow(row))])),
      id: intentId,
      payload,
      signature: payloadKey,
      source,
    }
    options.sendToPage({
      assets: payload.assets,
      intentId,
      plainText: payload.plainText,
      signature: payloadKey,
      sourceType: source,
      text: payload.text,
      type: 'own-message-intent',
    })
    intents.push(intent)
    if (intents.length > MAX_INTENTS) intents.splice(0, intents.length - MAX_INTENTS)
    options.onIntentQueued?.()
    scheduleScan()
    options.onDebug?.(
      'own-message-announced',
      { assetCount: payload.assets.length, intentId, signature: payloadKey, sourceType: source, text: payload.text },
      'info',
    )
    return intentId
  }

  function cancel(intentId: string): void {
    if (!intentId) return
    options.sendToPage({ intentId, type: 'own-message-cancel' })
    confirmedIntentIds.delete(intentId)
    forgetPendingManualEmojiIntent(intentId)
    const intentIndex = intents.findIndex((intent) => intent.id === intentId)
    if (intentIndex >= 0) intents.splice(intentIndex, 1)
  }

  function confirm(intentId: string): void {
    confirmedIntentIds.set(intentId, now())
    forgetPendingManualEmojiIntent(intentId)
    options.onDebug?.('own-message-confirmed', { intentId }, 'info')
    prune()
  }

  function emojiAssetFromTrustedClick(
    event: Pick<MouseEvent, 'composedPath' | 'isTrusted' | 'target'>,
  ): EmojiAssetDescriptor | null {
    if (!event.isTrusted) return null
    const path = typeof event.composedPath === 'function' ? event.composedPath() : [event.target]
    const elements = path.filter((item): item is Element => item instanceof Element)
    const surface = elements.find((element) => matchesAny(element, EMOJI_SURFACE_SELECTORS))
    if (!surface) return null
    const item = elements.find(
      (element) =>
        element !== surface &&
        surface.contains(element) &&
        (element instanceof HTMLImageElement || matchesAny(element, EMOJI_ITEM_SELECTORS)),
    )
    return item ? options.parser.assetFromElement(item) : null
  }

  function rememberManualEmojiClick(
    event: Pick<MouseEvent, 'composedPath' | 'isTrusted' | 'target'>,
  ): string {
    if (!options.enabled()) return ''
    const asset = emojiAssetFromTrustedClick(event)
    if (!asset) return ''
    const payload: RichPayload = {
      assets: [asset],
      parts: [{ asset, type: 'emoji' }],
      plainText: '',
      text: '表情',
    }
    const intentId = announce(payload, 'manual-emoji')
    if (!intentId) return ''
    pendingManualEmojiIntents.push({ at: now(), intentId, payload })
    if (pendingManualEmojiIntents.length > MAX_MANUAL_EMOJI_INTENTS) {
      pendingManualEmojiIntents.splice(
        0,
        pendingManualEmojiIntents.length - MAX_MANUAL_EMOJI_INTENTS,
      )
    }
    options.onDebug?.('manual-emoji-intent', { assetKeys: asset.keys.slice(0, 4), intentId }, 'info')
    return intentId
  }

  function rememberManualInputValue(target: EventTarget | null): void {
    const input = options.editor.editableFrom(target)
    if (!input || !input.isConnected) return
    const text = options.normalizeWhitespace(options.readInputPayload(input).text)
    if (!text) return
    prune()
    inputSnapshots.set(input, { at: now(), text })
    if (inputSnapshots.size <= MANUAL_INPUT_SNAPSHOT_LIMIT) return
    let oldest: { at: number; input: HTMLElement } | null = null
    for (const [candidate, snapshot] of inputSnapshots) {
      if (!oldest || snapshot.at < oldest.at) oldest = { at: snapshot.at, input: candidate }
    }
    if (oldest) inputSnapshots.delete(oldest.input)
  }

  function announceManualInput(
    input: HTMLElement,
    sourceType: 'manual-button' | 'manual-enter',
  ): string {
    const editor = options.editor.editableFrom(input) || input
    let base = options.normalizePayload(options.readInputPayload(editor))
    const snapshot = inputSnapshots.get(editor)
    if (
      !base.text &&
      !base.assets.length &&
      snapshot &&
      now() - snapshot.at <= MANUAL_INPUT_SNAPSHOT_TTL
    ) {
      base = options.normalizePayload({ plainText: snapshot.text, text: snapshot.text })
    }
    prune()
    if (!pendingManualEmojiIntents.length) {
      const intentId = announce(base, sourceType)
      options.onDebug?.(
        'manual-send-detected',
        { assetCount: base.assets.length, intentId, sourceType, text: base.text },
        'info',
      )
      return intentId
    }
    const assets = base.assets.slice()
    const parts = base.parts.slice()
    for (const entry of pendingManualEmojiIntents.slice()) {
      for (const asset of entry.payload.assets) {
        if (!assets.some((existing) => assetsMatch(existing, asset))) {
          assets.push(asset)
          parts.push({ asset, type: 'emoji' })
        }
      }
      cancel(entry.intentId)
    }
    pendingManualEmojiIntents.splice(0)
    const intentId = announce(
      {
        assets,
        parts,
        plainText: base.plainText,
        text: base.text || (assets.length ? '表情' : ''),
      },
      sourceType,
    )
    options.onDebug?.(
      'manual-send-detected',
      { assetCount: assets.length, intentId, sourceType, text: base.text },
      'info',
    )
    return intentId
  }

  function onClick(event: MouseEvent): void {
    rememberManualEmojiClick(event)
    if (!event.isTrusted || !options.enabled()) return
    const input = options.editor.find()
    const path = typeof event.composedPath === 'function' ? event.composedPath() : [event.target]
    const clickedSend = path.find(
      (item): item is Element =>
        item instanceof Element &&
        (matchesAny(item, SEND_BUTTON_SELECTORS) ||
          /^(发送|发 送|send)$/iu.test(
            options.normalizeWhitespace(
              item instanceof HTMLElement ? item.innerText || item.textContent : item.textContent,
            ),
          )),
    )
    let sharesInputContainer = false
    for (
      let scope = input?.parentElement ?? null, depth = 0;
      scope && depth < 7;
      scope = scope.parentElement, depth += 1
    ) {
      if (clickedSend && scope.contains(clickedSend)) {
        sharesInputContainer = true
        break
      }
    }
    if (input && clickedSend && sharesInputContainer) announceManualInput(input, 'manual-button')
  }

  function onInput(event: Event): void {
    if (event.isTrusted && options.enabled()) rememberManualInputValue(event.target)
  }

  function onKeyDown(event: KeyboardEvent): void {
    if (!event.isTrusted || event.key !== 'Enter' || event.shiftKey || !options.enabled()) return
    const input = options.editor.find()
    const ownsTarget = Boolean(input && (event.target === input || input.contains(event.target as Node)))
    const targetEditor = options.editor.editableFrom(event.target)
    const activeInput = ownsTarget ? input : input ? null : targetEditor
    if (activeInput) announceManualInput(activeInput, 'manual-enter')
  }

  function rememberRemovedRows(nodes: readonly Node[]): void {
    for (const node of nodes) {
      if (!(node instanceof Element)) continue
      for (const row of options.parser.rowsFromNode(node)) {
        if (row instanceof HTMLElement && row.dataset.bcpDouyinOwnChat === 'true') {
          clearMark(row)
          continue
        }
        if (isDouyinOwnedNode(row)) continue
        const descriptor = options.parser.parse(row)
        if (descriptor) options.onDescriptor?.(descriptor, now())
        options.parser.forget(row)
      }
    }
  }

  function handleMutations(mutations: MutationRecord[]): void {
    const rows = new Set<Element>()
    const removedNodes: Node[] = []
    for (const mutation of mutations) {
      const target =
        mutation.target instanceof Element
          ? mutation.target
          : mutation.target.parentElement
      const targetRow = target && closestAny(target, CHAT_MESSAGE_SELECTORS)
      if (targetRow) rows.add(targetRow)
      for (const node of mutation.addedNodes) {
        if (!(node instanceof Element)) continue
        options.parser.rowsFromNode(node).forEach((row) => rows.add(row))
      }
      removedNodes.push(...mutation.removedNodes)
    }
    if (removedNodes.length) rememberRemovedRows(removedNodes)
    const observedAt = now()
    for (const row of rows) {
      if (
        (row instanceof HTMLElement && row.dataset.bcpDouyinOwnChat === 'true') ||
        isDouyinOwnedNode(row)
      ) {
        continue
      }
      const descriptor = options.parser.parse(row)
      if (descriptor) options.onDescriptor?.(descriptor, observedAt)
    }
    if (rows.size && (intents.length || framedRows.size)) scheduleScan(40)
  }

  function roots(): Element[] {
    const candidates = options.query(CHAT_ROOT_SELECTORS).filter((root) => !isDouyinOwnedNode(root))
    return candidates.filter(
      (candidate) => !candidates.some((other) => other !== candidate && other.contains(candidate)),
    )
  }

  function refresh(): void {
    if (!document.documentElement) return
    if (!options.enabled()) {
      for (const observer of observers.values()) observer.disconnect()
      observers.clear()
      return
    }
    const currentRoots = new Set(roots())
    for (const [root, observer] of observers) {
      if (root.isConnected && currentRoots.has(root)) continue
      observer.disconnect()
      observers.delete(root)
    }
    let attached = false
    for (const root of currentRoots) {
      if (observers.has(root)) continue
      const observer = new MutationObserver(handleMutations)
      observer.observe(root, { characterData: true, childList: true, subtree: true })
      observers.set(root, observer)
      attached = true
    }
    if (attached) {
      const observedAt = now()
      for (const row of options.query(CHAT_MESSAGE_SELECTORS)) {
        const descriptor = options.parser.parse(row)
        if (descriptor) options.onDescriptor?.(descriptor, observedAt)
      }
    }
  }

  function clear(): void {
    if (scanTimer) clearTimeout(scanTimer)
    scanTimer = 0
    intents.splice(0)
    pendingManualEmojiIntents.splice(0)
    confirmedIntentIds.clear()
    inputSnapshots.clear()
    for (const row of framedRows) clearMark(row)
  }

  function start(): void {
    if (started) {
      refresh()
      return
    }
    started = true
    document.addEventListener('click', onClick, true)
    document.addEventListener('input', onInput, true)
    document.addEventListener('keydown', onKeyDown, true)
    refresh()
  }

  function destroy(): void {
    if (started) {
      document.removeEventListener('click', onClick, true)
      document.removeEventListener('input', onInput, true)
      document.removeEventListener('keydown', onKeyDown, true)
    }
    started = false
    for (const observer of observers.values()) observer.disconnect()
    observers.clear()
    clear()
  }

  return {
    announce,
    announceManualInput,
    cancel,
    clear,
    confirm,
    destroy,
    refresh,
    rememberManualEmojiClick,
    rememberManualInputValue,
    snapshot: () => ({
      confirmedIntentCount: confirmedIntentIds.size,
      frameCount: framedRows.size,
      manualInputSnapshotCount: inputSnapshots.size,
      observerCount: observers.size,
      pendingIntentCount: intents.length,
      pendingManualEmojiCount: pendingManualEmojiIntents.length,
      timerCount: Number(Boolean(scanTimer)),
    }),
    start,
  }
}
