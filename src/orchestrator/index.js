/**
 * @file Orchestrator 路由与选配 (01-architecture.md §5, 03-agent-registry.md §4).
 * 确定性代码优先：意图分类 → 工作流选择 → Agent 选配。
 */

import { listAgents } from '../registry/agents.js'

/** 合法 category 枚举（game_studio_route 的参数 schema 用） */
export const CATEGORIES = ['feature', 'bug', 'design', 'test', 'perf', 'release', 'other']

/** 合法 workflow 枚举 */
export const WORKFLOWS = ['build', 'debug', 'test', 'review']

/**
 * lead 选配表：category → lead agent id。
 */
const LEAD_FOR = {
  feature: 'lead-programmer',
  bug: 'technical-director',
  design: 'creative-director',
  test: 'qa-lead',
  perf: 'performance-analyst',
  release: 'producer',
  other: 'lead-programmer',
}

/**
 * 选配：输入分类 → 输出 { lead, specialists, verifier }。
 * @param {Object} input
 * @param {string} input.category
 * @param {string} [input.subsystem]
 * @param {string} [input.engine]
 * @param {'solo'|'lean'|'studio'} [input.reviewMode]
 * @param {Array} [input.agents]  — 可注入的 agent 列表（测试用），默认读 manifest
 * @returns {{lead: Object|null, specialists: Object[], verifier: Object|null, plan: string[]}}
 */
export function selectTeam(input) {
  const agents = input.agents || listAgents()
  const reviewMode = input.reviewMode || 'lean'

  // lead（solo 模式可为空）
  let lead = null
  if (reviewMode === 'studio') {
    const leadId = LEAD_FOR[input.category] || 'lead-programmer'
    lead = agents.find(a => a.id === leadId) || null
  }

  // specialist pool
  const subsystem = input.subsystem || ''
  const engine = input.engine || ''
  let pool = agents.filter(a => {
    if (a.tier !== 'specialist') return false
    if (a.engines?.length && !a.engines.includes(engine)) return false
    if (subsystem && a.subsystems?.length && !a.subsystems.some(s => subsystem.includes(s))) return false
    return true
  })

  // rank：命中子系统数降序 → 引擎专属优先 → 有领域限定优先于无限定（空 subsystems 兜底排最后）
  pool = [...pool].sort((a, b) => {
    const aHit = subsystem ? (a.subsystems?.filter(s => subsystem.includes(s)).length || 0) : 0
    const bHit = subsystem ? (b.subsystems?.filter(s => subsystem.includes(s)).length || 0) : 0
    if (bHit !== aHit) return bHit - aHit
    const aEng = a.engines?.length || 0
    const bEng = b.engines?.length || 0
    if (bEng !== aEng) return bEng - aEng
    // 双方都没命中 subsystem 时，有领域标签的排前面（如 devops-engineer 这种空领域兜底角色垫底）
    if (!subsystem) return 0
    const aDomain = a.subsystems?.length || 0
    const bDomain = b.subsystems?.length || 0
    return bDomain - aDomain
  })

  const max = reviewMode === 'solo' ? 1 : 3
  const specialists = pool.slice(0, max)

  // verifier（独立，qa-tester persona 底稿）
  const verifier = reviewMode === 'solo' ? null : (agents.find(a => a.id === 'qa-tester') || null)

  // 断言 ≤5
  const total = (lead ? 1 : 0) + specialists.length + (verifier ? 1 : 0)
  if (total > 5) {
    throw new Error(`Team selection overflow: ${total} > 5`)
  }

  return {
    lead,
    specialists,
    verifier,
    plan: [
      ...(lead ? [`lead: ${lead.id}`] : []),
      ...specialists.map(s => `specialist: ${s.id}`),
      ...(verifier ? [`verifier: ${verifier.id}`] : []),
    ],
  }
}

/**
 * 路由：category/subsystem/engine → workflow + team。
 * game_studio_route 工具的内部实现。
 * @param {Object} input
 * @returns {Object}
 */
export function routeTask(input) {
  const category = CATEGORIES.includes(input.category) ? input.category : 'other'
  const workflow = input.workflow && WORKFLOWS.includes(input.workflow)
    ? input.workflow
    : workflowFor(category)

  const team = selectTeam({
    category,
    subsystem: input.subsystem,
    engine: input.engine,
    reviewMode: input.reviewMode,
    agents: input.agents,
  })

  return {
    category,
    workflow,
    engine: input.engine || 'unknown',
    reviewMode: input.reviewMode || 'lean',
    team,
  }
}

/** category → 默认 workflow */
function workflowFor(category) {
  switch (category) {
    case 'bug': return 'debug'
    case 'feature': return 'build'
    case 'test': return 'test'
    case 'review': return 'review'
    case 'design': return 'build'
    case 'perf': return 'build'
    default: return 'build'
  }
}