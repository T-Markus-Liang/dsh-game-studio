/** Native DSH hooks for commit/push safeguards and deduplicated rule reminders. */

import { rulesForFiles } from '../registry/agents.js'
import { logDecision, logIssue, readActiveTask } from '../state/index.js'
import { resolveAgentCwd } from '../runtime.js'

const injectedRules = new Map()

export function registerHooks(ctx) {
  ctx.on?.('tools/pre-execute', (exec, next) => {
    if (exec?.name !== 'bash') return next()
    const cmd = String(exec.arguments?.command || '')
    if (!/^\s*git\s+commit\b/.test(cmd)) return next()
    const cwd = resolveAgentCwd(exec.agent)
    const task = readActiveTask(cwd)
    if (!task) return { kind: 'deny', reason: '[game-studio] No active task. Create a workflow or use the deterministic Commit Gate.' }
    const pending = Object.entries(task.gates || {}).filter(([, verdict]) => verdict !== 'PASS')
    if (pending.length || !Object.keys(task.gates || {}).length) {
      return { kind: 'deny', reason: `[game-studio] ${task.id} has no complete PASS gate set. Run game_studio_gate before committing.` }
    }
    return { kind: 'deny', reason: '[game-studio] Use game_studio_gate(action: commit) so the task is archived atomically.' }
  })

  ctx.on?.('tools/pre-execute', (exec, next) => {
    if (exec?.name !== 'bash') return next()
    if (!/^\s*git\s+push\b/.test(String(exec.arguments?.command || ''))) return next()
    return { kind: 'ask', reason: '[game-studio] git push requires explicit confirmation.' }
  })

  ctx.on?.('tools/post-execute', (exec, _result, next) => {
    const file = exec?.name === 'write' || exec?.name === 'edit' ? exec.arguments?.file_path : undefined
    if (!file) return next()
    try {
      const cwd = resolveAgentCwd(exec.agent)
      if (!injectedRules.has(cwd)) injectedRules.set(cwd, new Set())
      const seen = injectedRules.get(cwd)
      const rules = rulesForFiles([file]).filter(rule => !seen.has(rule))
      if (rules.length) {
        for (const rule of rules) seen.add(rule)
        logDecision(cwd, 'hook/asset-rule-hit', { file, rules })
        exec.agent?.inject?.({
          content: [{ type: 'text', text: `[game-studio] ${file} matches rules: ${rules.join(', ')}. Review them before committing.` }],
          source: { kind: 'plugin', plugin: 'dsh-game-studio' },
        })
      }
    } catch (error) {
      try { logIssue(resolveAgentCwd(exec.agent), { kind: 'hook-error', message: error.message }) } catch { /* observer errors never block tools */ }
    }
    return next()
  })
}
