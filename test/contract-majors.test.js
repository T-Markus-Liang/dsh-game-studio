/**
 * 契约审查回归测试（MAJOR-1/2 + MINOR logs 路径 + shq 转义）。
 * 契约依据（packages/ 真实源码）：
 *   - AssembleContext = { scope?, signal? }（system-prompt/src/index.ts:42-50）
 *     + agent 合并扩展（agent/src/runtime-types.ts:16-21）；
 *     cwd 权威来源 agent.session.header.cwd（session/src/types.ts:73）。
 *   - inject(message: UserMessage) 要求 id/role/content/source
 *     （llm/src/message.ts:129-144）；inbox 以 id 去重（agent/src/inbox.ts:213-217）。
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { execSync } from 'node:child_process'
import { apply, isInsideDir } from '../lib/index.js'
import { registerHooks } from '../src/hooks/index.js'
import { writeProject, writeActiveTask, logsDir } from '../src/state/index.js'
import { shq } from '../src/engines/godot.js'

/** 构造最小 mock ctx，捕获 systemPrompt section 与注册的 tools。 */
function applyPlugin() {
  const captured = { section: null, tools: new Map() }
  const ctx = {
    inject(deps, cb) {
      if (deps[0] === 'systemPrompt') {
        cb({ systemPrompt: { section: def => { captured.section = def } } })
      } else if (deps[0] === 'tools') {
        cb({ tools: { register: def => captured.tools.set(def.name, def) } })
      }
      // commands/skills/settings 走真实服务，本测试不需要
    },
    on() { /* hooks 单独用 registerHooks 测 */ },
    provide() {},
    logger: { info() {}, warn() {} },
  }
  apply(ctx, {})
  return captured
}

// ── MAJOR-1：section assemble 从 agent.session.header.cwd 取工作区 ──

test('section assemble uses assembleCtx.agent.session.header.cwd, not process.cwd()', () => {
  const { section } = applyPlugin()
  assert.ok(section, 'systemPrompt section registered')
  assert.equal(section.name, 'game-studio:guide')
  assert.equal(typeof section.text, 'function')

  // 在 header.cwd 指向的目录造引擎状态；宿主 process.cwd() 无任何状态。
  const cwd = mkdtempSync(join(tmpdir(), 'game-studio-section-'))
  try {
    writeProject(cwd, { engine: 'godot', version: '4.2', projectRoot: cwd, projectFile: null, evidence: [] })
    const text = section.text({ agent: { session: { header: { cwd } } } })
    assert.match(text, /godot/, 'section text reflects the header.cwd project state')
    assert.match(text, /game_studio_status/)
  } finally {
    rmSync(cwd, { recursive: true, force: true })
  }
})

test('section assemble returns empty when neither header.cwd nor host cwd has engine state', () => {
  const { section } = applyPlugin()
  const empty = mkdtempSync(join(tmpdir(), 'game-studio-empty-'))
  try {
    const text = section.text({ agent: { session: { header: { cwd: empty } } } })
    assert.equal(text, '')
  } finally {
    rmSync(empty, { recursive: true, force: true })
  }
})

// ── MAJOR-2：hooks inject 消息形状为完整 UserMessage ──

test('hooks inject a well-formed UserMessage (id/role/content/source, steerAgent shape)', () => {
  const handlers = []
  registerHooks({ on: (_event, handler) => handlers.push(handler) })
  const post = handlers[2]
  const cwd = mkdtempSync(join(tmpdir(), 'game-studio-inject-'))
  try {
    writeActiveTask(cwd, { id: 'task', gates: {} })
    const injected = []
    const agent = { session: { header: { cwd } }, inject: message => injected.push(message) }
    post({ name: 'write', arguments: { file_path: 'src/gameplay/player.gd' }, agent }, {}, () => ({ kind: 'allow' }))
    assert.equal(injected.length, 1)
    const message = injected[0]
    assert.equal(typeof message.id, 'string')
    assert.ok(message.id.length > 0, 'id is a non-empty string')
    assert.equal(message.role, 'user')
    assert.ok(Array.isArray(message.content))
    assert.equal(message.content[0].type, 'text')
    assert.match(message.content[0].text, /matches rules/)
    assert.deepEqual(message.source, { kind: 'plugin', plugin: 'dsh-game-studio' })
  } finally {
    rmSync(cwd, { recursive: true, force: true })
  }
})

test('hooks inject ids are unique across two injections (inbox dedup safety)', () => {
  const handlers = []
  registerHooks({ on: (_event, handler) => handlers.push(handler) })
  const post = handlers[2]
  const cwd = mkdtempSync(join(tmpdir(), 'game-studio-inject2-'))
  try {
    const injected = []
    const agent = { session: { header: { cwd } }, inject: message => injected.push(message) }
    post({ name: 'write', arguments: { file_path: 'src/gameplay/a.gd' }, agent }, {}, () => ({ kind: 'allow' }))
    post({ name: 'write', arguments: { file_path: 'shaders/x.gdshader' }, agent }, {}, () => ({ kind: 'allow' }))
    assert.ok(injected.length >= 1)
    const ids = injected.map(message => message.id)
    assert.equal(new Set(ids).size, ids.length, 'no duplicate message ids')
  } finally {
    rmSync(cwd, { recursive: true, force: true })
  }
})

// ── MINOR：logs 路径前缀绕过 ──

test('isInsideDir rejects sibling-prefix bypass and absolute escapes', () => {
  const dir = '/x/.dsh/game-studio/logs'
  assert.equal(isInsideDir(dir, '/x/.dsh/game-studio/logs-evil/f'), false)
  assert.equal(isInsideDir(dir, '/x/.dsh/game-studio/logs/../secrets'), false)
  assert.equal(isInsideDir(dir, dir), false, 'the dir itself is not a log file')
  assert.equal(isInsideDir(dir, '/x/.dsh/game-studio/logs/a.log'), true)
  assert.equal(isInsideDir(dir, '/x/.dsh/game-studio/logs/sub/a.log'), true)
})

test('game_studio_engine logs action rejects prefix-bypass paths and accepts real children', async () => {
  const { tools } = applyPlugin()
  const engine = tools.get('game_studio_engine')
  assert.ok(engine, 'engine tool registered')
  const cwd = mkdtempSync(join(tmpdir(), 'game-studio-logs-'))
  try {
    const exec = { agent: { session: { header: { cwd } } } }
    const dir = logsDir(cwd)
    const evil = `${dir}-evil/f`
    const denied = await engine.execute({ action: 'logs', logPath: evil }, exec)
    assert.equal(denied.ok, false)
    assert.match(denied.error, /must be inside/)
    const { writeFileSync } = await import('node:fs')
    const good = join(dir, 'a.log')
    writeFileSync(good, 'line1\nline2\n', 'utf-8')
    const allowed = await engine.execute({ action: 'logs', logPath: good }, exec)
    assert.equal(allowed.ok, true)
    assert.ok(allowed.lines.includes('line1'))
  } finally {
    rmSync(cwd, { recursive: true, force: true })
  }
})

// ── MINOR：shq 单引号转义 ──

test('shq escapes single quotes, $, spaces, and backticks safely', () => {
  assert.equal(shq('plain'), `'plain'`)
  assert.equal(shq(`it's`), `'it'\\''s'`)
  assert.equal(shq('$HOME'), `'$HOME'`)
  assert.equal(shq('a b c'), `'a b c'`)
  assert.equal(shq('`whoami`'), '\'`whoami`\'')
  // 组合命令串：恶意 script 参数不逃出单引号包裹
  const script = `res://x'; rm -rf /; echo '`
  const cmd = `godot --script ${shq(script)} --quit`
  assert.equal(cmd, `godot --script 'res://x'\\''; rm -rf /; echo '\\''' --quit`)
})

test('shq round-trips through a real shell without executing injected content', () => {
  // 用 printf 验证转义后的参数在真实 shell 中原样还原（不真跑 godot）。
  const nasty = `a'b $PATH \`id\` ; echo pwned`
  const out = execSync(`printf %s ${shq(nasty)}`, { shell: '/bin/sh', encoding: 'utf-8' })
  assert.equal(out, nasty)
})
