/** Indexed expiry heap: one deadline per live value, including renewed cluster TTLs. */
export class ExpirationQueue<T> {
  private heap: Array<{ value: T; at: number }> = []
  private positions = new Map<T, number>()

  get size(): number { return this.heap.length }

  clear(): void {
    this.heap = []
    this.positions.clear()
  }

  set(value: T, at: number): void {
    const index = this.positions.get(value)
    if (index !== undefined) {
      this.heap[index]!.at = at
      this.repair(index)
      return
    }
    this.positions.set(value, this.heap.length)
    this.heap.push({ value, at })
    this.up(this.heap.length - 1)
  }

  delete(value: T): void {
    const index = this.positions.get(value)
    if (index === undefined) return
    const last = this.heap.pop()!
    this.positions.delete(value)
    if (index === this.heap.length) return
    this.heap[index] = last
    this.positions.set(last.value, index)
    this.repair(index)
  }

  popBefore(now: number): T | undefined {
    const first = this.heap[0]
    // Existing windows include the exact deadline.
    if (!first || !(first.at < now)) return undefined
    this.delete(first.value)
    return first.value
  }

  private swap(first: number, second: number): void {
    const value = this.heap[first]!
    this.heap[first] = this.heap[second]!
    this.heap[second] = value
    this.positions.set(this.heap[first]!.value, first)
    this.positions.set(value.value, second)
  }

  private up(start: number): void {
    let index = start
    while (index > 0) {
      const parent = (index - 1) >>> 1
      if (this.heap[parent]!.at <= this.heap[index]!.at) break
      this.swap(parent, index)
      index = parent
    }
  }

  private repair(index: number): void {
    if (index > 0 && this.heap[index]!.at < this.heap[(index - 1) >>> 1]!.at) {
      this.up(index)
      return
    }
    while (index * 2 + 1 < this.heap.length) {
      let child = index * 2 + 1
      if (child + 1 < this.heap.length && this.heap[child + 1]!.at < this.heap[child]!.at) child++
      if (this.heap[index]!.at <= this.heap[child]!.at) break
      this.swap(index, child)
      index = child
    }
  }
}
