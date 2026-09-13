const NATIVE_DIALOG_SELECTOR =
  'dialog[open], [role="dialog"], [role="alertdialog"], [aria-modal="true"]'

export function pathTouchesNativeDialog(path: readonly EventTarget[]): boolean {
  return path.some(
    (target) => target instanceof Element && Boolean(target.closest(NATIVE_DIALOG_SELECTOR)),
  )
}

export function pointTouchesNativeDialog(document: Document, x: number, y: number): boolean {
  if (!Number.isFinite(x) || !Number.isFinite(y)) return false
  return (
    typeof document.elementsFromPoint === 'function' &&
    pathTouchesNativeDialog(document.elementsFromPoint(x, y))
  )
}
