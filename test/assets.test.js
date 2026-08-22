import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync, existsSync, readdirSync, statSync } from 'node:fs'
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

// --- 迁移返工回归断言 ---------------------------------------------------------

/** 递归列出目录下所有文件 @param {string} dir */
function walkFiles(dir) {
  const out = []
  for (const name of readdirSync(dir)) {
    const full = join(dir, name)
    if (statSync(full).isDirectory()) out.push(...walkFiles(full))
    else out.push(full)
  }
  return out
}

test('assets: docs 目录已迁移（顶层 19 项）', { skip: !HAS_ASSETS }, () => {
  const docsRoot = join(here, '..', 'assets', 'docs')
  assert.ok(existsSync(docsRoot), 'assets/docs/ 缺失')
  assert.equal(readdirSync(docsRoot).length, 19)
})

test('assets: 正文引用的 assets/docs/ 路径均存在（无断链）', { skip: !HAS_ASSETS }, () => {
  const assetsRoot = join(here, '..', 'assets')
  const refs = new Set()
  for (const f of walkFiles(assetsRoot)) {
    if (f.endsWith('UPSTREAM-LICENSE')) continue
    const text = readFileSync(f, 'utf-8')
    for (const m of text.matchAll(/assets\/docs\/[A-Za-z0-9/._-]*[A-Za-z0-9]/g)) refs.add(m[0])
  }
  // 上游既有断链（patch-notes/SKILL.md glob 探测一个不存在的模板文件），不计入
  const upstreamKnownMissing = new Set(['assets/docs/templates/patch-notes-template.md'])
  const missing = [...refs].filter(
    (r) => !upstreamKnownMissing.has(r) && !existsSync(join(here, '..', r)),
  )
  assert.deepEqual(missing, [], `assets/docs 断链：${missing.join(', ')}`)
})

test('assets: 无截断标记、无 Task tool / state// / 中文清洗串残留', { skip: !HAS_ASSETS }, () => {
  const assetsRoot = join(here, '..', 'assets')
  const offenders = []
  for (const f of walkFiles(assetsRoot)) {
    if (f.endsWith('UPSTREAM-LICENSE')) continue
    const text = readFileSync(f, 'utf-8')
    for (const needle of ['迁移时截断', 'Task tool', 'state//', '通过宿主']) {
      if (text.includes(needle)) offenders.push(`${f} 含 "${needle}"`)
    }
  }
  assert.deepEqual(offenders, [])
})

test('assets: manifest rule globs 对齐上游 paths', { skip: !HAS_ASSETS }, () => {
  const manifest = JSON.parse(readFileSync(manifestPath, 'utf-8'))
  const byId = Object.fromEntries(manifest.rules.map(r => [r.id, r.globs]))
  assert.deepEqual(byId['engine-code'], ['src/core/**'])
  assert.deepEqual(byId['network-code'], ['src/networking/**'])
  assert.deepEqual(byId['data-files'], ['assets/data/**'])
})

test('assets: manifest skill 条目带上游 agent 字段（20 个）', { skip: !HAS_ASSETS }, () => {
  const manifest = JSON.parse(readFileSync(manifestPath, 'utf-8'))
  const withAgent = manifest.skills.filter(s => typeof s.agent === 'string' && s.agent)
  assert.equal(withAgent.length, 20)
  assert.equal(manifest.skills.find(s => s.id === 'balance-check')?.agent, 'economy-designer')
})

test('assets: manifest summary 词边界截断（≤120 字符）', { skip: !HAS_ASSETS }, () => {
  const manifest = JSON.parse(readFileSync(manifestPath, 'utf-8'))
  for (const e of [...manifest.agents, ...manifest.skills]) {
    assert.ok(e.summary.length <= 120, `${e.id} summary 超长（${e.summary.length}）`)
  }
})