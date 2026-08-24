import { normalizeRepeatReminderQueueLimit } from '../../core/repeat-reminder-settings'
import type { RepeatReminderSuggestion } from './types'

export class RepeatReminderSelection {
  private active: RepeatReminderSuggestion[] = []
  private discarded = new Set<string>()
  private limit: number

  constructor(limit = 3) {
    this.limit = normalizeRepeatReminderQueueLimit(limit)
  }

  current(): RepeatReminderSuggestion[] {
    return [...this.active]
  }

  dismiss(suggestion: RepeatReminderSuggestion): void {
    this.active = this.active.filter((item) => item.id !== suggestion.id)
  }

  replace(suggestion: RepeatReminderSuggestion): RepeatReminderSuggestion | null {
    if (this.discarded.has(suggestion.id)) return null
    const existingIndex = this.active.findIndex((item) => item.id === suggestion.id)
    if (existingIndex >= 0) this.active[existingIndex] = suggestion
    else this.active.unshift(suggestion)
    this.retireOverflow()
    return suggestion
  }

  reset(): void {
    this.active = []
    this.discarded.clear()
  }

  setLimit(limit: number): void {
    this.limit = normalizeRepeatReminderQueueLimit(limit)
    this.retireOverflow()
  }

  private retireOverflow(): void {
    this.active.splice(this.limit).forEach((item) => this.discarded.add(item.id))
  }
}
