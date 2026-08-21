/**
 * @file /game 命令分发 (02-command-ux.md).
 * 单一命令 `/game <subcommand>`，子命令在 rawInput 中解析。
 */

import { readProject, writeProject, readReviewMode, writeReviewMode, readActiveTask, stateRoot, logDecision } from '../state/index.js'
import { detectAll } from '../engines/detect.js'

/** 子命令帮助文本 */
const HELP = `DSH Game Studio — AI 游戏开发工作室
用法：/game <子命令> [参数]
子命令：
  start            初始化/接管项目（检测引擎、建状态目录）
  status           查看当前项目/任务/门禁状态
  build <描述>     功能开发（feature workflow）
  debug <描述>     Bug 修复 workflow
  test [范围]      运行测试 + QA workflow
  review           综合 Review（按 review-mode 档位）
  mode <solo|lean|studio>  切换 Review Mode
  agents           列出 Agent Registry
  skills           列出 Skill Registry
  help             显示本帮助`

/** 未知子命令提示 */
const UNKNOWN = (sub) => `未知子命令：${sub || '(空)'}
${HELP}`

/**
 * 处理 /game 命令。
 * @param {Object} deps
 * @param {import('@deepseek-ai/cordis').Agent} deps.agent
 * @param {string} deps.rawInput
 * @param {AbortSignal} deps.signal
 * @param {string} deps.cwd
 * @param {Object} deps.config
 * @returns {Promise<{kind:'success'|'error', text:string}>}
 */
export async function dispatchGameCommand({ agent, rawInput, signal, cwd, config }) {
  // rawInput 以命令名后的原文开始（含前导空格）
  const trimmed = (rawInput ?? '').trim()
  const [sub, ...rest] = trimmed.split(/\s+/)
  const args = rest.join(' ')

  switch (sub) {
    case 'start': return cmdStart({ agent, cwd, config, signal })
    case 'status': return cmdStatus({ cwd, signal })
    case 'mode': return cmdMode({ cwd, args, signal })
    case 'agents': return cmdAgents({ cwd, signal, config })
    case 'skills': return cmdSkills({ cwd, signal, config })
    case 'build': return cmdBuild({ agent, cwd, args, config, signal })
    case 'debug': return cmdDebug({ agent, cwd, args, config, signal })
    case 'test': return cmdTest({ cwd, args, signal, config })
    case 'review': return cmdReview({ agent, cwd, config, signal })
    case 'help': case undefined: case '': return { kind: 'success', text: HELP }
    default: return { kind: 'error', text: UNKNOWN(sub) }
  }
}

// ── 子命令实现 ─────────────────────────────────────────────

async function cmdStart({ agent, cwd, config, signal }) {
  const det = detectAll(cwd)
  writeProject(cwd, det)
  writeReviewMode(cwd, readReviewMode(cwd)) // 确保存在

  const stateText = `[game-studio task]
workflow: start
engine: ${det.engine} (${det.version ?? '?'}, detected)
state: ${stateRoot(cwd)}/state/
goal: 初始化 DSH Game Studio

已检测到项目：${det.engine}（${det.version ?? '未知版本'}）
证据：${det.evidence.join('；') || '无'}
下一步：调用 game_studio_status 查看完整状态。`

  // 确定性部分已写入状态；模型段通过 steer 引导
  if (agent?.steer && typeof agent.steer === 'function') {
    await steerAgent(agent, stateText)
  }

  logDecision(cwd, 'command/start', { engine: det.engine, version: det.version })

  return {
    kind: 'success',
    text: `✅ 已初始化。检测到引擎：**${det.engine}**（${det.version ?? '未知版本'}）
证据：${det.evidence.join('；') || '无'}
状态目录：\`.dsh/game-studio/\`
Review Mode：\`${readReviewMode(cwd)}\`

继续输入 \`/game build <描述>\` 或 \`/game debug <描述>\` 开始开发。`,
  }
}

async function cmdStatus({ cwd, signal }) {
  const project = readProject(cwd)
  const reviewMode = readReviewMode(cwd)
  const task = readActiveTask(cwd)

  const lines = [
    '## DSH Game Studio 状态',
    '',
    `- 引擎：**${project.engine ?? 'unknown'}**${project.version ? ` (${project.version})` : ''}`,
    `- 项目根：\`${project.projectRoot ?? cwd}\``,
    `- Review Mode：\`${reviewMode}\``,
  ]

  if (task) {
    lines.push('', '### 当前任务', `- ID：\`${task.id}\``, `- Workflow：\`${task.workflow}\``, `- 阶段：\`${task.phase}\``, `- 目标：${task.contract?.goal ?? '(无)'}`, `- 下一步：${task.next ?? '(未设置)'}`)
    if (task.gates) {
      lines.push('', '### 门禁', ...Object.entries(task.gates).map(([k, v]) => `- \`${k}\`：**${v}**`))
    }
  } else {
    lines.push('', '当前无活动任务。输入 `/game build <描述>` 或 `/game debug <描述>` 开始。')
  }

  return { kind: 'success', text: lines.join('\n') }
}

async function cmdMode({ cwd, args, signal }) {
  const mode = args.trim()
  if (!['solo', 'lean', 'studio'].includes(mode)) {
    return { kind: 'error', text: `无效模式：${mode || '(空)'}。可选：solo / lean / studio` }
  }
  writeReviewMode(cwd, mode)
  return { kind: 'success', text: `✅ Review Mode 已切换为 \`${mode}\`` }
}

async function cmdAgents({ cwd, signal, config }) {
  try {
    const manifest = await loadManifest()
    const agents = manifest.agents || []
    if (agents.length === 0) return { kind: 'success', text: '（manifest 未生成——请先运行 /game start）' }

    const byDept = {}
    for (const a of agents) {
      const dept = a.department || 'other'
      if (!byDept[dept]) byDept[dept] = []
      byDept[dept].push(a)
    }

    const lines = ['## Agent Registry', '']
    for (const [dept, list] of Object.entries(byDept)) {
      lines.push(`### ${dept}`, '')
      for (const a of list) {
        lines.push(`- \`${a.id}\` — ${a.summary || ''} (${a.tier}, ${a.engines?.join('/') || 'any'})`)
      }
      lines.push('')
    }
    return { kind: 'success', text: lines.join('\n').trim() }
  } catch (err) {
    return { kind: 'error', text: `读取 Agent Registry 失败：${err.message}` }
  }
}

async function cmdSkills({ cwd, signal, config }) {
  try {
    const manifest = await loadManifest()
    const skills = manifest.skills || []
    if (skills.length === 0) return { kind: 'success', text: '（manifest 未生成——请先运行 /game start）' }

    const byCat = {}
    for (const s of skills) {
      const cat = s.category || 'meta'
      if (!byCat[cat]) byCat[cat] = []
      byCat[cat].push(s)
    }

    const lines = ['## Skill Registry', '']
    for (const [cat, list] of Object.entries(byCat)) {
      lines.push(`### ${cat}`, '')
      for (const s of list) lines.push(`- \`${s.id}\` — ${s.summary || ''}`)
      lines.push('')
    }
    return { kind: 'success', text: lines.join('\n').trim() }
  } catch (err) {
    return { kind: 'error', text: `读取 Skill Registry 失败：${err.message}` }
  }
}

async function cmdBuild({ agent, cwd, args, config, signal }) {
  return startWorkflow({ agent, cwd, args, workflow: 'build', config, signal })
}

async function cmdDebug({ agent, cwd, args, config, signal }) {
  return startWorkflow({ agent, cwd, args, workflow: 'debug', config, signal })
}

async function cmdTest({ cwd, args, signal, config }) {
  const project = readProject(cwd)
  if (project.engine === 'godot') {
    const { godotAdapter } = await import('../engines/godot.js')
    const result = await godotAdapter.test(cwd, project)
    if (result.ok) return { kind: 'success', text: `✅ 测试通过：${result.digest.summary}\n日志：\`${result.logPath}\`` }
    return { kind: 'error', text: `❌ 测试失败：${result.digest.summary}\n${result.digest.errors.map(e => e.message).slice(0, 5).join('\n')}\n日志：\`${result.logPath}\`` }
  }
  if (project.engine === 'unknown') {
    return { kind: 'error', text: '未检测到引擎，无法运行测试。请先 /game start。' }
  }
  return { kind: 'error', text: `${project.engine} 适配器尚未实现 test（V0.2）。仅 Godot 支持。` }
}

async function cmdReview({ agent, cwd, config, signal }) {
  const mode = readReviewMode(cwd)
  const text = `[game-studio task]
workflow: review
engine: ${readProject(cwd).engine ?? 'unknown'}
review-mode: ${mode}
goal: 综合代码审查

请先调用 game_studio_status 读取状态，然后按 review-mode 执行审查。`
  if (agent?.steer && typeof agent.steer === 'function') {
    await steerAgent(agent, text)
  }
  return { kind: 'success', text: `✅ 已启动 Review（mode: ${mode}）` }
}

// ── 工作流启动共用 ─────────────────────────────────────────

/**
 * 启动一个工作流：写 active-task 骨架 + steer 任务卡给宿主模型。
 */
async function startWorkflow({ agent, cwd, args, workflow, config, signal }) {
  const project = readProject(cwd)
  const reviewMode = readReviewMode(cwd)

  if (!args) {
    return { kind: 'error', text: `/game ${workflow} 需要一个描述参数。例如：/game ${workflow} 修复角色跳跃偶发双跳` }
  }

  const taskId = `${new Date().toISOString().slice(0, 10)}-${workflow}-${Math.random().toString(36).slice(2, 6)}`

  const task = {
    id: taskId,
    workflow,
    phase: 'IMPLEMENT',
    contract: {
      goal: args,
      scope: [],
      input: [],
      output: 'minimal change',
      done: ['tests pass', 'no regression'],
    },
    engine: { id: project.engine, version: project.version },
    reviewMode,
    git: { branch: null, checkpoint: null },
    agents: [],
    gates: {},
    completed: [],
    next: `route → dispatch specialists → implement → verify`,
    updatedAt: new Date().toISOString(),
  }
  const { writeActiveTask, logsDir } = await import('../state/index.js')
  writeActiveTask(cwd, task)

  const taskCard = `[game-studio task]
workflow: ${workflow}
engine: ${project.engine} (${project.version ?? '?'}, ${project.evidence.length ? 'detected' : 'not detected'})
review-mode: ${reviewMode}
state: .dsh/game-studio/state/active-task.json
goal: ${args}
下一步：调用 game_studio_route 提交分类，然后按返回的 plan 执行。`

  if (agent?.steer && typeof agent.steer === 'function') {
    await steerAgent(agent, taskCard)
  }

  logDecision(cwd, 'command/start-workflow', { taskId, workflow, goal: args })

  return { kind: 'success', text: `✅ 已启动 \`${workflow}\` 工作流（任务 ${taskId}）。请按引导执行。` }
}

// ── manifest 加载 ──────────────────────────────────────────

import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const here = dirname(fileURLToPath(import.meta.url))
const manifestPath = join(here, '..', '..', 'assets', 'manifest.json')

/** 加载 assets/manifest.json */
export async function loadManifest() {
  try {
    return JSON.parse(readFileSync(manifestPath, 'utf-8'))
  } catch {
    return { agents: [], skills: [], rules: [] }
  }
}

/**
 * 构造一条用户消息并 steer 给宿主 agent。
 * 不硬依赖 @deepseek-ai/dsh-llm（测试环境无此包）：消息形状按 DSH 约定内联构造。
 * @param {Object} agent
 * @param {string} text
 */
async function steerAgent(agent, text) {
  if (!agent?.steer || typeof agent.steer !== 'function') return
  // 消息形状：{ role:'user', content:[{type:'text', text}], source:{kind:'user'} }
  const message = Object.freeze({
    id: typeof crypto !== 'undefined' && crypto.randomUUID
      ? crypto.randomUUID()
      : `msg-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    role: 'user',
    content: [{ type: 'text', text }],
    source: { kind: 'user' },
  })
  await agent.steer(message)
}