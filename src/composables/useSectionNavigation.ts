import { subscribeUiMotion, uiMotionAllowed } from '../core/ui-motion'
import { nextTick, onBeforeUnmount, onMounted, ref } from 'vue'

export interface SectionMetric<T extends string> {
  id: T
  top: number
}

export function resolveActiveSection<T extends string>(
  sections: readonly SectionMetric<T>[],
  options: {
    activationOffset?: number
    atBottom?: boolean
  } = {},
): T | undefined {
  if (sections.length === 0) {
    return undefined
  }

  if (options.atBottom) {
    return sections[sections.length - 1]?.id
  }

  const activationOffset = options.activationOffset ?? 48
  let activeId = sections[0]?.id

  for (const section of sections) {
    if (section.top > activationOffset) {
      break
    }
    activeId = section.id
  }

  return activeId
}

export function useSectionNavigation<const T extends string>(sectionIds: readonly T[]) {
  const activeSection = ref<T>(sectionIds[0] as T)
  const contentCanvas = ref<HTMLElement | null>(null)
  let animationFrame = 0
  const stopMotion = subscribeUiMotion(allowed => {
    const root = contentCanvas.value
    if (!allowed && root) root.scrollTo?.({ top: root.scrollTop, left: root.scrollLeft, behavior: 'instant' })
  })

  function isSectionId(value: string): value is T {
    return sectionIds.includes(value as T)
  }

  function replaceHash(sectionId: T): void {
    if (window.location.hash === `#${sectionId}`) {
      return
    }
    window.history.replaceState(window.history.state, '', `#${sectionId}`)
  }

  function syncActiveSection(): void {
    animationFrame = 0
    const root = contentCanvas.value
    if (!root) {
      return
    }

    const rootTop = root.getBoundingClientRect().top
    const sections = sectionIds.flatMap((id) => {
      const element = document.getElementById(id)
      return element ? [{ id, top: element.getBoundingClientRect().top - rootTop }] : []
    })
    const atBottom =
      root.scrollHeight > root.clientHeight &&
      root.scrollHeight - root.scrollTop - root.clientHeight <= 2
    const nextSection = resolveActiveSection(sections, { atBottom })

    if (nextSection && nextSection !== activeSection.value) {
      activeSection.value = nextSection
      replaceHash(nextSection)
    }
  }

  function queueActiveSectionSync(): void {
    if (animationFrame !== 0) {
      return
    }
    animationFrame = window.requestAnimationFrame(syncActiveSection)
  }

  function scrollToSection(sectionId: T, behavior?: ScrollBehavior): void {
    const section = document.getElementById(sectionId)
    if (!section) {
      return
    }

    activeSection.value = sectionId
    replaceHash(sectionId)
    section.scrollIntoView({
      behavior:
        behavior ??
        (uiMotionAllowed() ? 'smooth' : 'auto'),
      block: 'start',
    })
    queueActiveSectionSync()
  }

  function handleHashChange(): void {
    const sectionId = decodeURIComponent(window.location.hash.slice(1))
    if (isSectionId(sectionId)) {
      scrollToSection(sectionId, 'auto')
    }
  }

  onMounted(async () => {
    await nextTick()
    contentCanvas.value?.addEventListener('scroll', queueActiveSectionSync, { passive: true })
    window.addEventListener('resize', queueActiveSectionSync, { passive: true })
    window.addEventListener('hashchange', handleHashChange)

    const initialSection = decodeURIComponent(window.location.hash.slice(1))
    if (isSectionId(initialSection)) {
      scrollToSection(initialSection, 'auto')
    } else {
      syncActiveSection()
    }
  })

  onBeforeUnmount(() => {
    stopMotion()
    contentCanvas.value?.removeEventListener('scroll', queueActiveSectionSync)
    window.removeEventListener('resize', queueActiveSectionSync)
    window.removeEventListener('hashchange', handleHashChange)
    if (animationFrame !== 0) {
      window.cancelAnimationFrame(animationFrame)
    }
  })

  return {
    activeSection,
    contentCanvas,
    scrollToSection,
  }
}
