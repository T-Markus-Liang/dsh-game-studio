/**
 * @file 确定性 Gate 引擎 (07-verifier-quality-gates.md §2).
 * Gate = 纯函数 (taskState, evidence) => { verdict, reasons[] }。
 */

import { execSync } from 'node:child_process'
import { readFileSync, existsSync } from 'node:fs'
import { join } from 'node:path'
import { verificationDir, readActiveTask } from '../state/index.js'

/** @typedef {'PASS'|'FAIL'|'SKIP'} Verdict */

/**
 * @typedef {Object} GateResult
 * @property {Verdict} verdict
 * @property {string[]} reasons
 */

// ── gate 实现 ──────────────────────────────────────────────

/**
 * build-pass：引擎 build StepResult.ok。
 * @param {Object} taskState
 * @param {Object} evidence  { stepResult }
 * @returns {GateResult}
 */
export function gateBuildPass(taskState, evidence) {
  const sr = evidence.stepResult
  if (!sr) return { verdict: 'SKIP', reasons: ['无构建证据'] }
  return sr.ok
    ? { verdict: 'PASS', reasons: [`build ok (${sr.durationMs}ms)`] }
    : { verdict: 'FAIL', reasons: [`build failed: ${sr.digest?.summary || sr.exitCode}`] }
}

/**
 * tests-pass：引擎 test ok 且 digest.errors 空。
 */
export function gateTestsPass(taskState, evidence) {
  const sr = evidence.stepResult
  if (!sr) return { verdict: 'SKIP', reasons: ['无测试证据'] }
  if (!sr.ok) return { verdict: 'FAIL', reasons: [`test 失败: ${sr.digest?.summary || sr.exitCode}`] }
  if (sr.digest?.errors?.length) return { verdict: 'FAIL', reasons: [`测试输出含 ${sr.digest.errors.length} 个错误`] }
  return { verdict: 'PASS', reasons: [sr.digest?.summary || 'tests ok'] }
}

/**
 * no-regression：本次失败集 ⊄ 基线失败集。
 */
export function gateNoRegression(taskState, evidence) {
  const baseline = evidence.baselineFailures || []
  const current = evidence.currentFailures || []
  const newFailures = current.filter(f => !baseline.includes(f))
  if (newFailures.length > 0) return { verdict: 'FAIL', reasons: [`新增失败: ${newFailures.join(', ')}`] }
  return { verdict: 'PASS', reasons: ['无新增回归'] }
}

/**
 * scope-clean：git diff --name-only ⊆ contract.scope。
 */
export function gateScopeClean(taskState, evidence) {
  const scope = taskState?.contract?.scope || []
  const changed = evidence.changedFiles || []
  if (scope.length === 0) return { verdict: 'SKIP', reasons: ['未定义 scope'] }
  const outOfScope = changed.filter(f => !scope.some(s => f.startsWith(s.replace(/\*\*$/, '').replace(/\*$/, ''))))
  if (outOfScope.length > 0) return { verdict: 'FAIL', reasons: [`越界文件: ${outOfScope.join(', ')}`] }
  return { verdict: 'PASS', reasons: [`${changed.length} 个文件均在 scope 内`] }
}

/**
 * no-debug-junk：diff 无 print_debug/console.log/TODO 泛滥。
 */
export function gateNoDebugJunk(taskState, evidence) {
  const diff = evidence.diff || ''
  const junk = []
  if (/print_debug|print\s*\(/.test(diff)) junk.push('print_debug')
  if (/console\.log/.test(diff)) junk.push('console.log')
  if (junk.length > 0) return { verdict: 'FAIL', reasons: [`含调试残留: ${junk.join(', ')}`] }
  return { verdict: 'PASS', reasons: ['无调试残留'] }
}

/**
 * verifier-pass：Level 2 裁决 == PASS。
 */
export function gateVerifierPass(taskState, evidence) {
  const verdict = evidence.verifierResult?.verdict
  if (!verdict) return { verdict: 'SKIP', reasons: ['无 Verifier 裁决'] }
  return verdict === 'PASS'
    ? { verdict: 'PASS', reasons: ['Verifier 通过'] }
    : { verdict: 'FAIL', reasons: [`Verifier: ${evidence.verifierResult.summary || '未通过'}`] }
}

// ── gate 注册表 ────────────────────────────────────────────

export const GATES = {
  'build-pass': gateBuildPass,
  'tests-pass': gateTestsPass,
  'no-regression': gateNoRegression,
  'scope-clean': gateScopeClean,
  'no-debug-junk': gateNoDebugJunk,
  'verifier-pass': gateVerifierPass,
}

/**
 * 运行一组 gate。
 * @param {string[]} gateIds
 * @param {Object} evidence
 * @param {string} cwd
 * @returns {Object} { results: {id, verdict, reasons}[], allPass }
 */
export function runGates(gateIds, evidence, cwd) {
  const taskState = readActiveTask(cwd)
  const results = gateIds.map(id => {
    const fn = GATES[id]
    if (!fn) return { id, verdict: 'SKIP', reasons: [`未知 gate: ${id}`] }
    const r = fn(taskState, evidence)
    return { id, verdict: r.verdict, reasons: r.reasons }
  })
  const allPass = results.every(r => r.verdict === 'PASS')
  return { results, allPass }
}

/**
 * 收集 git diff 证据（scope-clean / no-debug-junk 用）。
 * @param {string} cwd
 * @returns {Object}
 */
export function collectGitEvidence(cwd) {
  try {
    const changedFiles = execSync('git diff --name-only HEAD', { cwd, encoding: 'utf-8' })
      .split('\n').map(s => s.trim()).filter(Boolean)
    const diff = execSync('git diff HEAD', { cwd, encoding: 'utf-8', maxBuffer: 10 * 1024 * 1024 })
    return { changedFiles, diff }
  } catch {
    return { changedFiles: [], diff: '' }
  }
}