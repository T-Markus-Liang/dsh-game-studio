/** Task lifecycle decisions for repair and commit gates. */

import { archiveActiveTask, logIssue, writeActiveTask } from '../state/index.js'
import { commitScopedTask } from '../git.js'

export function judgeVerifierVerdict(verifierResult, reviewMode = 'lean') {
  if (!verifierResult || verifierResult.verdict !== 'PASS') return { verdict: 'FAIL', reason: verifierResult?.summary || 'Verifier did not pass.' }
  const fixes = verifierResult.requiredFixes || []
  if (fixes.some(fix => fix.severity === 'blocker')) return { verdict: 'FAIL', reason: 'Verifier reported a blocker.' }
  if (reviewMode === 'studio' && verifierResult.confidence === 'low') return { verdict: 'FAIL', reason: 'Low-confidence PASS requires Director Gate.' }
  return { verdict: 'PASS', reason: 'Verifier verdict accepted.' }
}

export function nextRepairState(cwd, task, failedResults, verifierResult, maxRepairRounds) {
  const requiredFixes = verifierResult?.requiredFixes || []
  const repairRound = Number(task.repairRound || 0) + 1
  const failureSummary = failedResults.flatMap(result => result.reasons || [])
  if (repairRound > maxRepairRounds) {
    const blocked = { ...task, phase: 'BLOCKED', repairRound, next: 'Report blocked task to user.' }
    writeActiveTask(cwd, blocked)
    logIssue(cwd, { taskId: task.id, kind: 'repair-limit', repairRound, requiredFixes, failureSummary })
    return { status: 'blocked', task: blocked, requiredFixes }
  }
  const repairContract = {
    ...task.contract,
    input: [...(task.contract?.input || []), ...requiredFixes.map(fix => `${fix.file}: ${fix.issue}`), ...failureSummary],
    output: 'minimal repair patch',
  }
  const updated = { ...task, phase: 'IMPLEMENT', repairRound, contract: repairContract, next: 'Dispatch specialist with required fixes.' }
  writeActiveTask(cwd, updated)
  return { status: 'repair', task: updated, requiredFixes }
}

export async function runCommitGate(cwd, task, signal) {
  const pending = Object.entries(task.gates || {}).filter(([, verdict]) => verdict !== 'PASS')
  if (pending.length || !Object.keys(task.gates || {}).length) {
    return { ok: false, error: `Commit Gate requires all gates PASS: ${pending.map(([id]) => id).join(', ') || 'no gate evidence'}` }
  }
  const committed = await commitScopedTask(cwd, task, signal)
  if (!committed.ok) return committed
  archiveActiveTask(cwd, task, { commit: committed.commit, files: committed.files, gates: task.gates })
  return committed
}
