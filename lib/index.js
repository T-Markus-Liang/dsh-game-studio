/**
 * DSH Game Studio — 插件入口。
 *
 * 设计文档：docs/design/00-dsh-integration-contract.md（机制事实）
 *            docs/design/01-architecture.md（总体架构）
 *
 * 里程碑状态：
 *   M0 骨架 ✅（可加载/可卸载/可配置）
 *   M2 命令面 + 状态 + 引擎检测 ✅（/game 命令、状态目录、引擎 detect）
 *   M3 Registry + 工具面 ✅（route/dispatch + 73 skills provider）
 *   M4 Verifier + 质量门 + Git ✅（gates/verifier/hooks）
 *   M5 打磨与发布（进行中）
 *
 * 契约核对记录（packages/ 真实源码）：
 *   - tools.register(defineTool({...}))：defineTool 来自 @deepseek-ai/dsh-tools
 *     （schema.ts:545）。parameters 是参数 map（per-property `required: true`），
 *     output 必填 { schema, render }，缺 output 直接 throw（tools/src/index.ts:1037）。
 *   - ctx.subagents.start(providerName, request)：两参；request.signal 必填
 *     （subagent/src/index.ts:458, types.ts:102）。provider 名 'spawn'。
 *   - skills.registerProvider(factory) → { name, list(), get() }（skill/src/index.ts:248）。
 *   - systemPrompt.section({ name, order, text })（system-prompt/src/index.ts:381）。
 *   - tools/pre-execute / post-execute：exec 字段是 name / arguments / agent / signal
 *     （tools/src/index.ts:152,314）。PreToolDecision = allow|deny|ask。
 */

import { join, resolve, relative, isAbsolute } from 'node:path'
import {
  readProject, writeProject, whitelistOp, readReviewMode,
  readActiveTask, writeActiveTask, logDecision, logIssue, verificationDir,
} from '../src/state/index.js'
import { judgeVerifierVerdict, nextRepairState, runCommitGate } from '../src/verify/workflow-runner.js'
import { detectAll } from '../src/engines/detect.js'
import { dispatchGameCommand } from '../src/commands/index.js'
import { registerSkillProvider, readSkillBody } from '../src/registry/skills.js'
import { registerHooks } from '../src/hooks/index.js'
import { routeTask } from '../src/orchestrator/index.js'
import { getAgent, composePersona, rulesForFiles } from '../src/registry/agents.js'
import { runGates, collectGitEvidence } from '../src/verify/gates.js'
import { dispatchVerifier, VERIFIER_SCHEMA } from '../src/verify/verifier.js'
import { resolveAgentCwd, toolFilterFor } from '../src/runtime.js'
import { guardedTool } from '../src/tool-args.js'
import { registerSettings } from '../src/config.js'

export const name = 'dsh-game-studio'

/**
 * 软依赖：commands/tools/skills/systemPrompt/settings 均在运行期经
 * `ctx.inject?.([...], ...)` 按需获取（服务缺失时对应功能静默降级），
 * 因此这里不声明加载期硬依赖。
 */
export const inject = []

/**
 * 通用 JSON 输出 schema —— annotation-only（无 type 约束）。
 * 注意：raw `tools.register` 的 `assertSupportedJsonSchema` 只接受
 * type ∈ object/array/string/number/integer/boolean/null 或省略；
 * `{ type: 'json' }` 仅是 defineTool ValueSchemaSpec 方言（编译产物即本形态）。
 * 见 docs/compatibility/0001-raw-register-output-schema-type-json.md。
 */
const JSON_OUT = { description: 'lossless JSON result' }

/**
 * 插件入口。
 * @param {import('@deepseek-ai/cordis').Context} ctx
 * @param {Record<string, unknown>} [config]
 */
export function apply(ctx, config = {}) {
  let entry = resolveConfig(config)
  ctx.inject?.(['settings'], settingsCtx => {
    registerSettings(settingsCtx, config, (value) => { entry = resolveConfig(value) }, () => { entry = resolveConfig(config) }).catch(error => {
      ctx.logger?.warn?.(`[dsh-game-studio] settings unavailable: ${error.message}`)
    })
  })

  ctx.logger?.info?.(`[dsh-game-studio] loaded (reviewMode=${entry.reviewMode})`)

  ctx.provide?.('gameStudio', {
    version: '0.1.0',
    get reviewMode() { return entry.reviewMode },
    status: () => Object.freeze({
      loaded: true,
      version: '0.1.0',
      reviewMode: entry.reviewMode,
      verify: entry.verify,
    }),
  })

  // ── /game 命令 ─────────────────────────────────────────────
  ctx.inject?.(['commands'], (commandCtx) => {
    commandCtx.commands.register({
      name: 'game',
      description: 'DSH Game Studio：AI 游戏开发工作室入口',
      input: { hint: 'start|build|debug|test|review|status|mode|agents|skills|help', images: false },
      handler: async ({ agent, rawInput, signal }) => {
        const cwd = resolveAgentCwd(agent)
        return dispatchGameCommand({ agent, rawInput, signal, cwd, config: entry })
      },
    })
  })

  // ── 模型工具（6 个）───────────────────────────────────────
  ctx.inject?.(['tools'], (toolCtx) => {
    const tools = toolCtx.tools
    tools.register(guardedTool(engineTool()))
    tools.register(guardedTool(statusTool()))
    tools.register(guardedTool(stateTool()))
    tools.register(guardedTool(routeTool()))
    tools.register(guardedTool(dispatchTool(() => entry)))
    tools.register(guardedTool(gateTool(() => entry)))
  })

  // ── Skill Registry provider（73 skills）───────────────────
  ctx.inject?.(['skills'], (skillCtx) => {
    registerSkillProvider(skillCtx)
  })

  // ── Hooks（commit/push 拦截、资产规则）─────────────────────
  registerHooks(ctx)

  // ── system prompt section（自然语言入口引导）────────────────
  ctx.inject?.(['systemPrompt'], (spCtx) => {
    registerSection(spCtx.systemPrompt || spCtx)
  })
}

// ── 配置解析 ────────────────────────────────────────────────

function resolveConfig(config = {}) {
  const verify = config.verify ?? {}
  return Object.freeze({
    reviewMode: String(config.reviewMode ?? 'lean'),
    verify: Object.freeze({
      maxRepairRounds: Number(verify.maxRepairRounds ?? 2),
    }),
    engines: Object.freeze(config.engines ?? {}),
    models: Object.freeze(config.models ?? {
      orchestrator: null,
      lead: null,
      specialist: null,
      verifier: null,
      utility: null,
    }),
  })
}

// ── 工具定义 ────────────────────────────────────────────────

/** 通用 render：把 JSON 值渲染为文本块 */
function jsonRender(_args, value) {
  return [{ type: 'text', text: typeof value === 'string' ? value : JSON.stringify(value, null, 2) }]
}

/**
 * 判断 candidate 是否位于 dir 目录内（含 dir 自身的子路径）。
 * 双边 resolve 后用 path.relative 判定，避免 startsWith 的
 * 前缀绕过（如 logs-evil/ 通过 logs 前缀检查）。
 * @param {string} dir
 * @param {string} candidate
 */
export function isInsideDir(dir, candidate) {
  const rel = relative(resolve(dir), resolve(candidate))
  return rel !== '' && !rel.startsWith('..') && !isAbsolute(rel)
}

/** game_studio_engine */
function engineTool() {
  return {
    name: 'game_studio_engine',
    description: 'DSH Game Studio：运行引擎工具链（检测/构建/测试/运行/日志解析）。长任务返回摘要+日志路径。',
    parameters: {
      type: 'object',
      properties: {
        action: { type: 'string', enum: ['detect', 'build', 'test', 'run', 'logs'], description: '引擎操作' },
        scope: { type: 'string', description: '构建/测试范围（引擎特定）' },
        logPath: { type: 'string', description: 'logs 操作要读取的日志路径' },
        filter: { type: 'string', description: 'logs 操作的可选文本过滤器' },
        offset: { type: 'integer', description: 'logs 操作的起始行，默认 0' },
      },
      required: ['action'],
    },
    output: { schema: JSON_OUT, render: jsonRender },
    execute: async ({ action, scope = '', logPath, filter = '', offset = 0 }, exec) => {
      const cwd = resolveAgentCwd(exec?.agent)
      const project = readProject(cwd)
      switch (action) {
        case 'detect': {
          const det = detectAll(cwd)
          writeProject(cwd, det)
          return { ok: true, engine: det.engine, version: det.version, projectRoot: det.projectRoot, evidence: det.evidence }
        }
        case 'build': case 'test': case 'run': {
          if (!project.engine || project.engine === 'unknown') {
            return { ok: false, error: '未检测到引擎。请先调用 game_studio_engine(action: detect)。' }
          }
          const adapter = await loadAdapter(project.engine)
          if (!adapter) return { ok: false, error: `${project.engine} 适配器尚未实现（V0.2）。仅 Godot 支持。` }
          const result = await adapter[action](cwd, project, { script: scope, signal: exec.signal })
          return { ok: result.ok, digest: result.digest, logPath: result.logPath, exitCode: result.exitCode, durationMs: result.durationMs }
        }
        case 'logs': {
          const { logsDir } = await import('../src/state/index.js')
          const { readdirSync, readFileSync } = await import('node:fs')
          const dir = logsDir(cwd)
          if (!logPath) return { ok: true, files: readdirSync(dir).slice(-5).map(file => join(dir, file)) }
          if (!isInsideDir(dir, logPath)) return { ok: false, error: 'logPath must be inside .dsh/game-studio/logs.' }
          const lines = readFileSync(logPath, 'utf-8').split('\n')
          const selected = filter ? lines.filter(line => line.includes(filter)) : lines
          const start = Math.max(0, Number(offset) || 0)
          return { ok: true, logPath, offset: start, totalLines: selected.length, lines: selected.slice(start, start + 40) }
        }
        default:
          return { ok: false, error: `未知 action: ${action}` }
      }
    },
  }
}

/** game_studio_status */
function statusTool() {
  return {
    name: 'game_studio_status',
    description: 'DSH Game Studio：读取当前项目/任务/门禁状态 JSON。',
    parameters: { type: 'object', properties: {}, required: [] },
    output: { schema: JSON_OUT, render: jsonRender },
    execute: async (_args, exec) => {
      const cwd = resolveAgentCwd(exec?.agent)
      return { project: readProject(cwd), reviewMode: readReviewMode(cwd), task: readActiveTask(cwd) }
    },
  }
}

/** game_studio_state */
function stateTool() {
  return {
    name: 'game_studio_state',
    description: 'DSH Game Studio：读写持久化任务状态（白名单操作）。',
    parameters: {
      type: 'object',
      properties: {
        op: { type: 'string', enum: ['read', 'write-task', 'write-mode', 'log-decision', 'log-issue'] },
        data: { type: 'object', description: '操作数据' },
      },
      required: ['op'],
    },
    output: { schema: JSON_OUT, render: jsonRender },
    execute: async ({ op, data = {} }, exec) => {
      const cwd = resolveAgentCwd(exec?.agent)
      return whitelistOp(cwd, op, data)
    },
  }
}

/** game_studio_route */
function routeTool() {
  return {
    name: 'game_studio_route',
    description: 'DSH Game Studio：提交任务分类（category/subsystem/workflow 全 enum），返回选配 plan：agents/skills/gates/focus-contract。',
    parameters: {
      type: 'object',
      properties: {
        category: { type: 'string', enum: ['feature', 'bug', 'design', 'test', 'perf', 'release', 'other'] },
        subsystem: { type: 'string', enum: ['movement', 'animation', 'rendering', 'netcode', 'ui', 'audio', 'gameplay', 'ai', 'level-design', 'economy'] },
        workflow: { type: 'string', enum: ['build', 'debug', 'test', 'review'] },
      },
      required: ['category'],
    },
    output: { schema: JSON_OUT, render: jsonRender },
    execute: async ({ category, subsystem, workflow }, exec) => {
      const cwd = resolveAgentCwd(exec?.agent)
      const project = readProject(cwd)
      const reviewMode = readReviewMode(cwd)
      const plan = routeTask({ category, subsystem, workflow, engine: project.engine, reviewMode })
      logDecision(cwd, 'route', plan)
      return plan
    },
  }
}

/** game_studio_dispatch */
function dispatchTool(getConfig) {
  return {
    name: 'game_studio_dispatch',
    description: 'DSH Game Studio：按角色派发 subagent（lead/specialist/verifier）。返回结构化交付结果。',
    parameters: {
      type: 'object',
      properties: {
        role: { type: 'string', enum: ['lead', 'specialist', 'verifier'] },
        agentId: { type: 'string', description: 'Agent Registry 中的 id' },
        skills: { type: 'array', items: { type: 'string' }, description: 'Route-selected internal skills to attach to the bounded task.' },
        task: {
          type: 'object',
          properties: {
            goal: { type: 'string' },
            scope: { type: 'array', items: { type: 'string' } },
            input: { type: 'array', items: { type: 'string' } },
            output: { type: 'string' },
            done: { type: 'array', items: { type: 'string' } },
          },
        },
      },
      required: ['role', 'agentId'],
    },
    output: { schema: JSON_OUT, render: jsonRender },
    execute: async ({ role, agentId, task = {}, skills = [] }, exec) => {
      const cwd = resolveAgentCwd(exec?.agent)
      const agent = getAgent(agentId)
      if (!agent) return { ok: false, error: `未知 agent: ${agentId}` }

      const contract = {
        goal: task.goal || '(未指定)',
        scope: task.scope || [],
        input: task.input || [],
        output: task.output || 'minimal change',
        done: task.done || ['tests pass', 'no regression'],
      }

      const ruleIds = rulesForFiles(contract.scope)
      const persona = composePersona(agent, { contract, ruleIds })

      const subagents = exec?.agent?.ctx?.subagents || toolSubagents(exec)
      const parent = exec?.agent

      if (!subagents || !parent) {
        logDecision(cwd, 'dispatch/fallback', { agentId, role, reason: 'subagents 服务或 parent 不可用' })
        return { ok: false, error: 'subagents 服务或 parent agent 不可用，无法派发' }
      }

      const selectedSkills = skills.map(id => ({ id, content: readSkillBody(id) })).filter(skill => skill.content)
      const skillText = selectedSkills.map(skill => `\n## Skill: ${skill.id}\n${skill.content}`).join('\n').slice(0, 24_000)
      const taskCard = `[task card]
workflow: ${readActiveTask(cwd)?.workflow || 'build'}
goal: ${contract.goal}
scope: ${contract.scope.join(', ')}
output: ${contract.output}
done: ${contract.done.join(', ')}
${skillText}

请完成上述任务，按给定 JSON Schema 输出结构化结果。`

      let run
      try {
        run = await subagents.start('spawn', {
          label: agentId,
          parent,
          signal: exec.signal,
          persona,
          prompt: [{ type: 'text', text: taskCard }],
          toolFilter: toolFilterFor(role === 'verifier' ? 'reviewer' : agent.toolProfile),
          ...(agentOptionsFor(role, agent, getConfig().models) ? { agentOptions: agentOptionsFor(role, agent, getConfig().models) } : {}),
          outputSchema: role === 'verifier' ? VERIFIER_SCHEMA : SPECIALIST_SCHEMA,
          maxDepth: 1,
        })
        const result = await run.result
        if (!result.structured || typeof result.structured !== 'object') {
          const detail = result.diagnostic || `subagent ended: ${result.stopReason}`
          logDecision(cwd, 'dispatch/error', { agentId, role, error: detail })
          return { ok: false, agentId, role, error: detail }
        }
        const active = readActiveTask(cwd)
        if (active) {
          const agents = [...(active.agents || []).filter(item => item.id !== agentId), { role, id: agentId, status: result.structured.status || 'done' }]
          writeActiveTask(cwd, { ...active, agents, phase: result.structured.status === 'blocked' ? 'BLOCKED' : active.phase, next: result.structured.status === 'blocked' ? 'resolve subagent blocker' : 'run workflow gates' })
        }
        logDecision(cwd, 'dispatch/done', { agentId, role, stopReason: result.stopReason, skills: selectedSkills.map(skill => skill.id) })
        return { ok: true, agentId, role, result: result.structured }
      } catch (err) {
        logDecision(cwd, 'dispatch/error', { agentId, role, error: err.message })
        return { ok: false, error: err.message }
      } finally {
        await run?.dispose?.()
      }
    },
  }
}

/** game_studio_gate */
function gateTool(getConfig) {
  return {
    name: 'game_studio_gate',
    description: 'DSH Game Studio：运行确定性门禁 + 可选 Verifier 裁决，返回 PASS/FAIL + 原因。',
    parameters: {
      type: 'object',
      properties: {
        action: { type: 'string', enum: ['evaluate', 'commit'], description: 'evaluate runs gates; commit runs the deterministic Commit Gate' },
        gates: { type: 'array', items: { type: 'string' }, description: 'gate id：build-pass/tests-pass/no-regression/scope-clean/no-debug-junk/asset-valid/verifier-pass' },
        stepResult: { type: 'object', description: '引擎步骤结果（build/test 返回值）' },
        runVerifier: { type: 'boolean', description: '是否运行独立 Verifier' },
      },
      required: ['action'],
    },
    output: { schema: JSON_OUT, render: jsonRender },
    execute: async ({ action, gates = [], stepResult = null, runVerifier = false }, exec) => {
      const cwd = resolveAgentCwd(exec?.agent)
      const task = readActiveTask(cwd)
      if (!task) return { allPass: false, results: [], error: 'No active task for Gate execution.' }
      if (action === 'commit') {
        const committed = await runCommitGate(cwd, task, exec.signal)
        logDecision(cwd, 'commit', { taskId: task.id, ...committed })
        return committed
      }
      const gitEvidence = await collectGitEvidence(cwd, exec.signal)
      const { readFileSync, existsSync, mkdirSync, writeFileSync } = await import('node:fs')
      const baselinePath = task ? join(verificationDir(cwd, task.id), 'failures.json') : null
      let baselineFailures = []
      if (baselinePath && existsSync(baselinePath)) {
        try { baselineFailures = JSON.parse(readFileSync(baselinePath, 'utf-8')) } catch { baselineFailures = [] }
      }
      const currentFailures = stepResult?.digest?.errors?.map(error => error.message || String(error)) || []
      const evidence = { stepResult, changedFiles: gitEvidence.changedFiles, diff: gitEvidence.diff, baselineFailures, currentFailures }

      if (runVerifier) {
        const parent = exec?.agent
        const subagents = exec?.agent?.ctx?.subagents || toolSubagents(exec)
        if (!subagents || !parent) {
          return { allPass: false, results: [], error: 'Verifier requires an active agent and subagents service.' }
        }
        const verifierResult = await dispatchVerifier({
          ctx: { subagents },
          parent,
          taskId: task?.id || 'unknown',
          signal: exec.signal,
          evidence: { ...evidence, testOutput: stepResult?.digest?.summary || '' },
        })
        evidence.verifierResult = verifierResult
        const vdir = verificationDir(cwd, task?.id || 'unknown')
        mkdirSync(vdir, { recursive: true })
        writeFileSync(join(vdir, 'verifier.json'), JSON.stringify(verifierResult, null, 2), 'utf-8')
      }

      if (evidence.verifierResult) {
        const judgement = judgeVerifierVerdict(evidence.verifierResult, task.reviewMode)
        evidence.verifierResult = { ...evidence.verifierResult, verdict: judgement.verdict, summary: judgement.reason }
        if (!gates.includes('verifier-pass')) gates = [...gates, 'verifier-pass']
      }
      const { results, allPass } = runGates(gates, evidence, cwd)
      const gateState = Object.fromEntries(results.map(result => [result.id, result.verdict]))
      const updated = { ...task, gates: { ...(task.gates || {}), ...gateState }, phase: allPass ? 'COMMIT' : 'GATE', next: allPass ? 'commit gate' : 'resolve failed gates' }
      writeActiveTask(cwd, updated)
      const vdir = verificationDir(cwd, task.id)
      mkdirSync(vdir, { recursive: true })
      writeFileSync(join(vdir, 'gates.json'), JSON.stringify({ gates, allPass, results, evidence: { changedFiles: evidence.changedFiles } }, null, 2), 'utf-8')
      writeFileSync(join(vdir, 'failures.json'), JSON.stringify(currentFailures, null, 2), 'utf-8')
      let repair = null
      const failedResults = results.filter(result => result.verdict === 'FAIL')
      if (failedResults.length) {
        repair = nextRepairState(cwd, updated, [...failedResults, { reasons: currentFailures }], evidence.verifierResult, getConfig().verify.maxRepairRounds)
        if (repair.status === 'repair') {
          const parent = exec?.agent
          const subagents = exec?.agent?.ctx?.subagents || toolSubagents(exec)
          const prior = [...(task.agents || [])].reverse().find(item => item.role === 'specialist')
          const repairAgent = prior ? getAgent(prior.id) : null
          if (parent && subagents && repairAgent) {
            let run
            try {
              run = await subagents.start('spawn', {
                label: `${repairAgent.id}-repair-${repair.task.repairRound}`,
                parent,
                signal: exec.signal,
                persona: composePersona(repairAgent, { contract: repair.task.contract, ruleIds: rulesForFiles(repair.task.contract.scope) }),
                prompt: [{ type: 'text', text: `[repair task]\n${repair.task.contract.input.join('\n')}\nReturn the required structured result.` }],
                toolFilter: toolFilterFor(repairAgent.toolProfile),
                ...(agentOptionsFor('specialist', repairAgent, getConfig().models) ? { agentOptions: agentOptionsFor('specialist', repairAgent, getConfig().models) } : {}),
                outputSchema: SPECIALIST_SCHEMA,
                maxDepth: 1,
              })
              const outcome = await run.result
              repair.dispatch = outcome.structured || { status: 'blocked', summary: outcome.diagnostic || outcome.stopReason }
              logDecision(cwd, 'repair/dispatch', { taskId: task.id, agentId: repairAgent.id, round: repair.task.repairRound, outcome: repair.dispatch.status })
            } catch (error) {
              repair.dispatch = { status: 'blocked', summary: error.message }
              logIssue(cwd, { taskId: task.id, kind: 'repair-dispatch', message: error.message })
            } finally {
              await run?.dispose?.()
            }
          } else {
            repair.dispatch = { status: 'pending', summary: 'No prior specialist is available; dispatch the repair contract manually.' }
          }
        }
      }
      const next = !allPass && !repair ? 'supply missing gate evidence' : undefined
      if (next) {
        // 竞态守卫：commit gate/其他调用可能已归档并清空 active task；
        // 此时展开 null 会写出无 id 残任务，改为返回明确错误结果。
        const current = readActiveTask(cwd)
        if (!current?.id) {
          logDecision(cwd, 'gate', { taskId: task.id, gates, allPass, results, repair: repair?.status, error: 'active task disappeared before gate follow-up write' })
          return { allPass, results, repair, error: 'Active task no longer exists (archived concurrently); gate follow-up state was not written.' }
        }
        writeActiveTask(cwd, { ...current, phase: 'GATE', next })
      }
      logDecision(cwd, 'gate', { taskId: task.id, gates, allPass, results, repair: repair?.status })
      return { allPass, results, repair }
    },
  }
}

/** Resolve optional provider/model overrides without forcing a deployment model. */
function agentOptionsFor(role, agent, models = {}) {
  const key = role === 'verifier' ? 'verifier' : agent?.modelTier === 'S' ? 'lead' : 'specialist'
  const configured = models[key]
  if (!configured || typeof configured !== 'object') return undefined
  const options = {}
  if (typeof configured.provider === 'string' && configured.provider) options.provider = configured.provider
  if (typeof configured.model === 'string' && configured.model) options.model = configured.model
  return Object.keys(options).length ? options : undefined
}

/** 从 exec 上的 agent 取 subagents 服务（exec.agent.ctx 提供） */
function toolSubagents(exec) {
  try { return exec?.agent?.ctx?.subagents } catch { return undefined }
}

/** specialist 输出 schema（对象根 JSON Schema，subagent 强制结构化） */
const SPECIALIST_SCHEMA = {
  type: 'object',
  required: ['status', 'summary', 'filesChanged', 'testsRun', 'followups'],
  properties: {
    status: { type: 'string', enum: ['done', 'blocked', 'needs-review'] },
    summary: { type: 'string' },
    filesChanged: { type: 'array', items: { type: 'string' } },
    testsRun: { type: 'string' },
    followups: { type: 'array', items: { type: 'string' } },
  },
}

/** 按引擎 id 加载适配器 */
async function loadAdapter(engineId) {
  try {
    if (engineId === 'godot') {
      const { godotAdapter } = await import('../src/engines/godot.js')
      return godotAdapter
    }
    return null
  } catch {
    return null
  }
}

/**
 * 注册 system prompt section。
 * 契约（system-prompt/src/index.ts:381）：section({ name, order, text })。
 * text 可为 (assembleCtx) => string；仅引擎项目返回非空。
 * @param {Object} sys
 */
function registerSection(sys) {
  if (!sys?.section) return
  try {
    sys.section({
      name: 'game-studio:guide',
      order: 150,
      text: (assembleCtx) => {
        // 契约：AssembleContext 只有 scope/signal（system-prompt/src/index.ts:42-50）
        // + agent 合并扩展（agent/src/runtime-types.ts:16-21）；工作区来源是
        // agent.session.header.cwd（session/src/types.ts:73）。不存在 assembleCtx.cwd。
        const cwd = assembleCtx?.agent?.session?.header?.cwd || process.cwd()
        const project = readProject(cwd)
        if (!project.engine || project.engine === 'unknown') return ''
        return [
          '[game-studio] 已检测到游戏项目（' + project.engine + (project.version ? ` ${project.version}` : '') + '）。游戏开发任务请遵循：',
          '- 先 game_studio_status 读状态 → game_studio_route 提交分类（category/subsystem 全 enum），按返回 plan 用 game_studio_dispatch 派发。',
          '- 引擎操作（detect/build/test/run/logs）走 game_studio_engine；质量门走 game_studio_gate；状态读写走 game_studio_state。',
          '- 提交前必须通过门禁；git push 一律需要人工确认。',
        ].join('\n')
      },
    })
  } catch { /* 注册失败不影响插件加载 */ }
}
