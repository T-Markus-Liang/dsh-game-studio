/** Independent verifier dispatch (07-verifier-quality-gates.md §3). */

import { getAgent, readPersona } from '../registry/agents.js'
import { toolFilterFor } from '../runtime.js'
// 循环依赖说明：lib/index.js 导入本模块的 dispatchVerifier；
// agentOptionsFor 是提升的函数声明且仅在运行期调用，ESM live binding 下安全。
import { agentOptionsFor } from '../../lib/index.js'

/** Structured verdict required by the quality-gate policy. */
export const VERIFIER_SCHEMA = {
  type: 'object',
  required: ['verdict', 'confidence', 'reasons', 'requiredFixes'],
  properties: {
    verdict: { type: 'string', enum: ['PASS', 'FAIL'] },
    confidence: { type: 'string', enum: ['high', 'medium', 'low'] },
    reasons: { type: 'array', items: { type: 'string' } },
    requiredFixes: {
      type: 'array',
      items: {
        type: 'object',
        required: ['file', 'issue', 'severity'],
        properties: {
          file: { type: 'string' },
          issue: { type: 'string' },
          severity: { type: 'string', enum: ['blocker', 'major', 'minor'] },
        },
      },
    },
    notes: { type: 'string' },
  },
}

/** @deprecated Use the reviewer profile through toolFilterFor('reviewer'). */
export const REVIEWER_TOOLS = toolFilterFor('reviewer').allow

export function buildVerifierPersona() {
  const base = getAgent('qa-tester')
  const body = base ? readPersona(base) : 'You are an independent QA verifier.'
  return `${body}

## Verifier instructions
You are an independent reviewer. You have read-only tools and must not modify files.
Review only the supplied evidence. Return the required JSON verdict; report every required fix with file, issue, and severity.`
}

/**
 * Start, await, and dispose an independent verifier child.
 * @returns {Promise<Object>}
 */
export async function dispatchVerifier({ ctx, parent, taskId, evidence, signal, models = {} }) {
  if (!ctx?.subagents || !parent) {
    return { verdict: 'SKIP', summary: 'Verifier requires a subagent service and parent agent', issues: [] }
  }

  const taskCard = `[verifier task]
taskId: ${taskId}

## Git diff
${(evidence.diff || '(none)').slice(0, 6000)}

## Test output
${(evidence.testOutput || '(none)').slice(0, 6000)}

## Build result
${JSON.stringify(evidence.stepResult || null)}

Return only the required structured verdict.`

  let run
  try {
    run = await ctx.subagents.start('spawn', {
      label: 'verifier',
      parent,
      signal: signal || new AbortController().signal,
      persona: buildVerifierPersona(),
      prompt: [{ type: 'text', text: taskCard }],
      toolFilter: toolFilterFor('reviewer'),
      ...(agentOptionsFor('verifier', null, models, parent?.ctx) ? { agentOptions: agentOptionsFor('verifier', null, models, parent?.ctx) } : {}),
      outputSchema: VERIFIER_SCHEMA,
      maxDepth: 1,
    })
    const result = await run.result
    if (result.structured && typeof result.structured === 'object') return result.structured
    return { verdict: 'SKIP', summary: result.diagnostic || `Verifier ended: ${result.stopReason}`, issues: [] }
  } catch (err) {
    return { verdict: 'SKIP', summary: `Verifier dispatch failed: ${err.message}`, issues: [] }
  } finally {
    await run?.dispose?.()
  }
}
