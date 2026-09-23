import { createDouyinDomRenderer as baseline } from './dom-renderer'
import { createDouyinDomRenderer as current } from '../../../src/platforms/douyin/page/dom-renderer'
import { createRendererInstanceRegistry } from '../../../src/platforms/douyin/page/renderer-instance-registry'
import { createRendererTrackController } from '../../../src/platforms/douyin/page/track-controller'
import { initialTrackMotion } from '../../../src/platforms/douyin/page/track-motion'
import type { RendererTrack } from '../../../src/platforms/douyin/page/runtime-types'

const percentile = (values: number[], fraction: number) => [...values].sort((a, b) => a - b)[Math.max(0, Math.ceil(values.length * fraction) - 1)] || 0
const frame = () => new Promise<void>((resolve) => requestAnimationFrame(() => resolve()))

export async function measureRenderer() {
  const results: unknown[] = []
  const assertionFailures: string[] = []
  for (const trackCount of [0, 80]) for (const moving of [false, true]) for (let run = 0; run < 3; run++) {
    for (const [name, create] of run % 2 ? [['current', current], ['baseline', baseline]] as const : [['baseline', baseline], ['current', current]] as const) {
      const controller = createRendererTrackController({
        actionBaseHeight: 40, actionDividerWidth: 2, actionGap: 8, actionTrailingSpace: 12,
        actionItemWidths: { copy: 56, favorite: 56, plusOne: 56, reply: 56 },
        document, target: window, frozenTrackTimeout: 20_000, hoverLeaveGrace: 220, requestTimeout: 8_000,
        getDevicePixelRatio: () => 1, isEnabled: () => true, onFailure: () => assertionFailures.push('track-controller-failure'),
        getBridge: () => ({ start() {}, destroy() {}, send() {}, request() { return () => {} } }),
      })
      const renderer = create({ actionGap: 8, actionTrailingSpace: 12, document, getComputedStyle,
        nodeLimit: 160, trackController: controller, beforeShutdown: (instance) => controller.clearInstance(instance) })
      const canvas = document.createElement('canvas')
      canvas.style.cssText = 'width:800px;height:480px;visibility:visible'
      document.body.append(canvas)
      const registry = createRendererInstanceRegistry({
        canvasHook: { canvasId: () => 1, findUnclaimedCanvas: () => null, isDanmakuCanvas: () => true, markerFor: () => 'performance' },
        onBarrage() {}, clearInstance: (instance, reason) => renderer.shutdown(instance, reason),
      })
      const instance = registry.create('performance-instance', canvas, { width: 800, height: 480, channelHeight: 40 })!
      for (let index = 0; index < trackCount; index++) {
        const track: RendererTrack = {
          id: index + 1, instance, bookedChannel: { start: index % 12, end: index % 12 },
          content: [{ type: 'text', text: '性能测试弹幕', fontSize: 20 }, { type: 'image', src: 'data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7', width: 20, height: 20 }],
          description: { actionWidth: 172, contentHeight: 30, contentWidth: 120, firstText: { fontSize: 20 }, height: 40, imageCount: 1, imageOnly: false, rendererPadding: [8, 8, 8, 8], text: '性能测试弹幕[表情]', width: 312 },
          motion: initialTrackMotion(300), observedAt: Date.now(), startedAt: Date.now(), options: { id: `performance-${index}` }, own: false, sender: 'fixture',
        }
        instance.tracks.set(track.id, track)
      }
      controller.start()
      renderer.commitFrame(renderer.readFrame(instance, canvas.getBoundingClientRect(), { enabled: true, now: Date.now() }))
      let mutations = 0
      const observer = new MutationObserver((records) => { mutations += records.length })
      if (instance.rendererLayer) observer.observe(instance.rendererLayer, { attributes: true, subtree: true })
      const reads: number[] = []
      const commits: number[] = []
      try {
        for (let sample = 0; sample < 60; sample++) {
          await frame()
          for (const track of instance.tracks.values()) if (moving) track.motion = initialTrackMotion(300 + sample)
          const started = performance.now()
          const snapshot = renderer.readFrame(instance, canvas.getBoundingClientRect(), { enabled: true, now: Date.now() })
          const read = performance.now()
          renderer.commitFrame(snapshot)
          reads.push(read - started)
          commits.push(performance.now() - read)
        }
        mutations += observer.takeRecords().length
        results.push({ kind: 'renderer-frame', implementation: name, run: run + 1, trackCount, moving, readP95Ms: percentile(reads, .95), commitP95Ms: percentile(commits, .95), frameP95Ms: percentile(reads.map((read, i) => read + commits[i]!), .95), mutations, nodeCount: instance.rendererNodes.size })
      } finally {
        observer.disconnect()
        registry.destroyAll('performance-complete')
        controller.destroy()
        if (registry.size() || instance.rendererNodes.size || instance.rendererLayer || controller.diagnostics().started || canvas.style.visibility !== 'visible') assertionFailures.push(`${name}: renderer cleanup failed`)
        canvas.remove()
      }
    }
  }
  return { results, assertionFailures }
}
