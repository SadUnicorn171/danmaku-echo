const MAX_SIMILARITY_LENGTH = 160
const SHORT_TEXT_LENGTH = 6
const SHORT_TEXT_THRESHOLD = 0.74
const STANDARD_TEXT_THRESHOLD = 0.82

const NEGATION_PATTERN = /不是|不能|不会|没有|不|没|无|未|别|莫|勿|否|非/gu
const URL_PATTERN = /(?:https?:\/\/|www\.)[^\s]+/giu
const NUMBER_PATTERN = /\d+(?:[.:/-]\d+)*/gu
const LATIN_TOKEN_PATTERN = /[a-z][a-z0-9_-]*/giu
const EMOJI_PATTERN = /\p{Extended_Pictographic}/gu

export interface RepeatReminderSimilarityProfile {
  canonical: string
  emoji: string
  latin: string
  negation: string
  numbers: string
  normalized: string
  urls: string
}

export function normalizeRepeatReminderText(value: unknown): string {
  let text = String(value || '').replace(/\s+/gu, ' ').trim()
  try { text = text.normalize('NFKC') } catch { /* Older Chromium fallback. */ }
  return text.toLocaleLowerCase('zh-CN')
}

function collapsePeriodicText(value: string): string {
  if (!value || EMOJI_PATTERN.test(value)) {
    EMOJI_PATTERN.lastIndex = 0
    return value
  }
  EMOJI_PATTERN.lastIndex = 0
  const characters = Array.from(value)
  for (let size = 1; size <= Math.min(12, Math.floor(characters.length / 2)); size += 1) {
    if (characters.length % size !== 0) continue
    const unit = characters.slice(0, size)
    let matches = true
    for (let index = size; index < characters.length; index += 1) {
      if (characters[index] !== unit[index % size]) {
        matches = false
        break
      }
    }
    if (matches) return unit.join('')
  }
  return value
}

export function canonicalRepeatReminderText(value: unknown): string {
  const normalized = normalizeRepeatReminderText(value)
    .replace(/[？?]+/gu, '?')
    .replace(/[！!]+/gu, '!')
    .replace(/[。．.]+/gu, '.')
    .replace(/[，,]+/gu, ',')
    .replace(/[～~]+/gu, '~')
    .replace(/…+/gu, '…')
    .replace(/([\p{Script=Han}])\s+(?=[\p{Script=Han}])/gu, '$1')
  return collapsePeriodicText(normalized)
}

function matches(value: string, pattern: RegExp): string {
  pattern.lastIndex = 0
  const result = value.match(pattern) || []
  pattern.lastIndex = 0
  return result.join('|')
}

export function repeatReminderSimilarityProfile(value: unknown): RepeatReminderSimilarityProfile {
  const normalized = normalizeRepeatReminderText(value).slice(0, MAX_SIMILARITY_LENGTH)
  return {
    canonical: canonicalRepeatReminderText(normalized),
    emoji: matches(normalized, EMOJI_PATTERN),
    latin: matches(normalized, LATIN_TOKEN_PATTERN),
    negation: matches(normalized, NEGATION_PATTERN),
    normalized,
    numbers: matches(normalized, NUMBER_PATTERN),
    urls: matches(normalized, URL_PATTERN),
  }
}

export function repeatReminderSimilarityBuckets(value: unknown): string[] {
  const canonical = canonicalRepeatReminderText(value)
  const characters = Array.from(canonical)
  if (characters.length < 2) return canonical ? [`exact:${canonical}`] : []
  return Array.from(ngrams(canonical, 2), (gram) => `bigram:${gram}`)
}

function protectedEntitiesMatch(
  first: RepeatReminderSimilarityProfile,
  second: RepeatReminderSimilarityProfile,
): boolean {
  return first.numbers === second.numbers
    && first.urls === second.urls
    && first.emoji === second.emoji
    && first.negation === second.negation
    && first.latin === second.latin
}

function ngrams(value: string, size: number): Set<string> {
  const characters = Array.from(value)
  if (characters.length <= size) return new Set([value])
  const result = new Set<string>()
  for (let index = 0; index <= characters.length - size; index += 1) {
    result.add(characters.slice(index, index + size).join(''))
  }
  return result
}

function diceCoefficient(first: Set<string>, second: Set<string>): number {
  if (!first.size && !second.size) return 1
  let intersection = 0
  for (const value of first) {
    if (second.has(value)) intersection += 1
  }
  return (2 * intersection) / (first.size + second.size)
}

function editSimilarity(first: string, second: string): number {
  const left = Array.from(first)
  const right = Array.from(second)
  if (!left.length || !right.length) return left.length === right.length ? 1 : 0
  let previous = Array.from({ length: right.length + 1 }, (_, index) => index)
  for (let row = 1; row <= left.length; row += 1) {
    const current = [row]
    for (let column = 1; column <= right.length; column += 1) {
      current[column] = Math.min(
        current[column - 1] + 1,
        previous[column] + 1,
        previous[column - 1] + (left[row - 1] === right[column - 1] ? 0 : 1),
      )
    }
    previous = current
  }
  return 1 - previous[right.length] / Math.max(left.length, right.length)
}

function tokenSet(value: string): Set<string> {
  const latin = value.match(LATIN_TOKEN_PATTERN) || []
  const han = Array.from(value.replace(/[^\p{Script=Han}]/gu, ''))
  return new Set([...latin, ...ngrams(han.join(''), 2)])
}

export function repeatReminderSimilarity(firstValue: unknown, secondValue: unknown): number {
  const first = repeatReminderSimilarityProfile(firstValue)
  const second = repeatReminderSimilarityProfile(secondValue)
  if (!first.canonical || !second.canonical) return 0
  if (!protectedEntitiesMatch(first, second)) return 0
  if (first.canonical === second.canonical) return 1
  const bigramScore = diceCoefficient(ngrams(first.canonical, 2), ngrams(second.canonical, 2))
  const tokenScore = diceCoefficient(tokenSet(first.canonical), tokenSet(second.canonical))
  const editScore = editSimilarity(first.canonical, second.canonical)
  const containmentBonus = first.canonical.includes(second.canonical)
    || second.canonical.includes(first.canonical) ? 0.08 : 0
  return Math.min(1, bigramScore * 0.4 + editScore * 0.35 + tokenScore * 0.25 + containmentBonus)
}

export function areRepeatReminderTextsSimilar(first: unknown, second: unknown): boolean {
  const firstLength = Array.from(canonicalRepeatReminderText(first)).length
  const secondLength = Array.from(canonicalRepeatReminderText(second)).length
  const threshold = Math.min(firstLength, secondLength) <= SHORT_TEXT_LENGTH
    ? SHORT_TEXT_THRESHOLD
    : STANDARD_TEXT_THRESHOLD
  return repeatReminderSimilarity(first, second) >= threshold
}
