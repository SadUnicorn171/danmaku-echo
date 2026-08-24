'use strict'

const fs = require('node:fs')
const path = require('node:path')

const root = path.resolve(__dirname, '..')
const read = (...segments) => fs.readFileSync(path.join(root, ...segments), 'utf8')
const packageJson = JSON.parse(read('package.json'))
const manifest = JSON.parse(read('public', 'manifest.json'))
const changelog = read('CHANGELOG.md')
const release = read('.github', 'workflows', 'release.yml')
const pages = read('.github', 'workflows', 'pages.yml')
const dependabot = read('.github', 'dependabot.yml')

if (packageJson.version !== manifest.version) {
  throw new Error('package.json and manifest versions differ')
}
const escapedVersion = packageJson.version.replaceAll('.', '\\.')
if (!new RegExp(`^## \\[${escapedVersion}\\]`, 'm').test(changelog)) {
  throw new Error(`CHANGELOG.md is missing ${packageJson.version}`)
}
for (const [description, pattern] of [
  ['v* tag trigger', /tags:\s*\n\s+- ['"]v\*['"]/],
  ['Windows release runner', /runs-on:\s*windows-latest/],
  ['main ancestry validation', /scripts\/validate-release\.cjs/],
  ['full check', /npm run check/],
  ['checksum', /scripts\/write-checksum\.cjs/],
  ['GitHub Release creation', /gh release create/],
]) {
  if (!pattern.test(release)) throw new Error(`Release workflow is missing ${description}`)
}
if (/npm run test:browser|browser-e2e/.test(release)) {
  throw new Error('Browser E2E must remain a local optional test and must not run in release CI')
}
for (const [description, pattern] of [
  ['main branch', /branches:\s*\n\s+- main/],
  ['privacy directory', /path:\s*docs\/privacy/],
  ['Pages deployment', /actions\/deploy-pages@[a-f0-9]{40}\s*#\s*v4/],
]) {
  if (!pattern.test(pages)) throw new Error(`Pages workflow is missing ${description}`)
}
for (const ecosystem of ['npm', 'github-actions']) {
  if (!new RegExp(`package-ecosystem:\\s*${ecosystem}[\\s\\S]*?interval:\\s*monthly`).test(dependabot)) {
    throw new Error(`Dependabot is missing monthly ${ecosystem} updates`)
  }
}
for (const requiredPath of [
  ['docs', 'privacy', 'index.html'],
  ['docs', 'store', 'edge-zh-CN.md'],
  ['docs', 'store', 'listing-en.md'],
  ['docs', 'RELEASE_CHECKLIST.md'],
]) {
  if (!fs.existsSync(path.join(root, ...requiredPath))) {
    throw new Error(`Missing ${requiredPath.join('/')}`)
  }
}

const mutableActionReference = /uses:\s*[\w-]+\/[\w-]+@(?![a-f0-9]{40}\s+#)/
for (const [name, workflow] of [['release', release], ['pages', pages]]) {
  if (mutableActionReference.test(workflow)) throw new Error(`${name} workflow uses a mutable action ref`)
}

console.log('Release, privacy, Pages, and Dependabot configuration validation passed')
