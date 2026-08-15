import { beforeEach, describe, expect, it, vi } from 'vitest'

import { mergeSettings } from '../shared'
import { createDiagnosticsCollector } from '../diagnostics'

describe('DiagnosticsSnapshotV1', () => {
  beforeEach(() => {
    vi.stubGlobal('chrome', {
      runtime: { getManifest: () => ({ version: '2.3.0' }) },
    })
    vi.stubGlobal('navigator', { userAgent: 'Mozilla/5.0 Chrome/150.0.0.0' })
  })

  it('exports structural state without user or page data', () => {
    const collector = createDiagnosticsCollector({
      platform: 'bilibili',
      featureFlags: () => mergeSettings(),
      cacheCounts: () => ({ senderCorrelation: 12, csrf: 99 }),
      observerCounts: () => ({ sender: 1, cookie: 1 }),
      performance: () => ({ hoverP95: 14 }),
      selectorHits: () => ({ chatRoot: true, roomUrl: true }),
    })
    collector.record({ type: 'runtime.initialized', stage: 'content' })
    collector.record({ type: 'https://secret.example/room/7734200', stage: 'csrf-token' })

    const serialized = JSON.stringify(collector.snapshot())
    for (const sensitive of [
      'secret.example',
      '7734200',
      'csrf-token',
      '425992433',
      'a0795acc1a249c047c1a1d4ded31c4b1',
      'Cookie',
      '测试用户名',
    ]) {
      expect(serialized).not.toContain(sensitive)
    }
    expect(JSON.parse(serialized)).toMatchObject({
      browser: 'Chrome 150.0.0.0',
      extensionVersion: '2.3.0',
      platform: 'bilibili',
      schemaVersion: 1,
    })
  })

  it('keeps only the latest 100 structural events', () => {
    const collector = createDiagnosticsCollector({
      platform: 'huya',
      featureFlags: () => mergeSettings(),
    })
    for (let index = 0; index < 130; index += 1) {
      collector.record({ at: index + 1, type: 'candidate.selected', stage: 'chat' })
    }
    const snapshot = collector.snapshot()
    expect(snapshot.events).toHaveLength(100)
    expect(snapshot.events[0]?.at).toBe(31)
  })
})
