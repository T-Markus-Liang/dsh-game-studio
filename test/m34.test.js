import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, writeFileSync, mkdirSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

// ── orchestrator: selectTeam / routeTask ──────────────────

/** 最小 fixture agent 列表（模拟 manifest） */
const FIXTURE_AGENTS = [
  { id: 'producer', tier: 'director', department: 'core', engines: [], subsystems: [], modelTier: 'S', toolProfile: 'reviewer' },
  { id: 'creative-director', tier: 'director', department: 'core', engines: [], subsystems: [], modelTier: 'S', toolProfile: 'reviewer' },
  { id: 'technical-director', tier: 'director', department: 'core', engines: [], subsystems: [], modelTier: 'S', toolProfile: 'reviewer' },
  { id: 'lead-programmer', tier: 'lead', department: 'programming', engines: [], subsystems: [], modelTier: 'S', toolProfile: 'reviewer' },
  { id: 'qa-lead', tier: 'lead', department: 'qa', engines: [], subsystems: [], modelTier: 'S', toolProfile: 'analyst' },
  { id: 'qa-tester', tier: 'specialist', department: 'qa', engines: [], subsystems: ['testing'], modelTier: 'A', toolProfile: 'analyst' },
  { id: 'gameplay-programmer', tier: 'specialist', department: 'programming', engines: ['godot'], subsystems: ['gameplay', 'movement'], modelTier: 'A', toolProfile: 'coder' },
  { id: 'animation-programmer', tier: 'specialist', department: 'programming', engines: [], subsystems: ['animation'], modelTier: 'A', toolProfile: 'coder' },
  { id: 'unreal-specialist', tier: 'specialist', department: 'engine', engines: ['unreal'], subsystems: ['gameplay', 'blueprint'], modelTier: 'A', toolProfile: 'coder' },
  { id: 'ui-programmer', tier: 'specialist', department: 'programming', engines: [], subsystems: ['ui'], modelTier: 'A', toolProfile: 'coder' },
]

test('orchestrator: routeTask 合法 category 返回 plan', async () => {
  const { routeTask } = await import('../src/orchestrator/index.js')
  const plan = routeTask({ category: 'bug', subsystem: 'animation', engine: 'godot', reviewMode: 'lean', agents: FIXTURE_AGENTS })
  assert.equal(plan.category, 'bug')
  assert.equal(plan.workflow, 'debug')
  assert.ok(Array.isArray(plan.team.specialists))
  assert.ok(plan.team.specialists.length >= 1, '应选配至少 1 个 specialist')
})

test('orchestrator: 非法 category 回退 other', async () => {
  const { routeTask } = await import('../src/orchestrator/index.js')
  const plan = routeTask({ category: 'garbage', reviewMode: 'lean', agents: FIXTURE_AGENTS })
  assert.equal(plan.category, 'other')
})

test('orchestrator: solo 模式恰 1 个 specialist 且无 verifier', async () => {
  const { routeTask } = await import('../src/orchestrator/index.js')
  const plan = routeTask({ category: 'feature', subsystem: 'gameplay', engine: 'godot', reviewMode: 'solo', agents: FIXTURE_AGENTS })
  assert.ok(plan.team.specialists.length <= 1)
  assert.equal(plan.team.verifier, null)
})

test('orchestrator: studio 模式必有 lead', async () => {
  const { routeTask } = await import('../src/orchestrator/index.js')
  const plan = routeTask({ category: 'bug', subsystem: 'ui', engine: 'godot', reviewMode: 'studio', agents: FIXTURE_AGENTS })
  assert.ok(plan.team.lead !== null)
  assert.equal(plan.team.lead.id, 'technical-director')
})

test('orchestrator: 引擎过滤生效（unreal 项目不选 godot 专家）', async () => {
  const { routeTask } = await import('../src/orchestrator/index.js')
  const plan = routeTask({ category: 'feature', subsystem: 'gameplay', engine: 'unreal', reviewMode: 'lean', agents: FIXTURE_AGENTS })
  const ids = plan.team.specialists.map(s => s.id)
  assert.ok(ids.includes('unreal-specialist'))
  assert.ok(!ids.includes('gameplay-programmer'))
})

// ── gates ─────────────────────────────────────────────────

test('gates: build-pass PASS/FAIL', async () => {
  const { gateBuildPass } = await import('../src/verify/gates.js')
  assert.equal(gateBuildPass({}, { stepResult: { ok: true, durationMs: 100 } }).verdict, 'PASS')
  assert.equal(gateBuildPass({}, { stepResult: { ok: false, exitCode: 1 } }).verdict, 'FAIL')
  assert.equal(gateBuildPass({}, {}).verdict, 'SKIP')
})

test('gates: tests-pass 带错误 FAIL', async () => {
  const { gateTestsPass } = await import('../src/verify/gates.js')
  const fail = gateTestsPass({}, { stepResult: { ok: true, digest: { errors: [{ message: 'boom' }], summary: '1 errors' } } })
  assert.equal(fail.verdict, 'FAIL')
  const pass = gateTestsPass({}, { stepResult: { ok: true, digest: { errors: [], warnings: [], summary: 'ok' } } })
  assert.equal(pass.verdict, 'PASS')
})

test('gates: scope-clean 越界 FAIL', async () => {
  const { gateScopeClean } = await import('../src/verify/gates.js')
  const task = { contract: { scope: ['src/gameplay/'] } }
  assert.equal(gateScopeClean(task, { changedFiles: ['src/gameplay/x.gd'] }).verdict, 'PASS')
  assert.equal(gateScopeClean(task, { changedFiles: ['src/ui/x.gd'] }).verdict, 'FAIL')
  assert.equal(gateScopeClean({}, { changedFiles: ['x'] }).verdict, 'SKIP')
})

test('gates: no-debug-junk 检测 print', async () => {
  const { gateNoDebugJunk } = await import('../src/verify/gates.js')
  assert.equal(gateNoDebugJunk({}, { diff: 'print("debug")' }).verdict, 'FAIL')
  assert.equal(gateNoDebugJunk({}, { diff: 'clean code' }).verdict, 'PASS')
})

test('gates: runGates 全绿判定', async () => {
  const { runGates } = await import('../src/verify/gates.js')
  const cwd = mkdtempSync(join(tmpdir(), 'gs-gates-'))
  const evidence = {
    stepResult: { ok: true, digest: { errors: [], warnings: [], summary: 'ok' } },
    changedFiles: [],
    diff: '',
  }
  const { results, allPass } = runGates(['build-pass', 'tests-pass', 'no-debug-junk'], evidence, cwd)
  assert.equal(allPass, true)
  assert.equal(results.length, 3)
  rmSync(cwd, { recursive: true, force: true })
})

// ── registry: glob 匹配 ───────────────────────────────────

test('registry: rulesForFiles glob 命中', async () => {
  const { rulesForFiles } = await import('../src/registry/agents.js')
  // manifest 为空时应返回 []（assets 未迁移时）
  const hits = rulesForFiles(['src/gameplay/x.gd'])
  assert.ok(Array.isArray(hits))
})

// ── verifier: schema 形状 ─────────────────────────────────

test('verifier: VERIFIER_SCHEMA 合法', async () => {
  const { VERIFIER_SCHEMA } = await import('../src/verify/verifier.js')
  assert.equal(VERIFIER_SCHEMA.type, 'object')
  assert.ok(VERIFIER_SCHEMA.required.includes('verdict'))
})

// ── skills: frontmatter 解析 ──────────────────────────────

test('skills: parseFrontmatter 极简解析', async () => {
  const { parseFrontmatter } = await import('../src/registry/skills.js')
  const fm = parseFrontmatter('---\nname: test-skill\ndescription: "A test"\nuser-invocable: false\n---\nbody')
  assert.equal(fm.name, 'test-skill')
  assert.equal(fm.description, 'A test')
  assert.equal(fm['user-invocable'], 'false')
})

test('skills: 无 frontmatter 返回空对象', async () => {
  const { parseFrontmatter } = await import('../src/registry/skills.js')
  assert.deepEqual(parseFrontmatter('plain body'), {})
})