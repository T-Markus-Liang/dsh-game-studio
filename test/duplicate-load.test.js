/**
 * 兼容性问题 0002 回归测试 —— 双加载单实例守卫。
 *
 * 场景：同一插件同时经 `dsh.profile.bundles` 与手动 `cordis.patch.yml` insert
 * 安装时，两个 loader entry 各自 apply。守卫要求：第二实例整体 no-op 并告警；
 * 第一实例卸载（effect cleanup）后可再次正常加载（HMR 不误伤）；
 * 被拒实例的任何残留 cleanup 不得清掉第一实例的进程级标记（token 保护）。
 */
import { test, beforeEach, afterEach } from 'node:test'
import assert from 'node:assert/strict'
import { pathToFileURL, fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const here = dirname(fileURLToPath(import.meta.url))
const entryUrl = pathToFileURL(join(here, '..', 'lib', 'index.js')).href

const ACTIVE_KEY = Symbol.for('dsh-game-studio.active')

// 用例4：进程级标记在测试间清理，避免污染同进程内的其他测试
beforeEach(() => { delete globalThis[ACTIVE_KEY] })
afterEach(() => { delete globalThis[ACTIVE_KEY] })

/**
 * mock ctx —— 参考 test/contract.test.js 的 makeCtx()，
 * 额外提供可工作的 effect（捕获 cleanup 供测试手动触发）与 warn 捕获。
 */
function makeCtx() {
  const registered = { commands: [], tools: [], sections: [], skills: 0, warnings: [], cleanups: [] }
  const sub = {
    commands: { register: (c) => { registered.commands.push(c.name) } },
    tools: { register: (t) => { registered.tools.push(t.name) } },
    skills: { registerProvider: () => { registered.skills++; return () => {} } },
    systemPrompt: { section: (s) => { registered.sections.push(s.name); return () => {} } },
    settings: { register: () => ({ get: () => ({}), watch: () => () => {} }) },
  }
  const ctx = {
    logger: { info: () => {}, warn: (message) => { registered.warnings.push(String(message)) } },
    provide: () => {},
    effect: (execute) => {
      const cleanup = execute()
      if (typeof cleanup === 'function') registered.cleanups.push(cleanup)
      return () => cleanup?.()
    },
    inject: (services, fn) => {
      const proxy = new Proxy({}, { get: (_, k) => sub[k] ?? ctx[k] })
      fn(proxy)
    },
    on: () => {},
  }
  return { ctx, registered }
}

test('用例1: 双加载时第二实例零注册并发出 0002 告警', async () => {
  const mod = await import(entryUrl)

  const first = makeCtx()
  mod.apply(first.ctx, {})
  assert.equal(first.registered.tools.length, 6, '第一实例应注册 6 个工具')
  assert.ok(first.registered.commands.includes('game'), '第一实例应注册 /game 命令')
  assert.equal(first.registered.warnings.filter(w => w.includes('0002')).length, 0, '第一实例不应告警')

  const second = makeCtx()
  mod.apply(second.ctx, {})
  assert.equal(second.registered.tools.length, 0, '第二实例不得注册任何工具')
  assert.equal(second.registered.commands.length, 0, '第二实例不得注册任何命令')
  assert.equal(second.registered.skills, 0, '第二实例不得注册 skill provider')
  assert.equal(second.registered.sections.length, 0, '第二实例不得注册 prompt section')
  assert.ok(
    second.registered.warnings.some(w => w.includes('0002') || w.includes('双加载')),
    `第二实例应发出含 0002/双加载 的告警，实际: ${second.registered.warnings.join('; ')}`,
  )
})

test('用例2: 第一实例卸载后再 apply 新 ctx 可正常注册（HMR 场景）', async () => {
  const mod = await import(entryUrl)

  const first = makeCtx()
  mod.apply(first.ctx, {})
  assert.equal(first.registered.tools.length, 6)
  assert.ok(first.registered.cleanups.length >= 1, '守卫 effect cleanup 应已捕获')

  // 模拟卸载：执行第一实例的全部 effect cleanup
  for (const cleanup of first.registered.cleanups) cleanup()
  assert.equal(globalThis[ACTIVE_KEY], undefined, '卸载后进程级标记应释放')

  const next = makeCtx()
  mod.apply(next.ctx, {})
  assert.equal(next.registered.tools.length, 6, '重载实例应正常注册 6 个工具')
  assert.equal(next.registered.warnings.filter(w => w.includes('0002')).length, 0, '重载实例不应被误拒')
})

test('用例3: token 保护——被拒实例的残留 cleanup 不得清掉第一实例的标记', async () => {
  const mod = await import(entryUrl)

  const first = makeCtx()
  mod.apply(first.ctx, {})
  const markerAfterFirst = globalThis[ACTIVE_KEY]
  assert.ok(markerAfterFirst?.token, '第一实例应写入带 token 的标记')

  const second = makeCtx()
  mod.apply(second.ctx, {})
  assert.equal(second.registered.tools.length, 0, '第二实例应被拒')

  // 构造调用顺序：先跑第二实例身上残留的任何 cleanup（正确实现下应为空，
  // 但即便存在也不得清掉第一实例的标记），再核对标记仍属于第一实例。
  for (const cleanup of second.registered.cleanups) cleanup()
  assert.equal(globalThis[ACTIVE_KEY], markerAfterFirst, '第一实例的标记不得被第二实例清除')
  assert.equal(globalThis[ACTIVE_KEY].token, markerAfterFirst.token, 'token 必须保持第一实例的值')

  // 第一实例卸载仍能正常释放
  for (const cleanup of first.registered.cleanups) cleanup()
  assert.equal(globalThis[ACTIVE_KEY], undefined, '第一实例卸载后标记应释放')
})

test('用例4: 守卫标记不污染——beforeEach/afterEach 清理下连续用例互不干扰', async () => {
  const mod = await import(entryUrl)
  // beforeEach 已清理标记，此处 apply 应为"第一实例"路径
  const { ctx, registered } = makeCtx()
  mod.apply(ctx, {})
  assert.equal(registered.tools.length, 6, '清理标记后 apply 应走正常注册路径')
  assert.ok(globalThis[ACTIVE_KEY]?.token, '标记应重新写入')
})
