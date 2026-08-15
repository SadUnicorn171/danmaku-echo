import { describe, expect, it } from 'vitest'

import {
  DOUYU_NATIVE_DANMAKU_ACTION_SELECTORS,
  DOUYU_NATIVE_DANMAKU_CAPSULE_CONTAINER_SELECTORS,
  DOUYU_NATIVE_DANMAKU_CAPSULE_DECORATION_SELECTORS,
  DOUYU_NATIVE_DANMAKU_CAPSULE_DETACHED_DECORATION_SELECTORS,
  DouyuNativeCapsuleVisibilityController,
  findDouyuNativeDanmakuCapsuleTargets,
} from '../native-capsule'

function element(markup: string): Element {
  const host = document.createElement('div')
  host.innerHTML = markup
  return host.firstElementChild!
}

describe('Douyu native danmaku capsule detection', () => {
  it('detects the current hashed action classes and their shared capsule', () => {
    const root = element(`
      <div class="danmuItem-a8616a">
        <div class="afterDiv-fa09b0">
          <span class="text-da6396">测试弹幕</span>
          <span class="afterpic-e66834"></span>
        </div>
        <div class="native-capsule">
          <span class="interactive-element-a81139">+1</span>
          <span class="reply-button-cad30d">回复</span>
          <span class="action-button-a41794">收藏</span>
        </div>
      </div>
    `)
    const capsule = root.querySelector('.native-capsule')!
    const targets = findDouyuNativeDanmakuCapsuleTargets(root)

    expect(DOUYU_NATIVE_DANMAKU_ACTION_SELECTORS).toContain("[class*='interactive-element-']")
    expect(DOUYU_NATIVE_DANMAKU_CAPSULE_CONTAINER_SELECTORS).toContain(
      ":is(div, span):not([class*='danmuItem-']):has(> [class*='interactive-element-']):has(> [class*='reply-button-'])",
    )
    expect(targets).toContain(capsule)
    expect(targets).toEqual(expect.arrayContaining(Array.from(capsule.children)))
    expect(targets).not.toContain(root.querySelector('.afterDiv-fa09b0'))
    expect(DOUYU_NATIVE_DANMAKU_CAPSULE_DECORATION_SELECTORS).not.toContain(
      "[class*='afterpic-']",
    )
    expect(DOUYU_NATIVE_DANMAKU_CAPSULE_DECORATION_SELECTORS).not.toContain(
      "[class*='afterDiv-']",
    )
    expect(targets).not.toContain(root.querySelector('.afterpic-e66834'))
  })

  it('does not target the moving tail or message wrapper from JavaScript', () => {
    const root = element(`
      <div class="danmuItem-normal">
        <div class="afterDiv-normal">
          <span class="text-normal">普通弹幕</span>
          <span class="afterpic-normal"></span>
        </div>
      </div>
    `)

    expect(findDouyuNativeDanmakuCapsuleTargets(root)).not.toContain(
      root.querySelector('.afterpic-normal'),
    )
    expect(findDouyuNativeDanmakuCapsuleTargets(root)).not.toContain(
      root.querySelector('.afterDiv-normal'),
    )
  })

  it('hides every action-only shell below the danmaku item', () => {
    const root = element(`
      <div class="danmuItem-next">
        <span class="text-next">测试弹幕</span>
        <div class="native-tail-shell">
          <div class="native-arrow"></div>
          <div class="native-actions">
            <span class="interactive-element-next">+1</span>
            <span class="reply-button-next">回复</span>
            <span class="action-button-next">收藏</span>
          </div>
        </div>
      </div>
    `)
    const targets = findDouyuNativeDanmakuCapsuleTargets(root)

    expect(targets).toContain(root.querySelector('.native-actions'))
    expect(targets).toContain(root.querySelector('.native-tail-shell'))
    expect(targets).not.toContain(root)
    expect(targets).not.toContain(root.querySelector('.text-next'))
  })

  it('does not write attributes or inline styles into a moving danmaku subtree', () => {
    const root = element(`
      <div class="danmuItem-next">
        <span class="afterpic-next"></span>
        <div class="native-capsule">
          <span class="interactive-element-next">+1</span>
          <span class="reply-button-next">回复</span>
          <span class="action-button-next">收藏</span>
        </div>
      </div>
    `)
    document.body.append(root)
    const tail = root.querySelector<HTMLElement>('.afterpic-next')!
    const controller = new DouyuNativeCapsuleVisibilityController()

    controller.hide(findDouyuNativeDanmakuCapsuleTargets(root))
    expect(tail.hidden).toBe(false)
    expect(tail.style.getPropertyValue('display')).toBe('')
    expect(tail.style.getPropertyValue('visibility')).toBe('')
    expect(tail.hasAttribute('data-bcp-douyu-native-action-hidden')).toBe(false)
    expect(root.querySelector('.native-capsule')?.hasAttribute('hidden')).toBe(false)
    expect(controller.hiddenCount).toBe(0)

    controller.showAll()
    expect(tail.hidden).toBe(false)
    expect(tail.style.getPropertyValue('display')).toBe('')
    expect(tail.style.getPropertyValue('visibility')).toBe('')
    root.remove()
  })

  it('keeps an afterDiv message wrapper completely untouched', () => {
    const root = element(`
      <div class="danmuItem-next">
        <div class="afterDiv-next"><span class="text-next">测试弹幕</span></div>
      </div>
    `)
    document.body.append(root)
    const wrapper = root.querySelector<HTMLElement>('.afterDiv-next')!
    const controller = new DouyuNativeCapsuleVisibilityController()

    controller.hide(findDouyuNativeDanmakuCapsuleTargets(root))
    expect(wrapper.hidden).toBe(false)
    expect(wrapper.style.getPropertyValue('display')).toBe('')
    expect(wrapper.style.getPropertyValue('visibility')).toBe('')
    expect(wrapper.hasAttribute('data-bcp-douyu-native-action-hidden')).toBe(false)

    controller.showAll()
    expect(wrapper.hasAttribute('data-bcp-douyu-native-action-hidden')).toBe(false)
    root.remove()
  })

  it('detects and hides a native capsule mounted outside the danmaku item', () => {
    const portal = element(`
      <div id="comment-dzjy-container">
        <div class="btnscontainer-4e2ed0">
          <div class="btnscontainerrect-6e7730" style="left: 203.244px"></div>
          <div class="native-capsule btnsInner-03a19c">
          <span class="interactive-element-a81139">+1</span>
          <span class="reply-button-cad30d">回复</span>
          <span class="action-button-a41794">收藏</span>
          </div>
        </div>
      </div>
    `)
    document.body.append(portal)
    const capsule = portal.querySelector<HTMLElement>('.native-capsule')!
    const triangle = portal.querySelector<HTMLElement>('.btnscontainerrect-6e7730')!
    const targets = findDouyuNativeDanmakuCapsuleTargets(portal)
    const controller = new DouyuNativeCapsuleVisibilityController()

    expect(targets).toContain(capsule)
    expect(DOUYU_NATIVE_DANMAKU_CAPSULE_DETACHED_DECORATION_SELECTORS).toContain(
      "[class*='btnscontainerrect-']",
    )
    expect(DOUYU_NATIVE_DANMAKU_CAPSULE_DECORATION_SELECTORS).toContain(
      "[class*='btnscontainerrect-']",
    )
    expect(targets).toContain(triangle)
    controller.hide(targets)
    expect(capsule.hidden).toBe(true)
    expect(capsule.style.getPropertyValue('display')).toBe('none')
    expect(triangle.hidden).toBe(true)
    expect(triangle.style.getPropertyValue('display')).toBe('none')

    controller.showAll()
    expect(capsule.hidden).toBe(false)
    expect(capsule.style.getPropertyValue('display')).toBe('')
    expect(triangle.hidden).toBe(false)
    expect(triangle.style.getPropertyValue('display')).toBe('')
    portal.remove()
  })

  it('falls back to the +1, reply and favorite label structure', () => {
    const root = element(`
      <div class="danmuItem-next">
        <div class="future-native-actions">
          <i>+1</i><i>回复</i><i>收藏</i>
        </div>
      </div>
    `)

    expect(findDouyuNativeDanmakuCapsuleTargets(root)).toContain(
      root.querySelector('.future-native-actions'),
    )
  })

  it('never treats the danmaku renderer itself as the capsule', () => {
    const root = element(`
      <div class="danmuItem-next">
        <span class="text-next">测试弹幕</span>
        <span class="interactive-element-next">+1</span>
        <span class="reply-button-next">回复</span>
        <span class="action-button-next">收藏</span>
      </div>
    `)
    const targets = findDouyuNativeDanmakuCapsuleTargets(root)

    expect(targets).not.toContain(root)
    expect(targets).toEqual(expect.arrayContaining(Array.from(root.children).slice(1)))
  })

  it('does not hide a normal danmaku whose content is an action word', () => {
    const root = element(`
      <div class="danmuItem-next">
        <div class="text-next"><span>回复</span></div>
      </div>
    `)

    expect(findDouyuNativeDanmakuCapsuleTargets(root)).toEqual([])
  })

  it('applies a v-show-like inline hidden state and restores the original styles', () => {
    const root = element(`
      <div
        class="native-capsule"
        aria-hidden="false"
        style="display: flex; visibility: visible; pointer-events: auto"
      >
        <i>+1</i><i>回复</i><i>收藏</i>
      </div>
    `)
    document.body.append(root)
    const capsule = root as HTMLElement
    const controller = new DouyuNativeCapsuleVisibilityController()

    controller.hide([capsule])

    expect(capsule.hidden).toBe(true)
    expect(capsule.getAttribute('aria-hidden')).toBe('true')
    expect(capsule.style.getPropertyValue('display')).toBe('none')
    expect(capsule.style.getPropertyPriority('display')).toBe('important')
    expect(controller.hiddenCount).toBe(1)

    controller.showAll()

    expect(capsule.hasAttribute('hidden')).toBe(false)
    expect(capsule.getAttribute('aria-hidden')).toBe('false')
    expect(capsule.style.display).toBe('flex')
    expect(capsule.style.visibility).toBe('visible')
    expect(capsule.style.pointerEvents).toBe('auto')
    expect(controller.hiddenCount).toBe(0)
    root.remove()
  })

  it('reasserts hidden styles if Douyu rewrites the component', () => {
    const root = element(`
      <div class="native-capsule"><i>+1</i><i>回复</i><i>收藏</i></div>
    `)
    document.body.append(root)
    const capsule = root as HTMLElement
    const controller = new DouyuNativeCapsuleVisibilityController()
    controller.hide([capsule])

    capsule.hidden = false
    capsule.style.setProperty('display', 'flex', 'important')
    controller.reinforce()

    expect(capsule.hidden).toBe(true)
    expect(capsule.style.getPropertyValue('display')).toBe('none')
    expect(capsule.style.getPropertyPriority('display')).toBe('important')
    root.remove()
  })
})
