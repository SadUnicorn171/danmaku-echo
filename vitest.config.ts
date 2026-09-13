import { fileURLToPath, URL } from 'node:url'

import vue from '@vitejs/plugin-vue'
import { configDefaults, defineConfig } from 'vitest/config'

export default defineConfig({
  plugins: [vue({ template: { transformAssetUrls: false } })],
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url)),
    },
  },
  test: {
    environment: 'jsdom',
    exclude: [...configDefaults.exclude, '.tmp/**', 'tests/**'],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'json-summary'],
      reportsDirectory: 'test-results/coverage',
      include: [
        'src/core/**/*.ts',
        'src/features/**/*.ts',
        'src/platforms/**/*.ts',
      ],
      exclude: [
        '**/__tests__/**',
        'src/core/types.ts',
        'src/features/**/types.ts',
        'src/features/favorites/index.ts',
        'src/features/favorites/launcher.ts',
        'src/platforms/douyin/content/content-app.ts',
        'src/platforms/douyin/page/page-app.ts',
        'src/platforms/douyin/page/runtime-types.ts',
      ],
      thresholds: {
        lines: 72,
        functions: 70,
        branches: 58,
        'src/core/**': {
          lines: 75,
          functions: 82,
          branches: 55,
        },
        'src/features/**': {
          lines: 60,
          functions: 50,
          branches: 45,
        },
        'src/platforms/**': {
          lines: 78,
          functions: 78,
          branches: 60,
        },
      },
    },
  },
})
