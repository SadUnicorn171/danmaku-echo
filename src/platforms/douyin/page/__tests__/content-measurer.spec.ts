import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

import { describe, expect, it } from 'vitest'

import { createDouyinContentMeasurer } from '../content-measurer'

function rendererConfig(fontSize = 20): { fontSize: number } {
  return { fontSize }
}

describe('Douyin content measurer', () => {
  it('measures text and box edges in CSS pixels', () => {
    const measurer = createDouyinContentMeasurer({
      createContext: () => ({
        font: '',
        measureText: (text) => ({ width: Array.from(text).length * 10 }),
      }),
      fontAvailability: () => 'available',
    })

    const result = measurer.measure(
      {
        content: [
          {
            borderWidth: 1,
            color: '#ff4471',
            fontFamily: 'PingFang SC',
            fontSize: 20,
            fontWeight: 600,
            margin: [1, 2, 3, 4],
            padding: 2,
            strokeColor: '#000000',
            strokeWidth: 2,
            text: '你好',
            type: 'text',
          },
        ],
      },
      rendererConfig(),
    )

    expect(result).toMatchObject({
      firstText: {
        color: '#ff4471',
        fontFamily: 'PingFang SC',
        fontSize: 20,
        fontWeight: '600',
        strokeColor: '#000000',
        strokeWidth: 2,
      },
      height: 30,
      imageCount: 0,
      text: '你好',
      width: 32,
    })
  })

  it('uses known Emoji image ratios without reading layout', () => {
    const measurer = createDouyinContentMeasurer({ createContext: () => null })
    const source = 'https://example.com/emoji.png'

    const result = measurer.measure(
      {
        content: [{ height: 24, src: source, type: 'image', width: 24 }],
      },
      rendererConfig(),
      undefined,
      new Map([[source, 2.5]]),
    )

    expect(result).toMatchObject({ height: 24, imageCount: 1, text: '', width: 60 })
  })

  it('combines nested inline content horizontally and block content vertically', () => {
    const measurer = createDouyinContentMeasurer({
      createContext: () => ({
        font: '',
        measureText: (text) => ({ width: Array.from(text).length * 5 }),
      }),
      fontAvailability: () => true,
    })

    const result = measurer.measure(
      {
        content: [
          {
            content: [
              { fontSize: 10, text: 'aa', type: 'text' },
              { height: 10, src: 'emoji.png', type: 'image', width: 10 },
            ],
            type: 'block',
          },
          {
            content: [{ fontSize: 10, text: 'b', type: 'text' }],
            type: 'block',
          },
        ],
      },
      rendererConfig(10),
    )

    expect(result).toMatchObject({ height: 20, imageCount: 1, text: 'aab', width: 20 })
  })

  it('scales fallback text measurement from renderer font size without using DPR', () => {
    const measurer = createDouyinContentMeasurer({ createContext: () => null })
    const options = { content: [{ text: 'AB', type: 'text' }] }

    expect(measurer.measure(options, rendererConfig(20))).toMatchObject({
      height: 20,
      width: 40,
    })
    expect(measurer.measure(options, rendererConfig(40))).toMatchObject({
      height: 40,
      width: 80,
    })
  })

  it('keys text metrics by font, text and availability and supports explicit invalidation', () => {
    let availability = 'loading'
    let calls = 0
    const measurer = createDouyinContentMeasurer({
      createContext: () => ({
        font: '',
        measureText: (text) => {
          calls += 1
          return { width: Array.from(text).length * 7 }
        },
      }),
      fontAvailability: () => availability,
      maxTextCacheEntries: 4,
    })
    const options = { content: [{ text: '缓存', type: 'text' }] }

    measurer.measure(options, rendererConfig())
    measurer.measure(options, rendererConfig())
    expect(calls).toBe(1)
    expect(measurer.diagnostics()).toMatchObject({ cacheHits: 1, cacheMisses: 1 })

    availability = 'available'
    measurer.measure(options, rendererConfig())
    expect(calls).toBe(2)

    measurer.invalidate()
    measurer.measure(options, rendererConfig())
    expect(calls).toBe(3)
    expect(measurer.diagnostics()).toMatchObject({
      cacheInvalidations: 1,
      cachedTextMeasurements: 1,
    })
  })

  it('keeps measurement implementation outside the MAIN-world entry', () => {
    const app = readFileSync(
      resolve(process.cwd(), 'src/platforms/douyin/page/page-app.ts'),
      'utf8',
    )

    expect(app).toContain('createDouyinContentMeasurer')
    expect(app).toContain('contentMeasurer.measure')
    expect(app).not.toContain('function measureTextItem')
    expect(app).not.toContain('function measureImageItem')
    expect(app).not.toContain('function measureContent')
    expect(app).not.toContain('function describeBarrage')
    expect(app).not.toContain('measurementContext')
  })
})
