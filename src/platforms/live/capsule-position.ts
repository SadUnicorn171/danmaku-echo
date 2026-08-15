export type OverlayCapsuleSide = 'left' | 'right'

export interface OverlayCapsulePlacementInput {
  anchorLeft: number
  anchorRight: number
  capsuleWidth: number
  viewportLeft: number
  viewportRight: number
  gap?: number
  inset?: number
}

export interface OverlayCapsulePlacement {
  fullyEntered: boolean
  left: number
  side: OverlayCapsuleSide
}

/**
 * Keep the toolbar beside, never on top of, a moving danmaku. A danmaku enters
 * from the right, so its right edge is the authoritative "fully entered"
 * boundary. Until that edge is visible and there is room for the whole
 * toolbar, the toolbar stays on the left.
 */
export function overlayCapsulePlacement(
  input: OverlayCapsulePlacementInput,
): OverlayCapsulePlacement {
  const {
    anchorLeft,
    anchorRight,
    capsuleWidth,
    viewportRight,
    gap = 8,
    inset = 8,
  } = input
  const safeWidth = Math.max(0, Number(capsuleWidth) || 0)
  const safeGap = Math.max(0, Number(gap) || 0)
  const safeInset = Math.max(0, Number(inset) || 0)
  const fullyEntered = anchorRight <= viewportRight - safeInset
  const rightLeft = anchorRight + safeGap
  const side: OverlayCapsuleSide =
    fullyEntered && rightLeft + safeWidth <= viewportRight - safeInset ? 'right' : 'left'
  const desiredLeft = side === 'right' ? rightLeft : anchorLeft - safeGap - safeWidth

  // Do not clamp a left-side fallback back across the barrage. In the rare
  // case where neither side can contain the toolbar, clipping part of the
  // toolbar is less harmful than covering the text the user is operating on.
  return { fullyEntered, left: desiredLeft, side }
}
