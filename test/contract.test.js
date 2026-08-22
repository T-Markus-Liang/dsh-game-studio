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

// ── assertSupportedJsonSchema 的忠实小型复刻 ─────────────────────────
// 复刻自 packages/core/tools/src/json-schema.ts（CONSTRAINT_KEYWORDS:76、
// ANNOTATION_KEYWORDS:86、SCHEMA_TYPES:87、checkSchemaNode:227、
// assertSupportedJsonSchema:385）。register() 在
// packages/core/tools/src/index.ts:1045 对 output.schema 调用它。
// 注意：`type: 'json'` 只属于 defineTool ValueSchemaSpec 方言
// （schema.ts:361），不在 raw 子集白名单内 —— 本复刻必须拒绝它。

const CONSTRAINT_KEYWORDS = new Set(['type', 'oneOf', 'properties', 'required', 'additionalProperties', 'items', 'enum', 'const'])
const ANNOTATION_KEYWORDS = new Set(['description', 'title', 'default', 'examples'])
const SCHEMA_TYPES = new Set(['object', 'array', 'string', 'number', 'integer', 'boolean', 'null'])
const ONE_OF_SIBLING_KEYWORDS = ['properties', 'required', 'additionalProperties', 'items', 'enum', 'const']

/** 复刻 json-schema.ts:180 scalarMatches —— enum/const 值须与声明类型一致 */
function scalarMatches(type, value) {
  switch (type) {
    case 'string': return typeof value === 'string'
    case 'number': return typeof value === 'number' && Number.isFinite(value)
    case 'integer': return typeof value === 'number' && Number.isInteger(value)
    case 'boolean': return typeof value === 'boolean'
    case 'null': return value === null
    default: return false
  }
}

/** 递归收集 violations —— 语义对齐 checkSchemaNode（json-schema.ts:227） */
function collectSchemaViolations(node, path, violations) {
  if (node === null || typeof node !== 'object' || Array.isArray(node)) {
    violations.push(`${path} must be a schema object`)
    return
  }
  // 关键字白名单：CONSTRAINT_KEYWORDS ∪ ANNOTATION_KEYWORDS（json-schema.ts:257-268）
  for (const key of Object.keys(node)) {
    if (!CONSTRAINT_KEYWORDS.has(key) && !ANNOTATION_KEYWORDS.has(key)) {
      violations.push(`${path}.${key} is not a supported keyword`)
    }
  }
  if (Object.hasOwn(node, 'description') && typeof node.description !== 'string') {
    violations.push(`${path}.description must be a string`)
  }
  if (Object.hasOwn(node, 'title') && typeof node.title !== 'string') {
    violations.push(`${path}.title must be a string`)
  }

  const hasType = Object.hasOwn(node, 'type')
  const hasOneOf = Object.hasOwn(node, 'oneOf')
  if (hasType && hasOneOf) {
    violations.push(`${path} cannot declare both type and oneOf`)
    return
  }
  if (!hasType && !hasOneOf) {
    // annotation-only：合法的「无约束 JSON」标准形态（json-schema.ts:282-287）
    for (const key of ONE_OF_SIBLING_KEYWORDS) {
      if (Object.hasOwn(node, key)) violations.push(`${path}.${key} requires type or oneOf`)
    }
    return
  }

  if (hasOneOf) {
    for (const key of ONE_OF_SIBLING_KEYWORDS) {
      if (Object.hasOwn(node, key)) violations.push(`${path}.${key} is not supported beside oneOf`)
    }
    if (!Array.isArray(node.oneOf) || node.oneOf.length < 2) {
      violations.push(`${path}.oneOf must be an array of at least two schemas`)
    } else {
      node.oneOf.forEach((branch, index) => collectSchemaViolations(branch, `${path}.oneOf[${index}]`, violations))
    }
    return
  }

  // type 白名单（json-schema.ts:87 SCHEMA_TYPES、303-306 violation）——
  // 'json' 不在其中，必须拒绝
  const type = node.type
  if (typeof type !== 'string' || !SCHEMA_TYPES.has(type)) {
    violations.push(`${path}.type must be one of object/array/string/number/integer/boolean/null`)
    return
  }
  // 关键字与 type 的适用性（json-schema.ts:310-322 allowedFor）
  const allowedFor = {
    properties: ['object'],
    required: ['object'],
    additionalProperties: ['object'],
    items: ['array'],
    enum: ['string', 'number', 'integer', 'boolean', 'null'],
    const: ['string', 'number', 'integer', 'boolean', 'null'],
  }
  for (const [key, types] of Object.entries(allowedFor)) {
    if (Object.hasOwn(node, key) && !types.includes(type)) {
      violations.push(`${path}.${key} is not supported on type "${type}"`)
    }
  }

  if (type === 'object') {
    const properties = Object.hasOwn(node, 'properties') ? node.properties : undefined
    if (Object.hasOwn(node, 'properties')) {
      if (properties === null || typeof properties !== 'object' || Array.isArray(properties)) {
        violations.push(`${path}.properties must be an object of schemas`)
      } else {
        for (const [key, child] of Object.entries(properties)) {
          collectSchemaViolations(child, `${path}.properties.${key}`, violations)
        }
      }
    }
    if (Object.hasOwn(node, 'required')) {
      if (!Array.isArray(node.required) || node.required.some(entry => typeof entry !== 'string')) {
        violations.push(`${path}.required must be an array of strings`)
      } else {
        const declared = properties && typeof properties === 'object' && !Array.isArray(properties) ? properties : {}
        for (const key of node.required) {
          if (!Object.hasOwn(declared, key)) violations.push(`${path}.required names "${key}" which is not in properties`)
        }
      }
    }
    if (Object.hasOwn(node, 'additionalProperties') && typeof node.additionalProperties !== 'boolean') {
      violations.push(`${path}.additionalProperties must be a boolean`)
    }
  } else if (type === 'array') {
    if (Object.hasOwn(node, 'items')) collectSchemaViolations(node.items, `${path}.items`, violations)
  } else {
    // 标量类型：enum/const 值须匹配声明类型（json-schema.ts:352-369）
    if (Object.hasOwn(node, 'enum')) {
      const allowed = node.enum
      if (!Array.isArray(allowed) || allowed.length === 0 || !allowed.every(entry => scalarMatches(type, entry))) {
        violations.push(`${path}.enum must be a non-empty array of ${type} values`)
      }
    }
    if (Object.hasOwn(node, 'const') && !scalarMatches(type, node.const)) {
      violations.push(`${path}.const must be a ${type} value`)
    }
  }
}

/** 复刻 assertSupportedJsonSchema（json-schema.ts:385）：违规即抛 */
function assertSupportedJsonSchemaReplica(schema, label) {
  const violations = []
  collectSchemaViolations(schema, 'schema', violations)
  assert.deepEqual(violations, [], `${label}: unsupported JSON schema: ${violations.join('; ')}`)
}

/** 复刻 tools.register 的校验逻辑（packages/core/tools/src/index.ts:1037-1056） */
function assertRegisterable(tool) {
  assert.ok(tool, 'tool 存在')
  assert.equal(typeof tool.name, 'string', `${tool?.name}: name 必须为字符串`)
  assert.ok(tool.name.length > 0, 'name 非空')
  // output 校验（源码 1040-1044）
  const output = tool.output
  assert.ok(output !== undefined && typeof output === 'object', `${tool.name}: 必须声明 output`)
  assert.equal(typeof output.render, 'function', `${tool.name}: output.render 必须为函数`)
  if (output.presentationMeta !== undefined) {
    assert.equal(typeof output.presentationMeta, 'function', `${tool.name}: presentationMeta 必须为函数`)
  }
  // output.schema 必须落在 raw JSON Schema 受支持子集内（源码 index.ts:1045 →
  // assertSupportedJsonSchema）—— annotation-only（省略 type）或
  // type ∈ object/array/string/number/integer/boolean/null
  assertSupportedJsonSchemaReplica(output.schema, `${tool.name}: output.schema`)
  // parameters 同样跑复刻校验（子集对 properties/items 递归检查）
  const p = tool.parameters
  assert.ok(p && typeof p === 'object', `${tool.name}: parameters 必须为对象`)
  assertSupportedJsonSchemaReplica(p, `${tool.name}: parameters`)
  if (p.type === 'object') {
    assert.ok(p.properties && typeof p.properties === 'object', `${tool.name}: object 参数需有 properties`)
    assert.ok(Array.isArray(p.required), `${tool.name}: object 参数需有 required 数组`)
  }
  // execute 必须为函数
  assert.equal(typeof tool.execute, 'function', `${tool.name}: execute 必须为函数`)
}

/** 真实 apply 的 ctx 模拟——捕获注册的 6 个工具 */
function makeCtx() {
  const registered = { commands: [], tools: [], sections: [], events: new Set(), skills: 0, handlers: [], settings: [] }
  const sub = {
    commands: { register: (c) => { registered.commands.push(c.name) } },
    tools: { register: (t) => { registered.tools.push(t) } },
    skills: { registerProvider: (f) => { registered.skills++; return () => {} } },
    systemPrompt: { section: (s) => { registered.sections.push(s.name); return () => {} } },
    settings: { register: (namespace, schema, options) => { registered.settings.push(namespace); return { get: () => ({}), watch: () => () => {} } } },
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

test('负向回归: { type: "json" } 必须被 raw 子集校验拒绝（0001 防回潮）', () => {
  // `type: 'json'` 只属于 defineTool ValueSchemaSpec 方言，raw
  // assertSupportedJsonSchema 的 SCHEMA_TYPES 白名单（json-schema.ts:87）
  // 不含它 —— 若本用例失败，说明复刻校验退化为假阳性。
  const violations = []
  collectSchemaViolations({ type: 'json' }, 'schema', violations)
  assert.ok(violations.length > 0, "{ type: 'json' } 应被拒绝")
  assert.ok(
    violations.some(v => v.includes('schema.type must be one of')),
    `应报 type 白名单 violation，实际: ${violations.join('; ')}`,
  )
  // 嵌套位置同样拒绝（properties/items 子 schema 递归检查）
  const nested = []
  collectSchemaViolations({ type: 'object', properties: { data: { type: 'json' } } }, 'schema', nested)
  assert.ok(
    nested.some(v => v.startsWith('schema.properties.data.type must be one of')),
    `嵌套 'json' 应被拒绝，实际: ${nested.join('; ')}`,
  )
  // 对照：annotation-only（方案 A 修复形态）必须通过
  const clean = []
  collectSchemaViolations({ description: 'lossless JSON result' }, 'schema', clean)
  assert.deepEqual(clean, [], 'annotation-only schema 应通过')
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