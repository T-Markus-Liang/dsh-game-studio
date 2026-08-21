import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

// ── state 模块测试 ─────────────────────────────────────────

test('state: readProject 返回默认值当文件不存在', async () => {
  const { readProject } = await import('../src/state/index.js')
  const dir = mkdtempSync(join(tmpdir(), 'gs-state-'))
  const p = readProject(dir)
  assert.equal(p.engine, null)
  assert.deepEqual(p.evidence, [])
  rmSync(dir, { recursive: true, force: true })
})

test('state: writeProject 后可读回', async () => {
  const { writeProject, readProject } = await import('../src/state/index.js')
  const dir = mkdtempSync(join(tmpdir(), 'gs-state-'))
  writeProject(dir, { engine: 'godot', version: '4.3', projectRoot: dir, projectFile: 'project.godot', evidence: ['project.godot'] })
  const p = readProject(dir)
  assert.equal(p.engine, 'godot')
  assert.equal(p.version, '4.3')
  rmSync(dir, { recursive: true, force: true })
})

test('state: review-mode 默认 lean，可写可读', async () => {
  const { readReviewMode, writeReviewMode } = await import('../src/state/index.js')
  const dir = mkdtempSync(join(tmpdir(), 'gs-state-'))
  assert.equal(readReviewMode(dir), 'lean')
  writeReviewMode(dir, 'studio')
  assert.equal(readReviewMode(dir), 'studio')
  rmSync(dir, { recursive: true, force: true })
})

test('state: active-task 写入后可读回', async () => {
  const { writeActiveTask, readActiveTask } = await import('../src/state/index.js')
  const dir = mkdtempSync(join(tmpdir(), 'gs-state-'))
  const task = { id: 't1', workflow: 'debug', phase: 'IMPLEMENT', contract: { goal: '修复双跳' }, engine: { id: 'godot' }, git: {}, agents: [], gates: {}, completed: [], next: 'x' }
  writeActiveTask(dir, task)
  const read = readActiveTask(dir)
  assert.equal(read.id, 't1')
  assert.equal(read.workflow, 'debug')
  rmSync(dir, { recursive: true, force: true })
})

test('state: decisions.jsonl 只追加', async () => {
  const { logDecision } = await import('../src/state/index.js')
  const { readFileSync } = await import('node:fs')
  const dir = mkdtempSync(join(tmpdir(), 'gs-state-'))
  logDecision(dir, 'test/one', { a: 1 })
  logDecision(dir, 'test/two', { b: 2 })
  const text = readFileSync(join(dir, '.dsh', 'game-studio', 'state', 'decisions.jsonl'), 'utf-8')
  const lines = text.trim().split('\n')
  assert.equal(lines.length, 2)
  assert.ok(lines[0].includes('"test/one"'))
  assert.ok(lines[1].includes('"test/two"'))
  rmSync(dir, { recursive: true, force: true })
})

test('state: whitelistOp read 返回三件套', async () => {
  const { whitelistOp } = await import('../src/state/index.js')
  const dir = mkdtempSync(join(tmpdir(), 'gs-state-'))
  const out = whitelistOp(dir, 'read')
  assert.ok('project' in out)
  assert.ok('reviewMode' in out)
  assert.ok('activeTask' in out)
  rmSync(dir, { recursive: true, force: true })
})

// ── 引擎检测测试 ───────────────────────────────────────────

function makeGodotFixture() {
  const dir = mkdtempSync(join(tmpdir(), 'gs-godot-'))
  writeFileSync(join(dir, 'project.godot'), 'config_version=5\n\n[application]\nconfig/name="test"\nconfig/features=PackedStringArray("4.3")\n', 'utf-8')
  return dir
}

test('detect: godot project.godot 被识别', async () => {
  const { detectAll } = await import('../src/engines/detect.js')
  const dir = makeGodotFixture()
  const det = detectAll(dir)
  assert.equal(det.engine, 'godot')
  rmSync(dir, { recursive: true, force: true })
})

test('detect: 空目录返回 unknown', async () => {
  const { detectAll } = await import('../src/engines/detect.js')
  const dir = mkdtempSync(join(tmpdir(), 'gs-empty-'))
  const det = detectAll(dir)
  assert.equal(det.engine, 'unknown')
  rmSync(dir, { recursive: true, force: true })
})

test('detect: 从子目录向上找到 godot 项目', async () => {
  const { detectAll } = await import('../src/engines/detect.js')
  const root = makeGodotFixture()
  const sub = join(root, 'src', 'gameplay')
  mkdirSync(sub, { recursive: true })
  const det = detectAll(sub)
  assert.equal(det.engine, 'godot')
  assert.equal(det.projectRoot, root)
  rmSync(root, { recursive: true, force: true })
})

// ── 命令分发测试 ───────────────────────────────────────────

test('commands: 未知子命令返回 error + 帮助', async () => {
  const { dispatchGameCommand } = await import('../src/commands/index.js')
  const dir = mkdtempSync(join(tmpdir(), 'gs-cmd-'))
  const res = await dispatchGameCommand({ agent: {}, rawInput: 'frobnicate', signal: null, cwd: dir, config: {} })
  assert.equal(res.kind, 'error')
  assert.ok(res.text.includes('未知子命令'))
  rmSync(dir, { recursive: true, force: true })
})

test('commands: status 零 token 返回', async () => {
  const { dispatchGameCommand } = await import('../src/commands/index.js')
  const dir = mkdtempSync(join(tmpdir(), 'gs-cmd-'))
  const res = await dispatchGameCommand({ agent: {}, rawInput: 'status', signal: null, cwd: dir, config: {} })
  assert.equal(res.kind, 'success')
  assert.ok(res.text.includes('DSH Game Studio 状态'))
  rmSync(dir, { recursive: true, force: true })
})

test('commands: mode 切换', async () => {
  const { dispatchGameCommand } = await import('../src/commands/index.js')
  const { readReviewMode } = await import('../src/state/index.js')
  const dir = mkdtempSync(join(tmpdir(), 'gs-cmd-'))
  const res = await dispatchGameCommand({ agent: {}, rawInput: 'mode studio', signal: null, cwd: dir, config: {} })
  assert.equal(res.kind, 'success')
  assert.equal(readReviewMode(dir), 'studio')
  rmSync(dir, { recursive: true, force: true })
})

test('commands: start 检测引擎并写状态（含 steer）', async () => {
  const { dispatchGameCommand } = await import('../src/commands/index.js')
  const { readProject } = await import('../src/state/index.js')
  const dir = makeGodotFixture()
  let steered = null
  const agent = { steer: async (msg) => { steered = msg } }
  const res = await dispatchGameCommand({ agent, rawInput: 'start', signal: null, cwd: dir, config: {} })
  assert.equal(res.kind, 'success')
  assert.equal(readProject(dir).engine, 'godot')
  assert.ok(steered !== null, 'steer 应被调用')
  rmSync(dir, { recursive: true, force: true })
})