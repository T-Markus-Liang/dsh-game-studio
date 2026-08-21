import { test } from 'node:test'
import assert from 'node:assert/strict'
import { pathToFileURL } from 'node:url'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

/**
 * 契约级集成测试：不 mock 掉真实校验，而是用与 tools.register 相同的
 * 规则（packages/core/tools/src/index.ts:1037）逐项验证我们注册的
 * 工具定义确实能通过——避免「测试自我印证假阳性」。
 */

const here = dirname(fileURLToPath(import.meta.url))
const entryUrl = pathToFileURL(join(here, '..', 'lib', 'index.js')).href

/** 模拟 tools.register 的校验逻辑（与源码 register() 一致） */
function assertRegisterable(tool) {
  assert.ok(tool, 'tool 存在')
  assert.equal(typeof tool.name, 'string', `${tool?.name}: name 必须为字符串`)
  assert.ok(tool.name.length > 0, 'name 非空')
  // output 校验（源码 1040-1046）
  const output = tool.output
  assert.ok(output !== undefined && typeof output === 'object', `${tool.name}: 必须声明 output`)
  assert.equal(typeof output.render, 'function', `${tool.name}: output.render 必须为函数`)
  if (output.presentationMeta !== undefined) {
    assert.equal(typeof output.presentationMeta, 'function', `${tool.name}: presentationMeta 必须为函数`)
  }
  // output.schema 必须是受支持的 JSON Schema（源码 assertSupportedJsonSchema）
  assert.ok(output.schema && typeof output.schema === 'object', `${tool.name}: output.schema 必须为对象`)
  assert.ok(output.schema.type === 'json' || output.schema.type === 'object' || output.schema.type === 'string', `${tool.name}: output.schema.type 合法`)
  // parameters 必须是标准 JSON Schema 对象（ToolSchema.parameters: Record<string,unknown>）
  const p = tool.parameters
  assert.ok(p && typeof p === 'object', `${tool.name}: parameters 必须为对象`)
  if (p.type === 'object') {
    assert.ok(p.properties && typeof p.properties === 'object', `${tool.name}: object 参数需有 properties`)
    assert.ok(Array.isArray(p.required), `${tool.name}: object 参数需有 required 数组`)
  }
  // execute 必须为函数
  assert.equal(typeof tool.execute, 'function', `${tool.name}: execute 必须为函数`)
}

/** 真实 apply 的 ctx 模拟——捕获注册的 6 个工具 */
function makeCtx() {
  const registered = { commands: [], tools: [], sections: [], events: new Set(), skills: 0 }
  const sub = {
    commands: { register: (c) => { registered.commands.push(c.name) } },
    tools: { register: (t) => { registered.tools.push(t) } },
    skills: { registerProvider: (f) => { registered.skills++; return () => {} } },
    systemPrompt: { section: (s) => { registered.sections.push(s.name); return () => {} } },
  }
  const ctx = {
    logger: { info: () => {} },
    provide: () => {},
    inject: (services, fn) => {
      const proxy = new Proxy({}, { get: (_, k) => sub[k] ?? ctx[k] })
      fn(proxy)
    },
    on: (event, fn) => { registered.events.add(event) },
  }
  return { ctx, registered }
}

test('契约: 6 个工具全部可通过 register 校验', async () => {
  const mod = await import(entryUrl)
  const { ctx, registered } = makeCtx()
  mod.apply(ctx, {})
  assert.equal(registered.tools.length, 6, '应注册 6 个工具')
  for (const tool of registered.tools) {
    assertRegisterable(tool)
  }
})

test('契约: /game 命令已注册', async () => {
  const mod = await import(entryUrl)
  const { ctx, registered } = makeCtx()
  mod.apply(ctx, {})
  assert.ok(registered.commands.includes('game'), '应注册 /game 命令')
})

test('契约: skill provider 已注册', async () => {
  const mod = await import(entryUrl)
  const { ctx, registered } = makeCtx()
  mod.apply(ctx, {})
  assert.equal(registered.skills, 1, '应注册 1 个 skill provider')
})

test('契约: prompt section 已注册', async () => {
  const mod = await import(entryUrl)
  const { ctx, registered } = makeCtx()
  mod.apply(ctx, {})
  assert.ok(registered.sections.includes('game-studio:guide'), '应注册 game-studio:guide section')
})

test('契约: hooks 事件监听已挂载', async () => {
  const mod = await import(entryUrl)
  const { ctx, registered } = makeCtx()
  mod.apply(ctx, {})
  assert.ok(registered.events.has('tools/pre-execute'), 'pre-execute 监听')
  assert.ok(registered.events.has('tools/post-execute'), 'post-execute 监听')
})

test('契约: 工具名符合 dsh-tools 保留名限制（非 run_code）', async () => {
  const mod = await import(entryUrl)
  const { ctx, registered } = makeCtx()
  mod.apply(ctx, {})
  for (const tool of registered.tools) {
    assert.notEqual(tool.name, 'run_code', `${tool.name} 不得为保留名 run_code`)
  }
})

test('契约: skill provider 契约形状正确（name/list/get）', async () => {
  const { registerSkillProvider } = await import('../src/registry/skills.js')
  let captured = null
  const fakeCtx = {
    skills: {
      registerProvider: (factory) => {
        captured = factory({ signal: new AbortController().signal, invalidate: () => {} })
        return () => {}
      },
    },
  }
  registerSkillProvider(fakeCtx)
  assert.ok(captured, 'provider 已创建')
  assert.equal(captured.name, 'game-studio')
  assert.equal(typeof captured.list, 'function', 'list 必须为函数')
  assert.equal(typeof captured.get, 'function', 'get 必须为函数')
  // list 返回 Promise 且候选含必需字段
  const candidates = await captured.list({})
  assert.equal(candidates.length, 73, '应列出 73 个 skill')
  const first = candidates[0]
  for (const key of ['name', 'description', 'invocation', 'source', 'provider', 'rank', 'locator']) {
    assert.ok(key in first, `candidate 缺字段 ${key}`)
  }
  assert.equal(first.invocation.modelInvocable, true)
  assert.equal(first.invocation.userInvocable, false)
  // get 返回 definition 含 content
  const def = await captured.get(first, {})
  assert.equal(typeof def.content, 'string', 'definition 需含 content 正文')
})