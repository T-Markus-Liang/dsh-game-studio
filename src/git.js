/** Scoped Git operations used by the deterministic Commit Gate. */

import { execFile } from 'node:child_process'
import { promisify } from 'node:util'

const execFileAsync = promisify(execFile)

function scopeMatches(file, scope) {
  return scope.some(pattern => {
    const escaped = pattern
      .replace(/[.+^${}()|[\]\\]/g, '\\$&')
      .replace(/\*\*/g, '\u0000')
      .replace(/\*/g, '[^/]*')
      .replace(/\u0000/g, '.*')
    return new RegExp(`^${escaped}$`).test(file) || (pattern.endsWith('/') && file.startsWith(pattern))
  })
}

async function git(cwd, args, signal) {
  return execFileAsync('git', args, { cwd, encoding: 'utf-8', maxBuffer: 10 * 1024 * 1024, signal })
}

export async function changedFiles(cwd, signal) {
  const [{ stdout: diff }, { stdout: status }] = await Promise.all([
    git(cwd, ['diff', '--name-only', 'HEAD'], signal),
    git(cwd, ['status', '--short', '--untracked-files=all'], signal),
  ])
  const tracked = diff.split('\n').map(line => line.trim()).filter(Boolean)
  const untracked = status.split('\n')
    .filter(line => line.startsWith('?? '))
    .map(line => line.slice(3).trim())
  return [...new Set([...tracked, ...untracked])].filter(file => !file.startsWith('.dsh/game-studio/'))
}

/**
 * Commit only changed files that satisfy the task contract.
 * @returns {Promise<{ok:boolean, commit?:string, files?:string[], error?:string}>}
 */
export async function commitScopedTask(cwd, task, signal) {
  const scope = task?.contract?.scope || []
  if (!scope.length) return { ok: false, error: 'Commit Gate requires a non-empty Focus Contract scope.' }
  try {
    const files = await changedFiles(cwd, signal)
    const blocked = files.filter(file => !scopeMatches(file, scope))
    if (blocked.length) return { ok: false, error: `Out-of-scope files cannot be committed: ${blocked.join(', ')}` }
    if (!files.length) return { ok: false, error: 'No changed files to commit.' }
    await git(cwd, ['add', '--', ...files], signal)
    const subsystem = task.contract.scope[0].split('/').filter(Boolean).slice(-1)[0].replace(/\W+/g, '-') || 'game'
    const type = task.workflow === 'debug' ? 'fix' : task.workflow === 'build' ? 'feat' : 'chore'
    const message = `${type}(${subsystem}): ${task.contract.goal}\n\nVerified-by: game-studio`
    await git(cwd, ['commit', '-m', message], signal)
    const { stdout } = await git(cwd, ['rev-parse', '--short', 'HEAD'], signal)
    return { ok: true, commit: stdout.trim(), files }
  } catch (error) {
    return { ok: false, error: error.message }
  }
}
