const RICH_PIECE_SELECTOR = "[class*='webcast-chatroom___content-with-emoji-']";

export function findDouyinMessageContent(
  row: Element,
  fallbackSelectors: readonly string[]
): Element {
  const groups = new Map<Element, { emoji: number; pieces: number }>();
  row.querySelectorAll(RICH_PIECE_SELECTOR).forEach((piece) => {
    const parent = piece.parentElement;
    if (!parent || !row.contains(parent)) return;
    const group = groups.get(parent) || { emoji: 0, pieces: 0 };
    group.pieces += 1;
    if (piece.querySelector("img") || piece.matches("[class*='-emoji-emoji']")) {
      group.emoji += 1;
    }
    groups.set(parent, group);
  });
  const richContainer = [...groups.entries()]
    .filter(([, group]) => group.emoji > 0)
    .sort((left, right) =>
      right[1].emoji * 100 + right[1].pieces - (left[1].emoji * 100 + left[1].pieces)
    )[0]?.[0];
  if (richContainer) return richContainer;

  for (const selector of fallbackSelectors) {
    try {
      const element = row.matches(selector) ? row : row.querySelector(selector);
      if (element) return element;
    } catch {
      // Ignore selectors unsupported by the current browser.
    }
  }
  return row;
}
