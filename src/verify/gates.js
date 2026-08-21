/**
 * @file 确定性 Gate 引擎 (07-verifier-quality-gates.md §2).
 * Gate = 纯函数 (taskState, evidence) => { verdict, reasons[] }。
 */

import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { readFileSync, existsSync } from 'node:fs'
import { join } from 'node:path'
import { verificationDir, readActiveTask } from '../state/index.js'
import { rulesForFiles } from '../registry/agents.js'

const execFileAsync = promisify(execFile)

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
  const outOfScope = changed.filter(file => !scope.some(pattern => matchPathGlob(file, pattern)))
  if (outOfScope.length > 0) return { verdict: 'FAIL', reasons: [`越界文件: ${outOfScope.join(', ')}`] }
  return { verdict: 'PASS', reasons: [`${changed.length} 个文件均在 scope 内`] }
}

function matchPathGlob(file, pattern) {
  const escaped = pattern
    .replace(/[.+^${}()|[\]\\]/g, '\\$&')
    .replace(/\*\*/g, '\u0000')
    .replace(/\*/g, '[^/]*')
    .replace(/\u0000/g, '.*')
  return new RegExp(`^${escaped}$`).test(file) || (pattern.endsWith('/') && file.startsWith(pattern))
}

/**
 * no-debug-junk：diff 无 print_debug/console.log/TODO 泛滥。
 */
export function gateNoDebugJunk(taskState, evidence) {
  const diff = evidence.diff || ''
  const junk = []
  if (/print_debug|\b(?:print|println)\s*\(/.test(diff)) junk.push('debug_print')
  if (/console\.log/.test(diff)) junk.push('console.log')
  if (/TODO\b/.test(diff)) junk.push('TODO')
  if (junk.length > 0) return { verdict: 'FAIL', reasons: [`含调试残留: ${junk.join(', ')}`] }
  return { verdict: 'PASS', reasons: ['无调试残留'] }
}

/** asset-valid: only asset files require an applicable asset rule. */
const ASSET_EXTENSIONS = new Set(['.png', '.jpg', '.jpeg', '.webp', '.gif', '.wav', '.mp3', '.ogg', '.flac', '.ttf', '.otf', '.glb', '.gltf', '.fbx', '.obj'])
export function gateAssetValid(taskState, evidence) {
  const assets = (evidence.changedFiles || []).filter(file => ASSET_EXTENSIONS.has(file.slice(file.lastIndexOf('.')).toLowerCase()))
  if (!assets.length) return { verdict: 'SKIP', reasons: ['无资产变更'] }
  const unchecked = assets.filter(file => rulesForFiles([file]).length === 0)
  return unchecked.length
    ? { verdict: 'FAIL', reasons: [`资产未命中验证规则: ${unchecked.join(', ')}`] }
    : { verdict: 'PASS', reasons: ['全部资产命中验证规则'] }
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
  'asset-valid': gateAssetValid,
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
 * @param {AbortSignal} [signal]
 * @returns {Promise<Object>}
 */
export async function collectGitEvidence(cwd, signal) {
  try {
    const options = { cwd, encoding: 'utf-8', maxBuffer: 10 * 1024 * 1024, signal }
    const [{ stdout: files }, { stdout: diff }] = await Promise.all([
      execFileAsync('git', ['diff', '--name-only', 'HEAD'], options),
      execFileAsync('git', ['diff', 'HEAD'], options),
    ])
    return { changedFiles: files.split('\n').map(s => s.trim()).filter(Boolean), diff }
  } catch {
    return { changedFiles: [], diff: '' }
  }
}