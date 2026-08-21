import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync, existsSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const here = dirname(fileURLToPath(import.meta.url))
const manifestPath = join(here, '..', 'assets', 'manifest.json')

// 当 assets 未迁移（M1 未跑）时跳过——CI 里用 `|| echo` 兜底
const HAS_ASSETS = existsSync(manifestPath)

test('assets: manifest 存在', { skip: !HAS_ASSETS }, () => {
  const manifest = JSON.parse(readFileSync(manifestPath, 'utf-8'))
  assert.ok(Array.isArray(manifest.agents))
  assert.ok(Array.isArray(manifest.skills))
  assert.ok(Array.isArray(manifest.rules))
})

test('assets: agent 条目完整性（49）', { skip: !HAS_ASSETS }, () => {
  const manifest = JSON.parse(readFileSync(manifestPath, 'utf-8'))
  assert.equal(manifest.agents.length, 49)
})

test('assets: skill 条目完整性（73）', { skip: !HAS_ASSETS }, () => {
  const manifest = JSON.parse(readFileSync(manifestPath, 'utf-8'))
  assert.equal(manifest.skills.length, 73)
})

test('assets: rule 条目完整性（11）', { skip: !HAS_ASSETS }, () => {
  const manifest = JSON.parse(readFileSync(manifestPath, 'utf-8'))
  assert.equal(manifest.rules.length, 11)
})

test('assets: 所有 agent/skill/rule file 存在', { skip: !HAS_ASSETS }, () => {
  const manifest = JSON.parse(readFileSync(manifestPath, 'utf-8'))
  const assetsRoot = join(here, '..', 'assets')
  for (const a of manifest.agents) assert.ok(existsSync(join(assetsRoot, a.file)), `agent file missing: ${a.file}`)
  for (const s of manifest.skills) assert.ok(existsSync(join(assetsRoot, s.file)), `skill file missing: ${s.file}`)
  for (const r of manifest.rules) assert.ok(existsSync(join(assetsRoot, r.file)), `rule file missing: ${r.file}`)
})

test('assets: id 唯一', { skip: !HAS_ASSETS }, () => {
  const manifest = JSON.parse(readFileSync(manifestPath, 'utf-8'))
  const agentIds = manifest.agents.map(a => a.id)
  const skillIds = manifest.skills.map(s => s.id)
  assert.equal(new Set(agentIds).size, agentIds.length)
  assert.equal(new Set(skillIds).size, skillIds.length)
})

test('assets: 清洗断言（无 .claude/、AskUserQuestion、Claude Code）', { skip: !HAS_ASSETS }, () => {
  const manifest = JSON.parse(readFileSync(manifestPath, 'utf-8'))
  const assetsRoot = join(here, '..', 'assets')
  const files = [
    ...manifest.agents.map(a => join(assetsRoot, a.file)),
    ...manifest.skills.map(s => join(assetsRoot, s.file)),
  ]
  for (const f of files) {
    const text = readFileSync(f, 'utf-8')
    assert.ok(!text.includes('.claude/'), `${f} 含 .claude/`)
    assert.ok(!text.includes('AskUserQuestion'), `${f} 含 AskUserQuestion`)
    assert.ok(!text.includes('Claude Code'), `${f} 含 Claude Code`)
  }
})

test('assets: skill 均 user-invocable=false', { skip: !HAS_ASSETS }, () => {
  const manifest = JSON.parse(readFileSync(manifestPath, 'utf-8'))
  for (const s of manifest.skills) {
    const file = join(here, '..', 'assets', s.file)
    const text = readFileSync(file, 'utf-8')
    // frontmatter 中 user-invocable 必须为 false（或不存在时由 provider 统一 false）
    const m = text.match(/^---\n([\s\S]*?)\n---/)
    if (m && m[1].includes('user-invocable')) {
      assert.ok(/user-invocable:\s*false/.test(m[1]), `${s.id} 的 user-invocable 应为 false`)
    }
  }
})

test('assets: UPSTREAM-LICENSE 存在', { skip: !HAS_ASSETS }, () => {
  assert.ok(existsSync(join(here, '..', 'assets', 'UPSTREAM-LICENSE')))
})