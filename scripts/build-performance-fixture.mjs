import { build } from 'vite'
import { fileURLToPath } from 'node:url'

export async function buildPerformanceFixture() {
  await build({
    configFile: false,
    publicDir: false,
    root: fileURLToPath(new URL('../', import.meta.url)),
    build: {
      outDir: 'test-results/performance', emptyOutDir: false,
      lib: { entry: 'tests/fixtures/performance/browser-benchmark.ts', name: 'DanmakuPerformanceFixture', formats: ['iife'], fileName: () => 'browser-benchmark.js' },
      minify: false,
    },
  })
}
