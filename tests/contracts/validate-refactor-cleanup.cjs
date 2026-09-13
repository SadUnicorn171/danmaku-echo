'use strict'

const fs = require('node:fs')
const path = require('node:path')

const projectRoot = path.resolve(__dirname, '..', '..')
const read = (...segments) => fs.readFileSync(path.join(projectRoot, ...segments), 'utf8')

const entryFiles = [
  'src/entries/content.ts',
  'src/entries/douyin-content.ts',
  'src/entries/douyin-page-hook.ts',
]
for (const entry of entryFiles) {
  if (/@ts-(?:nocheck|ignore|expect-error)/u.test(read(...entry.split('/')))) {
    throw new Error(`Entry still contains a TypeScript suppression: ${entry}`)
  }
}

const eslintConfig = read('eslint.config.ts')
if (
  /src\/entries\/(?:content|douyin-content|douyin-page-hook)\.ts[\s\S]{0,300}ban-ts-comment/u.test(
    eslintConfig,
  )
) {
  throw new Error('ESLint still relaxes TypeScript comment rules for a migrated entry')
}

if (fs.existsSync(path.join(projectRoot, 'src', 'platforms', 'douyin', 'track-model.ts'))) {
  throw new Error('The migrated Douyin track-model compatibility facade must not return')
}

const protocol = read('src', 'platforms', 'douyin', 'protocol.ts')
for (const obsoleteExport of [
  'DOUYIN_LEGACY_PROTOCOL_VERSION',
  'DouyinMessageSource',
  'DouyinProtocolVersion',
  'DouyinEntityId',
]) {
  if (new RegExp(`export (?:const|type|interface) ${obsoleteExport}\\b`, 'u').test(protocol)) {
    throw new Error(`Obsolete protocol implementation detail is public: ${obsoleteExport}`)
  }
}
if (!/remove this[\s\S]{0,100}in 3\.0\.0/u.test(protocol)) {
  throw new Error('The retained versionless protocol migration needs a 3.0.0 removal marker')
}

const pointerGuard = read('src', 'features', 'repeat-reminder', 'pointer-guard.ts')
if (/export const REPEAT_REMINDER_OWNED_SELECTOR/u.test(pointerGuard)) {
  throw new Error('The internal repeat-reminder selector must not be exported')
}

for (const file of [
  ['src', 'platforms', 'bilibili', 'rich-emoji.ts'],
  ['src', 'platforms', 'huya', 'rich-emoji.ts'],
]) {
  if (/function cacheKeyForAsset\(/u.test(read(...file))) {
    throw new Error(`Duplicate Emoji cache helper returned: ${file.join('/')}`)
  }
}
for (const file of [
  ['src', 'platforms', 'live', 'hover-selection-controller.ts'],
  ['src', 'platforms', 'douyin', 'content', 'action-dispatcher.ts'],
]) {
  if (/function eventPath\(/u.test(read(...file))) {
    throw new Error(`Duplicate event path helper returned: ${file.join('/')}`)
  }
}
for (const file of [
  ['src', 'platforms', 'douyin', 'page', 'canvas-hook.ts'],
  ['src', 'platforms', 'douyin', 'page', 'worker-hook.ts'],
]) {
  if (/function patchSlot\(/u.test(read(...file))) {
    throw new Error(`Redundant one-line patch slot helper returned: ${file.join('/')}`)
  }
}

function emptyDirectories(directory) {
  return fs.readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    if (!entry.isDirectory()) return []
    const target = path.join(directory, entry.name)
    const children = fs.readdirSync(target, { withFileTypes: true })
    return children.length === 0 ? [target] : emptyDirectories(target)
  })
}

const emptySourceDirectories = emptyDirectories(path.join(projectRoot, 'src'))
if (emptySourceDirectories.length > 0) {
  throw new Error(
    `Empty source directories remain: ${emptySourceDirectories
      .map((directory) => path.relative(projectRoot, directory))
      .join(', ')}`,
  )
}

console.log('Refactor cleanup validation passed')
