/** UI-only policy. Never apply this to player or native danmaku motion. */
const subscribers = new Set<(allowed: boolean) => void>()
let performanceMode = false
let media: MediaQueryList | undefined
let stop: (() => void) | undefined
let revision = 0

export function uiMotionAllowed(): boolean {
  return (
    !performanceMode &&
    !document.hidden &&
    !(media ?? window.matchMedia?.('(prefers-reduced-motion: reduce)'))?.matches
  )
}

function publish(): void {
  const allowed = uiMotionAllowed()
  document.documentElement.dataset.bcpUiMotion = allowed ? 'on' : 'off'
  for (const listener of subscribers) listener(allowed)
}

export function setPerformanceMode(value: boolean): void {
  revision++
  performanceMode = value
  publish()
}

export function subscribeUiMotion(listener: (allowed: boolean) => void): () => void {
  subscribers.add(listener)
  if (!stop) {
    media = window.matchMedia?.('(prefers-reduced-motion: reduce)')
    const changed = (changes: Record<string, chrome.storage.StorageChange>, area: string) => {
      if (area === 'sync' && changes.performanceMode) {
        setPerformanceMode(changes.performanceMode.newValue === true)
      }
    }
    const storage = globalThis.chrome?.storage
    try {
      storage?.onChanged?.addListener(changed)
    } catch {
      // An unpacked extension reload can invalidate the previous isolated world.
    }
    media?.addEventListener?.('change', publish)
    document.addEventListener('visibilitychange', publish)
    stop = () => {
      revision++
      try {
        storage?.onChanged?.removeListener(changed)
      } catch {
        // Local cleanup must still run after the extension context is invalidated.
      }
      media?.removeEventListener?.('change', publish)
      document.removeEventListener('visibilitychange', publish)
      media = undefined
      document.documentElement.removeAttribute('data-bcp-ui-motion')
    }
    const current = revision
    try {
      storage?.sync?.get?.(['performanceMode'], (saved) => {
        if (stop && current === revision && !globalThis.chrome?.runtime?.lastError) {
          performanceMode = saved?.performanceMode === true
          publish()
        }
      })
    } catch {
      // Keep the current preference if storage is no longer available.
    }
  }
  publish()
  return () => {
    subscribers.delete(listener)
    if (!subscribers.size) {
      stop?.()
      stop = undefined
    }
  }
}

// Scope to extension surfaces, including their shadow roots; never disable site animations.
const instantStyles = `
[data-bcp-motion="off"], [data-bcp-motion="off"] *,
[data-bcp-motion="off"] *::before, [data-bcp-motion="off"] *::after,
:host([data-bcp-motion="off"]) *, :host([data-bcp-motion="off"]) *::before,
:host([data-bcp-motion="off"]) *::after {
  animation: none !important; transition: none !important; scroll-behavior: auto !important;
}
[data-bcp-motion="off"] button:active { scale: none !important; }
[data-bcp-motion="off"] button:active:not(.bcp-favorites-radial-item),
:host([data-bcp-motion="off"]) button:active:not(.bcp-favorites-radial-item) { transform: none !important; }
:host([data-bcp-motion="off"]) .bcp-favorites-radial-center,
:host([data-bcp-motion="off"]) .bcp-favorites-radial-bot-eyes { transform: none !important; }
:host([data-bcp-motion="off"]) .bcp-favorites-radial-item.is-selected { transform: translate(-50%, -50%) !important; }
[data-bcp-ui-motion="off"] .bcp-douyin-dom-action,
[data-bcp-ui-motion="off"] .bcp-douyin-dom-action-item { animation: none !important; transition: none !important; transform: none !important; }
`

export function mountUiMotion(root: HTMLElement): () => void {
  const style = document.createElement('style')
  style.textContent = instantStyles
  // Vue owns the root's children; keep policy styles outside Vue's render target.
  const container = root.shadowRoot ?? root.parentNode ?? document.head
  container.appendChild(style)
  const unsubscribe = subscribeUiMotion((allowed) => {
    root.dataset.bcpMotion = allowed ? 'on' : 'off'
  })
  return () => {
    unsubscribe()
    style.remove()
    delete root.dataset.bcpMotion
  }
}

export function createUiAnimator() {
  const animations = new Set<Animation>()
  const clear = () => {
    for (const animation of animations) animation.cancel()
    animations.clear()
  }
  const unsubscribe = subscribeUiMotion((allowed) => {
    if (!allowed) clear()
  })
  return {
    play(element: HTMLElement, frames: Keyframe[], duration: number, delay = 0): Animation | null {
      if (!uiMotionAllowed() || typeof element.animate !== 'function') return null
      let animation: Animation
      try {
        animation = element.animate(frames, {
          duration,
          delay,
          easing: 'cubic-bezier(0.2, 0.8, 0.2, 1)',
          fill: 'both',
        })
      } catch {
        return null
      }
      animations.add(animation)
      void animation.finished.then(
        () => {
          animations.delete(animation)
          animation.cancel()
        },
        () => {
          animations.delete(animation)
        },
      )
      return animation
    },
    clear,
    destroy() {
      clear()
      unsubscribe()
    },
  }
}
