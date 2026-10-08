import { BILIBILI_QUICK_BAR_SELECTORS, BILIBILI_QUICK_INPUTS } from './dom-config'
import type { LivePlatformConfig } from '../live/config'
import { closestMatching } from '../live/deep-dom'
import type { LiveContentRuntimeState } from '../live/runtime-state'

interface BilibiliInputDismissContext {
  config: LivePlatformConfig
  fullscreenActive(): boolean
  fullscreenElement(): Element | null
  isSideChatEditor(element: Element): boolean
  isVisible(element: Element): boolean
  queryAllDeep(selectors: readonly string[]): Element[]
  state: Pick<LiveContentRuntimeState, 'bilibiliDismissToken' | 'hiddenBilibiliQuickBars'>
}

export function dismissBilibiliQuickInput(
  input: HTMLElement,
  context: BilibiliInputDismissContext,
  bilibiliDismissToken: number,
): void {
  const {
    config,
    fullscreenActive,
    fullscreenElement,
    isSideChatEditor,
    isVisible,
    queryAllDeep,
    state,
  } = context
  const quickBarStyleProperties = ['display', 'visibility', 'opacity', 'pointer-events']
  const restorePlaybackState = (
    snapshots: ReadonlyArray<{ paused: boolean; video: HTMLVideoElement }>,
  ): void => {
    for (const snapshot of snapshots) {
      if (!snapshot.video.isConnected) {
        continue
      }
      if (snapshot.paused && !snapshot.video.paused) {
        snapshot.video.pause()
      } else if (!snapshot.paused && snapshot.video.paused) {
        const playResult = snapshot.video.play()
        if (playResult && typeof playResult.catch === 'function') {
          playResult.catch(() => {})
        }
      }
    }
  }

  const forceHideBilibiliQuickBars = (quickEditors: readonly HTMLElement[]): void => {
    for (const editor of quickEditors) {
      const player =
        fullscreenElement() ||
        closestMatching(editor, config.videoRoots) ||
        queryAllDeep(config.videoRoots).find((element) => isVisible(element))
      let container = editor.closest<HTMLElement>(BILIBILI_QUICK_BAR_SELECTORS.join(','))
      if (!container || container === editor) {
        container = editor.parentElement || editor
        const playerRect = player && player.getBoundingClientRect()
        let current: HTMLElement | null = container
        for (let depth = 0; current && current !== player && depth < 5; depth += 1) {
          const rect = current.getBoundingClientRect()
          const widthLimit =
            playerRect && playerRect.width > 0
              ? playerRect.width * 0.9
              : Math.max(800, innerWidth * 0.8)
          if (rect.height <= 0 || rect.height > 120 || rect.width > widthLimit) {
            break
          }
          container = current
          current = current.parentElement
        }
      }
      const existing = state.hiddenBilibiliQuickBars.get(container)
      if (existing) {
        existing.hiddenAt = Date.now()
        container.style.setProperty('display', 'none', 'important')
        container.style.setProperty('visibility', 'hidden', 'important')
        container.style.setProperty('opacity', '0', 'important')
        container.style.setProperty('pointer-events', 'none', 'important')
        continue
      }
      state.hiddenBilibiliQuickBars.set(container, {
        styles: Object.fromEntries(
          quickBarStyleProperties.map((property) => [
            property,
            {
              value: container.style.getPropertyValue(property),
              priority: container.style.getPropertyPriority(property),
            },
          ]),
        ),
        hiddenAt: Date.now(),
      })
      container.style.setProperty('display', 'none', 'important')
      container.style.setProperty('visibility', 'hidden', 'important')
      container.style.setProperty('opacity', '0', 'important')
      container.style.setProperty('pointer-events', 'none', 'important')
    }
  }

  const dismissNow = () => {
    const player =
      fullscreenElement() ||
      closestMatching(input, config.videoRoots) ||
      queryAllDeep(config.videoRoots).find((element) => isVisible(element))
    const quickEditorSet = new Set(queryAllDeep(BILIBILI_QUICK_INPUTS))
    const addIfPlayerEditor = (editor: Element | null): void => {
      if (!(editor instanceof HTMLElement) || !editor.isConnected || !isVisible(editor)) {
        return
      }
      if (isSideChatEditor(editor)) {
        return
      }
      const looksEditable = editor.matches(
        "input, textarea, [contenteditable]:not([contenteditable='false']), [role='textbox']",
      )
      if (!looksEditable) {
        return
      }
      const owner = closestMatching(editor, config.videoRoots)
      const playerRect = player && player.getBoundingClientRect()
      const playerCoversViewport = Boolean(
        playerRect &&
        playerRect.width >= innerWidth * 0.85 &&
        playerRect.height >= innerHeight * 0.75,
      )
      if (
        (player && player.contains(editor)) ||
        owner ||
        (editor === input && fullscreenActive() && playerCoversViewport)
      ) {
        quickEditorSet.add(editor)
      }
    }
    addIfPlayerEditor(input)
    addIfPlayerEditor(document.activeElement)
    if (player) {
      const playerRect = player.getBoundingClientRect()
      for (const editor of player.querySelectorAll(
        "input, textarea, [contenteditable='true'], [role='textbox']",
      )) {
        if (!isVisible(editor) || isSideChatEditor(editor)) {
          continue
        }
        const rect = editor.getBoundingClientRect()
        if (
          rect.height >= 8 &&
          rect.height <= 100 &&
          rect.bottom >= playerRect.top + playerRect.height * 0.45
        ) {
          quickEditorSet.add(editor)
        }
      }
    }
    const quickEditors = Array.from(quickEditorSet).filter(
      (editor): editor is HTMLElement =>
        editor instanceof HTMLElement && editor.isConnected && isVisible(editor),
    )
    if (!quickEditors.length) {
      return
    }

    const escapeInit = {
      key: 'Escape',
      code: 'Escape',
      keyCode: 27,
      which: 27,
      bubbles: true,
      cancelable: true,
      composed: true,
    }
    for (const editor of quickEditors) {
      editor.dispatchEvent(new KeyboardEvent('keydown', escapeInit))
      editor.dispatchEvent(new KeyboardEvent('keyup', escapeInit))
    }

    const playerRect = player && player.getBoundingClientRect()
    let outsideTarget =
      player &&
      player.querySelector(
        [
          '.bilibili-live-player-video-danmaku',
          '.bpx-player-video-wrap',
          '.bilibili-live-player-video-area',
          'video',
        ].join(','),
      )
    if (!outsideTarget && playerRect && playerRect.width > 0 && playerRect.height > 0) {
      outsideTarget = document.elementFromPoint(
        playerRect.left + playerRect.width / 2,
        playerRect.top + playerRect.height * 0.55,
      )
    }
    outsideTarget = outsideTarget || player || document.body || document.documentElement
    if (!outsideTarget) {
      forceHideBilibiliQuickBars(quickEditors)
      return
    }
    const videos = player
      ? Array.from(player.querySelectorAll('video')).map((video) => ({
          video,
          paused: video.paused,
        }))
      : []
    const pointerInit = {
      bubbles: true,
      cancelable: true,
      composed: true,
      button: 0,
      buttons: 0,
      pointerId: 1,
      pointerType: 'mouse',
      isPrimary: true,
    }
    outsideTarget.dispatchEvent(new PointerEvent('pointerdown', pointerInit))
    outsideTarget.dispatchEvent(new MouseEvent('mousedown', pointerInit))
    outsideTarget.dispatchEvent(new PointerEvent('pointerup', pointerInit))
    outsideTarget.dispatchEvent(new MouseEvent('mouseup', pointerInit))
    outsideTarget.dispatchEvent(new MouseEvent('click', pointerInit))
    restorePlaybackState(videos)
    setTimeout(() => restorePlaybackState(videos), 80)
    setTimeout(() => {
      if (bilibiliDismissToken !== state.bilibiliDismissToken) {
        return
      }
      const stillVisible = quickEditors.filter((editor) => editor.isConnected && isVisible(editor))
      if (stillVisible.length) {
        forceHideBilibiliQuickBars(stillVisible)
      }
    }, 60)
  }

  dismissNow()
}
