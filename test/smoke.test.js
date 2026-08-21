import { test } from 'node:test'
import assert from 'node:assert/strict'
import { pathToFileURL } from 'node:url'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const here = dirname(fileURLToPath(import.meta.url))
const entryUrl = pathToFileURL(join(here, '..', 'lib', 'index.js')).href

test('插件入口导出 name 与 apply', async () => {
  const mod = await import(entryUrl)
  assert.equal(mod.name, 'dsh-game-studio')
  assert.equal(typeof mod.apply, 'function')
})

test('插件入口可在最小 ctx 上 apply 且不抛错', async () => {
  const mod = await import(entryUrl)
  const ctx = {
    provide: (key, value) => {
      assert.equal(key, 'gameStudio')
      assert.equal(typeof value.status, 'function')
    },
    effect: () => () => {},
    logger: { info: () => {} },
  }
  mod.apply(ctx, { reviewMode: 'studio' })
})
