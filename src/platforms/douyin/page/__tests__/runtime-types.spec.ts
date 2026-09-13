import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

import { describe, expect, expectTypeOf, it } from 'vitest'

import {
  RENDERER_FAILURE_REASONS,
  RENDERER_LIFECYCLE_STATES
} from '../runtime-types'
import type {
  AnimationFrameMilliseconds,
  CssPixels,
  Milliseconds,
  RendererActionRequest,
  RendererConfig,
  RendererFailureReason,
  RendererInstance,
  RendererLifecycleState,
  RendererTrack
} from '../runtime-types'

describe('Douyin page runtime types', () => {
  it('defines every renderer lifecycle state', () => {
    expect(RENDERER_LIFECYCLE_STATES).toEqual([
      'recovering',
      'observing',
      'active',
      'suspended',
      'blocked',
      'destroyed'
    ])
    expectTypeOf<RendererLifecycleState>()
      .toEqualTypeOf<(typeof RENDERER_LIFECYCLE_STATES)[number]>()
  })

  it('defines the bounded renderer failure reasons used by the page hook', () => {
    expect(RENDERER_FAILURE_REASONS).toEqual([
      'activation-metadata-mismatch',
      'animation-frame-error',
      'copy-metadata-mismatch',
      'favorite-metadata-mismatch',
      'fullscreen-relayout-error',
      'prepare-barrage-error',
      'reply-metadata-mismatch'
    ])
    expectTypeOf<RendererFailureReason>()
      .toEqualTypeOf<(typeof RENDERER_FAILURE_REASONS)[number]>()
  })

  it('expresses instance, track, request and unit ownership without any', () => {
    expectTypeOf<RendererInstance['config']>().toEqualTypeOf<RendererConfig>()
    expectTypeOf<RendererInstance['tracks']>().toEqualTypeOf<Map<number, RendererTrack>>()
    expectTypeOf<RendererInstance['pending']>().toEqualTypeOf<RendererTrack[]>()
    expectTypeOf<RendererInstance['lastFrameAt']>()
      .toEqualTypeOf<AnimationFrameMilliseconds | 0>()
    expectTypeOf<RendererConfig['width']>().toEqualTypeOf<CssPixels>()
    expectTypeOf<RendererConfig['duration']>().toEqualTypeOf<Milliseconds>()
    expectTypeOf<RendererActionRequest<'plus-one'>['track']>()
      .toEqualTypeOf<RendererTrack>()

    const source = readFileSync(
      resolve(process.cwd(), 'src/platforms/douyin/page/runtime-types.ts'),
      'utf8'
    )
    expect(source).not.toMatch(/\bany\b/u)
    expect(source).not.toContain('@ts-ignore')
    expect(source).not.toContain('@ts-expect-error')
  })
})
