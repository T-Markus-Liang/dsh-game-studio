/**
 * BUG-5 回归：subsystem 双向匹配 + 中英别名表 + department 兜底。
 * team-* 解冻：teamSkills 配置开关（默认 frozen，'enabled' 时 modelInvocable 翻转）。
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'

// ── fixture：模拟真实 manifest 的关键 agent（标签取自 assets/manifest.json 实际值）──
const FIXTURE_AGENTS = [
  { id: 'lead-programmer', tier: 'lead', department: 'programming', engines: [], subsystems: [] },
  { id: 'qa-tester', tier: 'specialist', department: 'qa', engines: [], subsystems: ['testing'] },
  { id: 'gameplay-programmer', tier: 'specialist', department: 'programming', engines: [], subsystems: ['gameplay'] },
  { id: 'ai-programmer', tier: 'specialist', department: 'programming', engines: [], subsystems: ['ai'] },
  { id: 'ui-programmer', tier: 'specialist', department: 'programming', engines: [], subsystems: ['ui'] },
  { id: 'unity-ui-specialist', tier: 'specialist', department: 'engine', engines: ['unity'], subsystems: ['ui'] },
  { id: 'network-programmer', tier: 'specialist', department: 'programming', engines: [], subsystems: ['netcode'] },
  { id: 'engine-programmer', tier: 'specialist', department: 'programming', engines: [], subsystems: ['core'] },
  { id: 'godot-shader-specialist', tier: 'specialist', department: 'engine', engines: ['godot'], subsystems: ['rendering'] },
  { id: 'sound-designer', tier: 'specialist', department: 'audio', engines: [], subsystems: ['audio'] },
  { id: 'economy-designer', tier: 'specialist', department: 'design', engines: [], subsystems: ['economy'] },
  { id: 'writer', tier: 'specialist', department: 'narrative', engines: [], subsystems: ['narrative'] },
  { id: 'technical-artist', tier: 'specialist', department: 'art', engines: [], subsystems: [] },
  { id: 'devops-engineer', tier: 'specialist', department: 'release', engines: [], subsystems: [] },
]

async function idsFor(input) {
  const { selectTeam } = await import('../src/orchestrator/index.js')
  const team = selectTeam({ agents: FIXTURE_AGENTS, reviewMode: 'lean', ...input })
  return team.specialists.map(s => s.id)
}

// ── BUG-5 第 1+2 层：combat / 战斗 / gameplay 都必须选中 gameplay-programmer ──

test('BUG-5: subsystem=combat 选中 gameplay-programmer（别名 combat→gameplay）', async () => {
  const ids = await idsFor({ category: 'bug', subsystem: 'combat' })
  assert.ok(ids.includes('gameplay-programmer'), `expected gameplay-programmer in ${ids}`)
  assert.ok(!ids.includes('technical-artist'), '战斗 bug 团队不应塞进 technical-artist')
})

test('BUG-5: subsystem=战斗（中文）选中 gameplay-programmer', async () => {
  const ids = await idsFor({ category: 'bug', subsystem: '战斗' })
  assert.ok(ids.includes('gameplay-programmer'), `expected gameplay-programmer in ${ids}`)
  assert.ok(!ids.includes('technical-artist'))
})

test('BUG-5: subsystem=gameplay 精确命中 gameplay-programmer 且排第一', async () => {
  const ids = await idsFor({ category: 'bug', subsystem: 'gameplay' })
  assert.equal(ids[0], 'gameplay-programmer')
})

test('BUG-5: 双向 includes（输入是标签子串，如 render→rendering）', async () => {
  const ids = await idsFor({ category: 'bug', subsystem: 'render', engine: 'godot' })
  assert.ok(ids.includes('godot-shader-specialist'), `expected godot-shader-specialist in ${ids}`)
})

test('BUG-5: 中文别名 渲染→rendering / 音效→audio / 联机→netcode / 存档→core / 剧情→narrative', async () => {
  assert.ok((await idsFor({ category: 'bug', subsystem: '渲染', engine: 'godot' })).includes('godot-shader-specialist'))
  assert.ok((await idsFor({ category: 'bug', subsystem: '音效' })).includes('sound-designer'))
  assert.ok((await idsFor({ category: 'bug', subsystem: '联机' })).includes('network-programmer'))
  assert.ok((await idsFor({ category: 'bug', subsystem: '存档' })).includes('engine-programmer'))
  assert.ok((await idsFor({ category: 'design', subsystem: '剧情' })).includes('writer'))
  assert.ok((await idsFor({ category: 'design', subsystem: '数值' })).includes('economy-designer'))
})

test('BUG-5: ui 任务选中 ui 相关 specialist', async () => {
  const ids = await idsFor({ category: 'feature', subsystem: 'ui', engine: 'unity' })
  assert.ok(ids.includes('ui-programmer') || ids.includes('unity-ui-specialist'), `expected ui specialist in ${ids}`)
  assert.equal(ids.filter(id => id === 'technical-artist').length, 0)
})

test('BUG-5: 中文 界面 任务选中 ui specialist', async () => {
  const ids = await idsFor({ category: 'feature', subsystem: '界面' })
  assert.ok(ids.includes('ui-programmer'), `expected ui-programmer in ${ids}`)
})

test('BUG-5: 敌人（ai 别名）选中 ai-programmer 与 gameplay-programmer', async () => {
  const ids = await idsFor({ category: 'bug', subsystem: '敌人' })
  assert.ok(ids.includes('ai-programmer'), `expected ai-programmer in ${ids}`)
  assert.ok(ids.includes('gameplay-programmer'), `expected gameplay-programmer in ${ids}`)
})

// ── BUG-5 第 3 层：怪词兜底走 department 相关 specialist ──

test('BUG-5: 怪词（量子纠缠）兜底选 category 对应 department 的 specialist', async () => {
  const ids = await idsFor({ category: 'bug', subsystem: '量子纠缠' })
  assert.ok(ids.length >= 1, '兜底不能返回空团队')
  const { selectTeam } = await import('../src/orchestrator/index.js')
  const team = selectTeam({ agents: FIXTURE_AGENTS, reviewMode: 'lean', category: 'bug', subsystem: '量子纠缠' })
  for (const s of team.specialists) {
    assert.equal(s.department, 'programming', `bug 兜底应选 programming 部门，得到 ${s.id}(${s.department})`)
  }
})

test('BUG-5: 怪词 + category=design 兜底选 design 部门', async () => {
  const { selectTeam } = await import('../src/orchestrator/index.js')
  const team = selectTeam({ agents: FIXTURE_AGENTS, reviewMode: 'lean', category: 'design', subsystem: '量子纠缠' })
  assert.ok(team.specialists.length >= 1)
  for (const s of team.specialists) assert.equal(s.department, 'design')
})

test('BUG-5: 真实 manifest 上 combat/战斗/gameplay 均命中 gameplay-programmer', async () => {
  const { selectTeam } = await import('../src/orchestrator/index.js')
  const { listAgents } = await import('../src/registry/agents.js')
  const agents = listAgents()
  if (!agents.length) return // assets 未迁移时跳过
  for (const subsystem of ['combat', '战斗', 'gameplay']) {
    const team = selectTeam({ agents, reviewMode: 'lean', category: 'bug', subsystem })
    const ids = team.specialists.map(s => s.id)
    assert.ok(ids.includes('gameplay-programmer'), `subsystem=${subsystem}: expected gameplay-programmer in ${ids}`)
    assert.ok(!ids.includes('technical-artist'), `subsystem=${subsystem}: 不应选 technical-artist`)
  }
})

// ── 别名表卫生：右侧值必须是真实 manifest 标签 ──

test('BUG-5: SUBSYSTEM_ALIASES 的 targets 全部存在于 manifest subsystems 标签集', async () => {
  const { SUBSYSTEM_ALIASES } = await import('../src/orchestrator/index.js')
  const { listAgents } = await import('../src/registry/agents.js')
  const agents = listAgents()
  if (!agents.length) return // assets 未迁移时跳过
  const real = new Set(agents.flatMap(a => a.subsystems || []))
  for (const [alias, targets] of Object.entries(SUBSYSTEM_ALIASES)) {
    for (const target of targets) {
      assert.ok(real.has(target), `别名 ${alias} 指向不存在的标签 ${target}`)
    }
  }
})

// ── team-* 冻结开关 ──

function fakeSkillCtx() {
  let captured = null
  const ctx = {
    skills: {
      registerProvider: (factory) => {
        captured = factory({ signal: new AbortController().signal, invalidate: () => {} })
        return () => {}
      },
    },
  }
  return { ctx, provider: () => captured }
}

test('team-*: 默认（不传 config）仍 frozen（modelInvocable:false）', async () => {
  const { registerSkillProvider } = await import('../src/registry/skills.js')
  const { ctx, provider } = fakeSkillCtx()
  registerSkillProvider(ctx)
  const candidates = await provider().list({})
  const teams = candidates.filter(c => c.name.startsWith('team-'))
  if (!teams.length) return // assets 未迁移时跳过
  for (const c of teams) assert.equal(c.invocation.modelInvocable, false, `${c.name} 默认应冻结`)
  const others = candidates.filter(c => !c.name.startsWith('team-'))
  for (const c of others) assert.equal(c.invocation.modelInvocable, true, `${c.name} 非 team-* 应可调用`)
})

test('team-*: teamSkills=frozen 显式冻结', async () => {
  const { registerSkillProvider } = await import('../src/registry/skills.js')
  const { ctx, provider } = fakeSkillCtx()
  registerSkillProvider(ctx, { teamSkills: 'frozen' })
  const teams = (await provider().list({})).filter(c => c.name.startsWith('team-'))
  for (const c of teams) assert.equal(c.invocation.modelInvocable, false)
})

test('team-*: teamSkills=enabled 时 modelInvocable 翻转为 true（含 get 路径）', async () => {
  const { registerSkillProvider } = await import('../src/registry/skills.js')
  const { ctx, provider } = fakeSkillCtx()
  registerSkillProvider(ctx, { teamSkills: 'enabled' })
  const candidates = await provider().list({})
  const teams = candidates.filter(c => c.name.startsWith('team-'))
  if (!teams.length) return // assets 未迁移时跳过
  for (const c of teams) assert.equal(c.invocation.modelInvocable, true, `${c.name} enabled 时应可调用`)
  const def = await provider().get(teams[0], {})
  assert.equal(def.invocation.modelInvocable, true)
  // 非 team-* 不受影响
  const others = candidates.filter(c => !c.name.startsWith('team-'))
  for (const c of others) assert.equal(c.invocation.modelInvocable, true)
})

test('team-*: skillModelInvocable 纯函数契约', async () => {
  const { skillModelInvocable } = await import('../src/registry/skills.js')
  assert.equal(skillModelInvocable('team-combat'), false)
  assert.equal(skillModelInvocable('team-combat', {}), false)
  assert.equal(skillModelInvocable('team-combat', { teamSkills: 'frozen' }), false)
  assert.equal(skillModelInvocable('team-combat', { teamSkills: 'enabled' }), true)
  assert.equal(skillModelInvocable('team-combat', { teamSkills: 'garbage' }), false)
  assert.equal(skillModelInvocable('dev-story'), true)
  assert.equal(skillModelInvocable('dev-story', { teamSkills: 'frozen' }), true)
})
