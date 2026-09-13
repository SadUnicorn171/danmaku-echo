const assert = require('node:assert/strict')

async function lintText(eslint, code, filePath) {
  const [result] = await eslint.lintText(code, { filePath })
  return result.messages.filter((message) => message.ruleId === 'no-restricted-imports')
}

async function main() {
  const { ESLint } = await import('eslint')
  const eslint = new ESLint({ cwd: process.cwd() })

  const liveViolations = await lintText(
    eslint,
    "import '../douyu/adapter'\n",
    'src/platforms/live/illegal-boundary-fixture.ts',
  )
  assert.equal(liveViolations.length, 1, 'live -> concrete platform import must fail')

  const aliasedLiveViolations = await lintText(
    eslint,
    "import '@/platforms/huya/adapter'\n",
    'src/platforms/live/illegal-alias-boundary-fixture.ts',
  )
  assert.equal(aliasedLiveViolations.length, 1, 'aliased live -> concrete platform import must fail')

  const featureViolations = await lintText(
    eslint,
    "import '../../platforms/bilibili/emoticon-metadata'\n",
    'src/features/favorites/illegal-boundary-fixture.ts',
  )
  assert.equal(featureViolations.length, 1, 'feature -> concrete platform import must fail')

  const entryViolations = await lintText(
    eslint,
    "import '../entries/content'\n",
    'src/core/illegal-boundary-fixture.ts',
  )
  assert.equal(entryViolations.length, 1, 'runtime module -> entry import must fail')

  const allowedAdapterImport = await lintText(
    eslint,
    "import '../bilibili/adapter'\n",
    'src/platforms/live/adapters.ts',
  )
  assert.equal(allowedAdapterImport.length, 0, 'the explicit live adapter composition seam must pass')

  console.log('Import boundary validation passed')
}

main().catch((error) => {
  console.error(error)
  process.exitCode = 1
})
