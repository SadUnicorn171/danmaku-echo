import { globalIgnores } from 'eslint/config'
import { defineConfigWithVueTs, vueTsConfigs } from '@vue/eslint-config-typescript'
import pluginVue from 'eslint-plugin-vue'
import pluginVitest from '@vitest/eslint-plugin'
import pluginOxlint from 'eslint-plugin-oxlint'
import skipFormatting from 'eslint-config-prettier/flat'

export default defineConfigWithVueTs(
  {
    name: 'app/files-to-lint',
    files: ['**/*.{vue,ts,mts,tsx}'],
  },

  globalIgnores([
    '**/build/**',
    '**/dist/**',
    '**/coverage/**',
    '**/.tmp/**',
  ]),

  ...pluginVue.configs['flat/essential'],
  vueTsConfigs.recommended,

  {
    files: ['**/*.cjs'],
    rules: {
      '@typescript-eslint/no-require-imports': 'off',
    },
  },

  {
    name: 'architecture/live-platform-boundary',
    files: ['src/platforms/live/**/*.{ts,mts,tsx,vue}'],
    ignores: ['src/platforms/live/adapters.ts'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            {
              message:
                '共享 live 模块不得直接导入具体平台实现；请通过平台 adapter 或入口装配层注入。',
              regex:
                '^(?:@/platforms/|(?:\\.\\./)+(?:platforms/)?)(?:bilibili|douyin|douyu|huya)(?:/|$)',
            },
            {
              message: '运行模块不得反向导入 entry；entry 只能作为最外层 composition root。',
              regex: '^(?:@/entries/|(?:\\.\\./)+entries/)',
            },
          ],
        },
      ],
    },
  },

  {
    name: 'architecture/feature-platform-boundary',
    files: ['src/features/**/*.{ts,mts,tsx,vue}'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            {
              message:
                'feature 不得深层导入具体平台实现；请依赖 core/shared contract 或由装配层注入。',
              regex:
                '^(?:@/platforms/|(?:\\.\\./)+platforms/)(?:bilibili|douyin|douyu|huya)(?:/|$)',
            },
            {
              message: '运行模块不得反向导入 entry；entry 只能作为最外层 composition root。',
              regex: '^(?:@/entries/|(?:\\.\\./)+entries/)',
            },
          ],
        },
      ],
    },
  },

  {
    name: 'architecture/no-entry-back-imports',
    files: ['src/**/*.{ts,mts,tsx,vue}'],
    ignores: ['src/entries/**/*', 'src/features/**/*', 'src/platforms/live/**/*'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            {
              message: '运行模块不得反向导入 entry；entry 只能作为最外层 composition root。',
              regex: '^(?:@/entries/|(?:\\.\\./)+entries/)',
            },
          ],
        },
      ],
    },
  },

  {
    ...pluginVitest.configs.recommended,
    files: ['src/**/__tests__/*'],
  },

  ...pluginOxlint.buildFromOxlintConfigFile('.oxlintrc.json'),

  skipFormatting,
)
