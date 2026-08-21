import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { execFileSync } from 'node:child_process'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { judgeVerifierVerdict, nextRepairState, runCommitGate } from '../src/verify/workflow-runner.js'
import { readActiveTask, writeActiveTask } from '../src/state/index.js'

function task(overrides = {}) {
  return {
    id: 'task-1', workflow: 'debug', phase: 'GATE', reviewMode: 'lean', repairRound: 0,
    contract: { goal: 'fix jump', scope: ['src/gameplay/**'], input: [], output: 'minimal patch', done: ['tests pass'] },
    gates: { 'tests-pass': 'PASS', 'verifier-pass': 'PASS' },
    ...overrides,
  }
}

test('workflow runner: verifier matrix handles blocker and studio confidence', () => {
  assert.equal(judgeVerifierVerdict({ verdict: 'PASS', confidence: 'high', requiredFixes: [] }).verdict, 'PASS')
  assert.equal(judgeVerifierVerdict({ verdict: 'PASS', confidence: 'high', requiredFixes: [{ severity: 'blocker' }] }).verdict, 'FAIL')
  assert.equal(judgeVerifierVerdict({ verdict: 'PASS', confidence: 'low', requiredFixes: [] }, 'studio').verdict, 'FAIL')
})

test('workflow runner: repair loop creates repair contract then blocks at cap', () => {
  const cwd = mkdtempSync(join(tmpdir(), 'game-studio-repair-'))
  try {
    const current = task()
    const repair = nextRepairState(cwd, current, [{ reasons: ['tests failed'] }], { requiredFixes: [{ file: 'src/gameplay/jump.gd', issue: 'missing check', severity: 'major' }] }, 1)
    assert.equal(repair.status, 'repair')
    assert.equal(readActiveTask(cwd).repairRound, 1)
    const blocked = nextRepairState(cwd, repair.task, [{ reasons: ['tests failed'] }], null, 1)
    assert.equal(blocked.status, 'blocked')
    assert.equal(readActiveTask(cwd).phase, 'BLOCKED')
  } finally {
    rmSync(cwd, { recursive: true, force: true })
  }
})

test('workflow runner: commit gate rejects incomplete gates before running git', async () => {
  const cwd = mkdtempSync(join(tmpdir(), 'game-studio-commit-'))
  try {
    const result = await runCommitGate(cwd, task({ gates: { 'tests-pass': 'FAIL' } }), new AbortController().signal)
    assert.equal(result.ok, false)
    assert.match(result.error, /requires all gates PASS/)
  } finally {
    rmSync(cwd, { recursive: true, force: true })
  }
})

test('workflow runner: commit gate scopes, commits, archives active task', async () => {
  const cwd = mkdtempSync(join(tmpdir(), 'game-studio-commit-'))
  try {
    execFileSync('git', ['init'], { cwd })
    execFileSync('git', ['config', 'user.email', 'test@example.com'], { cwd })
    execFileSync('git', ['config', 'user.name', 'Test User'], { cwd })
    writeFileSync(join(cwd, 'README.md'), 'base\n')
    execFileSync('git', ['add', 'README.md'], { cwd })
    execFileSync('git', ['commit', '-m', 'initial'], { cwd })
    const file = join(cwd, 'src', 'gameplay', 'jump.gd')
    await import('node:fs/promises').then(fs => fs.mkdir(join(cwd, 'src', 'gameplay'), { recursive: true }))
    writeFileSync(file, 'extends Node\n')
    const active = task()
    writeActiveTask(cwd, active)
    const result = await runCommitGate(cwd, active, new AbortController().signal)
    assert.equal(result.ok, true)
    assert.ok(result.commit)
    assert.equal(readActiveTask(cwd), null)
    assert.match(execFileSync('git', ['log', '-1', '--pretty=%B'], { cwd, encoding: 'utf8' }), /Verified-by: game-studio/)
  } finally {
    rmSync(cwd, { recursive: true, force: true })
  }
})
