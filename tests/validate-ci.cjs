const fs = require('node:fs')
const path = require('node:path')

const projectRoot = path.resolve(__dirname, '..')
const workflowPath = path.join(projectRoot, '.github', 'workflows', 'ci.yml')

if (!fs.existsSync(workflowPath)) {
  throw new Error('Missing .github/workflows/ci.yml')
}

const workflow = fs.readFileSync(workflowPath, 'utf8')
const requirements = [
  ['read-only repository permission', /permissions:\s*\n\s+contents:\s*read/],
  ['push limited to main and dev', /push:\s*\n\s+branches:\s*\n\s+- main\s*\n\s+- dev/],
  ['Windows runner', /runs-on:\s*windows-latest/],
  ['Fedora 44 container', /image:\s*fedora:44/],
  ['checkout action pinned to v6 SHA', /uses:\s*actions\/checkout@d23441a48e516b6c34aea4fa41551a30e30af803\s*#\s*v6/g],
  ['setup-node action pinned to v6 SHA', /uses:\s*actions\/setup-node@249970729cb0ef3589644e2896645e5dc5ba9c38\s*#\s*v6/g],
  ['upload-artifact action pinned to v7 SHA', /uses:\s*actions\/upload-artifact@043fb46d1a93c77aae656e7c1c64a875d1fc6a0a\s*#\s*v7/g],
  ['pinned Node.js version', /node-version:\s*22\.22\.2/g],
  ['clean dependency installation', /run:\s*npm ci/g],
  ['full project check', /run:\s*npm run check/g],
  ['cross-platform package entry', /run:\s*node scripts\/package\.cjs/g],
]

for (const [description, pattern] of requirements) {
  const matches = workflow.match(pattern) ?? []
  const expectedCount = pattern.global ? 2 : 1
  if (matches.length < expectedCount) {
    throw new Error(`CI workflow is missing ${description}`)
  }
}

if (/npm run test:browser|browser-e2e/.test(workflow)) {
  throw new Error('Browser E2E must remain a local optional test and must not run in CI')
}

console.log('CI workflow validation passed')
