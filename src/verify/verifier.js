/**
 * @file Verifier 派发 (07-verifier-quality-gates.md §3).
 * 独立裁判 subagent：persona=verifier，toolFilter=reviewer（只读），无 write。
 */

import { getAgent, readPersona, composePersona } from '../registry/agents.js'
import { verificationDir } from '../state/index.js'

/** 输出 schema：裁决 JSON */
export const VERIFIER_SCHEMA = {
  type: 'object',
  required: ['verdict', 'summary', 'issues'],
  properties: {
    verdict: { type: 'string', enum: ['PASS', 'FAIL'] },
    summary: { type: 'string', description: '两句话以内的裁决理由' },
    issues: { type: 'array', items: { type: 'string' }, description: '问题清单（FAIL 时必填）' },
  },
}

/** reviewer toolFilter：只读 + 跑测试，无 write/edit */
export const REVIEWER_TOOLS = [
  'read', 'glob', 'grep',
  'game_studio_engine',
]

/**
 * 组装 verifier persona。
 * @returns {string}
 */
export function buildVerifierPersona() {
  const base = getAgent('qa-tester')
  const body = base ? readPersona(base) : 'You are an independent QA verifier.'
  return `${body}

## Verifier 追加指令

你是**独立裁判**。你不得修改任何文件（你没有写权限）。
你的任务：审查证据包（diff、测试输出、构建日志），对实现是否满足任务目标做独立裁决。

裁决规则：
- 只依据证据，不依据 Coder 的自述。
- 发现任何与目标不符、回归、明显质量问题 → FAIL。
- 输出必须符合给定 JSON Schema：{ verdict: 'PASS'|'FAIL', summary, issues[] }。`
}

/**
 * 派发 verifier subagent。
 * @param {Object} deps
 * @param {Object} deps.ctx        — Cordis 上下文（含 subagents）
 * @param {import('@deepseek-ai/cordis').Agent} deps.parent — 宿主 agent
 * @param {string} deps.cwd
 * @param {string} deps.taskId
 * @param {Object} deps.evidence   — { diff, testOutput, stepResult }
 * @param {AbortSignal} [deps.signal]
 * @param {Object} deps.config
 * @returns {Promise<Object>} 裁决 JSON
 */
export async function dispatchVerifier({ ctx, parent, cwd, taskId, evidence, signal, config }) {
  if (!ctx?.subagents || !parent) {
    // 无 subagents 时降级：返回 SKIP 标记（门禁会 SKIP）
    return { verdict: 'SKIP', summary: 'subagents 服务不可用，跳过 Verifier', issues: [] }
  }

  const persona = buildVerifierPersona()
  const taskCard = `[verifier task]
taskId: ${taskId}
请审查以下证据包并给出独立裁决：

## 变更 diff
${(evidence.diff || '(无)').slice(0, 6000)}

## 测试输出
${(evidence.testOutput || '(无)').slice(0, 6000)}

## 构建结果
${JSON.stringify(evidence.stepResult || null)}

按给定 JSON Schema 输出裁决。`

  try {
    const result = await ctx.subagents.start('spawn', {
      label: 'verifier',
      parent,
      signal: signal || new AbortController().signal,
      persona,
      prompt: [{ type: 'text', text: taskCard }],
      outputSchema: VERIFIER_SCHEMA,
      maxDepth: 1,
    })
    return result?.structured ?? result?.result ?? { verdict: 'SKIP', summary: 'Verifier 无结构化输出', issues: [] }
  } catch (err) {
    return { verdict: 'SKIP', summary: `Verifier 派发失败: ${err.message}`, issues: [] }
  }
}