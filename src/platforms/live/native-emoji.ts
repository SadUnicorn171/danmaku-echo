export interface NativeEmojiCandidate<TItem> {
  item: TItem
  score: number
}

export function uniqueHighestScoringItem<TCandidate, TItem>(
  candidates: Iterable<TCandidate>,
  itemFromCandidate: (candidate: TCandidate) => TItem,
  scoreCandidate: (candidate: TCandidate) => number,
  minimumScore = 4,
): TItem | null {
  const matches = new Map<TItem, NativeEmojiCandidate<TItem>>()
  for (const candidate of candidates) {
    const score = scoreCandidate(candidate)
    if (score < minimumScore) continue
    const item = itemFromCandidate(candidate)
    const previous = matches.get(item)
    if (!previous || score > previous.score) {
      matches.set(item, { item, score })
    }
  }

  const ranked = Array.from(matches.values()).sort((first, second) => second.score - first.score)
  if (!ranked.length) return null
  const bestScore = ranked[0].score
  const best = ranked.filter((match) => match.score === bestScore)
  return best.length === 1 ? best[0].item : null
}
