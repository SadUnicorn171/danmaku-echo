import { afterEach, describe, expect, it, vi } from 'vitest'
import { pathTouchesNativeDialog, pointTouchesNativeDialog } from '../native-dialog-guard'

describe('native dialog pointer priority', () => {
  afterEach(() => {
    vi.restoreAllMocks()
    document.body.replaceChildren()
  })

  it.each(['dialog', 'alertdialog'])('recognizes a descendant of role %s', (role) => {
    const dialog = document.createElement('section')
    dialog.setAttribute('role', role)
    const button = document.createElement('button')
    dialog.append(button)
    expect(pathTouchesNativeDialog([button])).toBe(true)
  })

  it('uses the composed path across a shadow root', () => {
    const dialog = document.createElement('dialog')
    dialog.open = true
    const host = document.createElement('div')
    dialog.append(host)
    const child = document.createElement('button')
    host.attachShadow({ mode: 'open' }).append(child)
    expect(pathTouchesNativeDialog([child, host])).toBe(true)
  })

  it('does not block an ordinary player or a closed native dialog', () => {
    expect(pathTouchesNativeDialog([document.createElement('video'), window])).toBe(false)
    expect(pathTouchesNativeDialog([document.createElement('dialog')])).toBe(false)
  })

  it('detects a dialog behind the extension hit layer', () => {
    const dialog = document.createElement('section')
    dialog.setAttribute('aria-modal', 'true')
    const documentAtPoint = {
      elementsFromPoint: vi.fn<() => Element[]>(() => [document.createElement('div'), dialog]),
    } as unknown as Document
    expect(pointTouchesNativeDialog(documentAtPoint, 20, 30)).toBe(true)
    expect(pointTouchesNativeDialog(documentAtPoint, NaN, 30)).toBe(false)
    expect(pointTouchesNativeDialog({} as Document, 20, 30)).toBe(false)
  })
})
