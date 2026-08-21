/**
 * @file Hooks 事件监听器 (08-hooks-events.md).
 * 原生 DSH 监听器：commit/push 拦截、资产规则注入、审计。
 *
 * 契约核对（packages/core/tools/src/index.ts）：
 *   - tools/pre-execute 回调: (exec: ToolExecution, next) => Promise<PreToolDecision>
 *     ToolExecution 字段: name / arguments / agent / signal / callId …
 *     PreToolDecision: {kind:'allow'} | {kind:'deny', reason} | {kind:'ask', reason?}
 *   - tools/post-execute 回调: (exec, result, next) => Promise<PostToolDecision>
 *   - write/edit 工具的 file_path 参数在 exec.arguments.file_path
 *   - bash 工具名 'bash'，命令在 exec.arguments.command
 */

import { rulesForFiles } from '../registry/agents.js'
import { logDecision, readActiveTask } from '../state/index.js'

/**
 * 注册全部监听器。
 * @param {import('@deepseek-ai/cordis').Context} ctx
 */
export function registerHooks(ctx) {
  const cwd = resolveCwd(ctx)

  // ── validate-commit: 拦截 bash git commit（未过 gate 则 deny）──
  ctx.on?.('tools/pre-execute', (exec, next) => {
    if (exec?.name !== 'bash') return next()
    const cmd = String(exec?.arguments?.command || '')
    if (!/^\s*git\s+commit/.test(cmd)) return next()

    const task = readActiveTask(cwd)
    const gates = task?.gates || {}
    const pending = Object.entries(gates).filter(([, v]) => v !== 'PASS')

    if (task && pending.length > 0) {
      return {
        kind: 'deny',
        reason: `[game-studio] 任务 ${task.id} 有 ${pending.length} 个门禁未通过（${pending.map(([k]) => k).join(', ')}）。请先完成 /game review 流程。`,
      }
    }
    return next()
  })

  // ── validate-push: git push 一律 ask ────────────────────────
  ctx.on?.('tools/pre-execute', (exec, next) => {
    if (exec?.name !== 'bash') return next()
    const cmd = String(exec?.arguments?.command || '')
    if (!/^\s*git\s+push/.test(cmd)) return next()
    return { kind: 'ask', reason: '[game-studio] git push 需要确认。插件政策：不自动 push。' }
  })

  // ── validate-assets: 写入命中资产规则 → 注入警告 ────────────
  ctx.on?.('tools/post-execute', (exec, result, next) => {
    const file = exec?.name === 'write' ? exec?.arguments?.file_path
      : exec?.name === 'edit' ? exec?.arguments?.file_path
        : null
    if (!file) return next()
    try {
      const ruleIds = rulesForFiles([file])
      if (ruleIds.length > 0) {
        logDecision(cwd, 'hook/asset-rule-hit', { file, rules: ruleIds })
        const agent = exec?.agent
        if (agent?.inject) {
          agent.inject({
            content: [{ type: 'text', text: `[game-studio] 你修改的文件 \`${file}\` 命中规则：${ruleIds.join(', ')}。请在提交前核对对应规范（可用 skill 工具加载）。` }],
            source: { kind: 'plugin', plugin: 'dsh-game-studio' },
          }).catch?.(() => {})
        }
      }
    } catch { /* 观测器异常不得影响工具执行 */ }
    return next()
  })
}

function resolveCwd(ctx) {
  try {
    if (ctx.workspaces?.current) return ctx.workspaces.current
  } catch { /* fallthrough */ }
  return process.cwd()
}