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

import { createRequire } from 'node:module'
import { join } from 'node:path'
import {
  readProject, writeProject, whitelistOp, readReviewMode,
  readActiveTask, logDecision, verificationDir,
} from '../src/state/index.js'
import { detectAll } from '../src/engines/detect.js'
import { dispatchGameCommand } from '../src/commands/index.js'
import { registerSkillProvider } from '../src/registry/skills.js'
import { registerHooks } from '../src/hooks/index.js'
import { routeTask } from '../src/orchestrator/index.js'
import { getAgent, composePersona, rulesForFiles } from '../src/registry/agents.js'
import { runGates, collectGitEvidence } from '../src/verify/gates.js'
import { dispatchVerifier, VERIFIER_SCHEMA } from '../src/verify/verifier.js'

export const name = 'dsh-game-studio'

/** 硬依赖：/game 命令、模型工具、skills、prompt section。 */
export const inject = []

const require = createRequire(import.meta.url)

/** 通用 JSON 输出 schema（lossless JSON 节点，defineTool 接受） */
const JSON_OUT = { type: 'json' }

/**
 * 插件入口。
 * @param {import('@deepseek-ai/cordis').Context} ctx
 * @param {Record<string, unknown>} [config]
 */
export function apply(ctx, config = {}) {
  const entry = resolveConfig(config)

  ctx.logger?.info?.(`[dsh-game-studio] loaded (reviewMode=${entry.reviewMode})`)

  ctx.provide?.('gameStudio', {
    version: '0.1.0',
    reviewMode: entry.reviewMode,
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
        const cwd = resolveCwd(ctx)
        return dispatchGameCommand({ agent, rawInput, signal, cwd, config: entry })
      },
    })
  })

  // ── 模型工具（6 个）───────────────────────────────────────
  ctx.inject?.(['tools'], (toolCtx) => {
    const tools = toolCtx.tools
    tools.register(engineTool())
    tools.register(statusTool())
    tools.register(stateTool())
    tools.register(routeTool())
    tools.register(dispatchTool())
    tools.register(gateTool())
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

// ── cwd 解析 ────────────────────────────────────────────────

function resolveCwd(ctx) {
  try {
    if (ctx.workspaces?.current) return ctx.workspaces.current
  } catch { /* fallthrough */ }
  return process.cwd()
}

// ── 工具定义 ────────────────────────────────────────────────

/** 通用 render：把 JSON 值渲染为文本块 */
function jsonRender(_args, value) {
  return [{ type: 'text', text: typeof value === 'string' ? value : JSON.stringify(value, null, 2) }]
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
      },
      required: ['action'],
    },
    output: { schema: JSON_OUT, render: jsonRender },
    execute: async ({ action, scope = '' }, exec) => {
      const cwd = resolveCwd(exec?.agent?.ctx || {})
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
          const result = await adapter[action](cwd, project, { script: scope })
          return { ok: result.ok, digest: result.digest, logPath: result.logPath, exitCode: result.exitCode, durationMs: result.durationMs }
        }
        case 'logs': {
          const { logsDir } = await import('../src/state/index.js')
          const { readdirSync } = await import('node:fs')
          const dir = logsDir(cwd)
          const files = readdirSync(dir).slice(-5)
          return { ok: true, files }
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
      const cwd = resolveCwd(exec?.agent?.ctx || {})
      return readProject(cwd)
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
      const cwd = resolveCwd(exec?.agent?.ctx || {})
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
      const cwd = resolveCwd(exec?.agent?.ctx || {})
      const project = readProject(cwd)
      const reviewMode = readReviewMode(cwd)
      const plan = routeTask({ category, subsystem, workflow, engine: project.engine, reviewMode })
      logDecision(cwd, 'route', plan)
      return plan
    },
  }
}

/** game_studio_dispatch */
function dispatchTool() {
  return {
    name: 'game_studio_dispatch',
    description: 'DSH Game Studio：按角色派发 subagent（lead/specialist/verifier）。返回结构化交付结果。',
    parameters: {
      type: 'object',
      properties: {
        role: { type: 'string', enum: ['lead', 'specialist', 'verifier'] },
        agentId: { type: 'string', description: 'Agent Registry 中的 id' },
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
    execute: async ({ role, agentId, task = {} }, exec) => {
      const cwd = resolveCwd(exec?.agent?.ctx || {})
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

      const taskCard = `[task card]
workflow: ${readActiveTask(cwd)?.workflow || 'build'}
goal: ${contract.goal}
scope: ${contract.scope.join(', ')}
output: ${contract.output}
done: ${contract.done.join(', ')}

请完成上述任务，按给定 JSON Schema 输出结构化结果。`

      try {
        const result = await subagents.start('spawn', {
          label: agentId,
          parent,
          signal: exec.signal,
          persona,
          prompt: [{ type: 'text', text: taskCard }],
          outputSchema: role === 'verifier' ? VERIFIER_SCHEMA : SPECIALIST_SCHEMA,
          maxDepth: 1,
        })
        const outcome = result?.structured ?? result?.result ?? { status: 'done' }
        logDecision(cwd, 'dispatch/done', { agentId, role, status: outcome.status || 'ok' })
        return { ok: true, agentId, role, result: outcome }
      } catch (err) {
        logDecision(cwd, 'dispatch/error', { agentId, role, error: err.message })
        return { ok: false, error: err.message }
      }
    },
  }
}

/** game_studio_gate */
function gateTool() {
  return {
    name: 'game_studio_gate',
    description: 'DSH Game Studio：运行确定性门禁 + 可选 Verifier 裁决，返回 PASS/FAIL + 原因。',
    parameters: {
      type: 'object',
      properties: {
        gates: { type: 'array', items: { type: 'string' }, description: 'gate id：build-pass/tests-pass/no-regression/scope-clean/no-debug-junk/verifier-pass' },
        stepResult: { type: 'object', description: '引擎步骤结果（build/test 返回值）' },
        runVerifier: { type: 'boolean', description: '是否运行独立 Verifier' },
      },
      required: ['gates'],
    },
    output: { schema: JSON_OUT, render: jsonRender },
    execute: async ({ gates, stepResult = null, runVerifier = false }, exec) => {
      const cwd = resolveCwd(exec?.agent?.ctx || {})
      const gitEvidence = collectGitEvidence(cwd)
      const evidence = { stepResult, changedFiles: gitEvidence.changedFiles, diff: gitEvidence.diff }

      if (runVerifier) {
        const parent = exec?.agent
        const subagents = exec?.agent?.ctx?.subagents || toolSubagents(exec)
        if (subagents && parent) {
          const task = readActiveTask(cwd)
          const verifierResult = await dispatchVerifier({
            ctx: { subagents },
            parent,
            cwd,
            taskId: task?.id || 'unknown',
            evidence: { ...evidence, testOutput: stepResult?.digest?.summary || '' },
            config: {},
          })
          evidence.verifierResult = verifierResult
          try {
            const vdir = verificationDir(cwd, task?.id || 'unknown')
            const { mkdirSync, writeFileSync } = await import('node:fs')
            mkdirSync(vdir, { recursive: true })
            writeFileSync(join(vdir, 'verifier.json'), JSON.stringify(verifierResult, null, 2), 'utf-8')
          } catch { /* ignore */ }
        }
      }

      const { results, allPass } = runGates(gates, evidence, cwd)
      logDecision(cwd, 'gate', { gates, allPass, results })
      return { allPass, results }
    },
  }
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
        const cwd = assembleCtx?.cwd || process.cwd()
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

// 引用 createRequire 结果，避免未使用告警
void require