/**
 * @file Orchestrator 路由与选配 (01-architecture.md §5, 03-agent-registry.md §4).
 * 确定性代码优先：意图分类 → 工作流选择 → Agent 选配。
 */

import { listAgents } from '../registry/agents.js'
import { workflowPlan } from './workflows.js'

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
 * Subsystem 别名表（BUG-5）：用户任务输入（中/英同义词）→ manifest 真实 subsystem 标签。
 * 右侧值必须来自 assets/manifest.json 实际标签全集（2024 统计）：
 *   accessibility, addressables, ai, analytics, audio, blueprint, community, core,
 *   csharp, dots, economy, game-design, gameplay, gas, gdextension, gdscript,
 *   level-design, live-ops, localization, narrative, netcode, performance,
 *   prototyping, rendering, replication, security, testing, tools, ui, umg, ux
 * 匹配规则：别名 key 是输入的子串时，其 targets 并入候选词集。
 * 纯英文前缀关系（render→rendering、test→testing）由双向 includes 自动覆盖，无需列出。
 */
export const SUBSYSTEM_ALIASES = Object.freeze({
  // gameplay（战斗/玩法/移动/物理）
  combat: ['gameplay'],
  battle: ['gameplay'],
  '战斗': ['gameplay'],
  '玩法': ['gameplay'],
  movement: ['gameplay'],
  '移动': ['gameplay'],
  physics: ['gameplay'],
  '物理': ['gameplay'],
  // ai（敌人/NPC 行为归 ai + gameplay）
  enemy: ['ai', 'gameplay'],
  '敌人': ['ai', 'gameplay'],
  npc: ['ai'],
  '人工智能': ['ai'],
  // ui / ux
  hud: ['ui'],
  menu: ['ui'],
  '界面': ['ui', 'ux'],
  '菜单': ['ui'],
  '体验': ['ux'],
  // rendering
  graphics: ['rendering'],
  shader: ['rendering'],
  '渲染': ['rendering'],
  '画面': ['rendering'],
  '着色器': ['rendering'],
  '图形': ['rendering'],
  // audio
  sound: ['audio'],
  music: ['audio'],
  '音频': ['audio'],
  '音效': ['audio'],
  '声音': ['audio'],
  '音乐': ['audio'],
  // netcode（网络/联机；同步兼指 UE replication）
  network: ['netcode'],
  multiplayer: ['netcode'],
  online: ['netcode'],
  '网络': ['netcode'],
  '联机': ['netcode'],
  '同步': ['netcode', 'replication'],
  // 存档/序列化 → core（manifest 无 persistence 标签，engine-programmer 持有 core）
  save: ['core'],
  '存档': ['core'],
  serialization: ['core'],
  '序列化': ['core'],
  '引擎': ['core'],
  // economy / 数值
  '经济': ['economy'],
  '数值': ['economy', 'game-design'],
  balance: ['economy', 'game-design'],
  '平衡': ['economy', 'game-design'],
  // narrative
  story: ['narrative'],
  dialogue: ['narrative'],
  quest: ['narrative'],
  '剧情': ['narrative'],
  '叙事': ['narrative'],
  '对话': ['narrative'],
  '故事': ['narrative'],
  // level-design
  level: ['level-design'],
  '关卡': ['level-design'],
  '地图': ['level-design'],
  // testing
  qa: ['testing'],
  '测试': ['testing'],
  // performance
  fps: ['performance'],
  '性能': ['performance'],
  '优化': ['performance'],
  '帧率': ['performance'],
  '卡顿': ['performance'],
  // localization
  i18n: ['localization'],
  l10n: ['localization'],
  '本地化': ['localization'],
  '翻译': ['localization'],
  // accessibility
  a11y: ['accessibility'],
  '无障碍': ['accessibility'],
  // security
  cheat: ['security'],
  '安全': ['security'],
  '反作弊': ['security'],
  // tools
  editor: ['tools'],
  pipeline: ['tools'],
  '工具': ['tools'],
  // prototyping / live-ops / community / analytics
  '原型': ['prototyping'],
  liveops: ['live-ops'],
  '运营': ['live-ops'],
  '社区': ['community'],
  telemetry: ['analytics'],
  '埋点': ['analytics'],
  '数据分析': ['analytics'],
  // 引擎子领域
  'c#': ['csharp'],
  '蓝图': ['blueprint'],
  ability: ['gas', 'gameplay'],
  '技能系统': ['gas', 'gameplay'],
})

/**
 * 兜底选配表（BUG-5 第 3 层）：subsystem 完全无法匹配时，按 category 优先选
 * 该 department 的 specialist。右侧值来自 manifest 实际 department 全集：
 *   art, audio, core, design, engine, narrative, ops, programming, qa, release
 */
const DEPARTMENT_FOR_CATEGORY = Object.freeze({
  feature: 'programming',
  bug: 'programming',
  design: 'design',
  test: 'qa',
  perf: 'qa',
  release: 'release',
  other: 'programming',
})

/**
 * 展开任务 subsystem 输入 → 候选词集（原始输入 + 命中别名的 targets）。
 * @param {string} subsystem
 * @returns {Set<string>}
 */
export function subsystemTerms(subsystem) {
  const input = String(subsystem || '').toLowerCase().trim()
  const terms = new Set(input ? [input] : [])
  if (!input) return terms
  for (const [alias, targets] of Object.entries(SUBSYSTEM_ALIASES)) {
    if (input.includes(alias)) for (const target of targets) terms.add(target)
  }
  return terms
}

/**
 * 双向 includes 匹配（BUG-5 第 1 层）：任一候选词与 agent 标签互为子串即命中。
 * @param {Set<string>} terms — subsystemTerms() 的结果
 * @param {string} tag — agent 的 subsystem 标签
 * @returns {boolean}
 */
export function tagMatches(terms, tag) {
  const t = String(tag || '').toLowerCase()
  if (!t) return false
  for (const term of terms) {
    if (term.includes(t) || t.includes(term)) return true
  }
  return false
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
  const terms = subsystemTerms(subsystem)
  const engineOk = a => !(a.engines?.length && !a.engines.includes(engine))
  const specialistsAll = agents.filter(a => a.tier === 'specialist' && engineOk(a))
  const hitCount = a => a.subsystems?.filter(s => tagMatches(terms, s)).length || 0

  let pool
  if (!subsystem) {
    pool = specialistsAll
  } else {
    const anyTaggedHit = specialistsAll.some(a => hitCount(a) > 0)
    if (anyTaggedHit) {
      // 有标签命中时只取命中者，不让空-subsystems 通配 agent 填充剩余席位
      //（QA 实测问题：战斗团队被塞进 technical-artist）
      pool = specialistsAll.filter(a => hitCount(a) > 0)
    } else {
      // 兜底（BUG-5 第 3 层）：优先 category 对应 department 的 specialist，
      // 而不是任意空-subsystems agent（战斗 bug 至少给 gameplay-programmer，不给 technical-artist）
      const dept = DEPARTMENT_FOR_CATEGORY[input.category] || 'programming'
      const deptPool = specialistsAll.filter(a => a.department === dept)
      pool = deptPool.length
        ? deptPool
        : (specialistsAll.filter(a => !(a.subsystems?.length)).length
            ? specialistsAll.filter(a => !(a.subsystems?.length))
            : specialistsAll)
    }
  }

  // rank：命中子系统数降序 → 引擎专属优先 → 有领域限定优先于无限定（空 subsystems 兜底排最后）
  pool = [...pool].sort((a, b) => {
    const aHit = subsystem ? hitCount(a) : 0
    const bHit = subsystem ? hitCount(b) : 0
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

  const plan = workflowPlan(workflow, input.reviewMode || 'lean')
  return {
    category,
    workflow,
    engine: input.engine || 'unknown',
    reviewMode: input.reviewMode || 'lean',
    team,
    phases: [...plan.phases],
    skills: [...plan.skills],
    gates: [...plan.gates],
    focusContract: {
      goal: '(provided by dispatch)',
      scope: [],
      input: [],
      output: 'minimal change',
      done: ['tests pass', 'no regression'],
    },
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