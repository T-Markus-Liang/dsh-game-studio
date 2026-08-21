import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { resolveAgentCwd, toolFilterFor } from '../src/runtime.js'
import { dispatchVerifier } from '../src/verify/verifier.js'
import { gateNoRegression, gateVerifierPass, gateAssetValid } from '../src/verify/gates.js'

test('runtime: session header is canonical project cwd', () => {
  assert.equal(resolveAgentCwd({ session: { header: { cwd: '/project/game' } } }, '/fallback'), '/project/game')
  assert.equal(resolveAgentCwd(undefined, '/fallback'), '/fallback')
})

test('runtime: reviewer filter excludes mutating tools', () => {
  const filter = toolFilterFor('reviewer')
  assert.ok(filter.allow.includes('read'))
  assert.ok(!filter.allow.includes('write'))
  assert.ok(!filter.allow.includes('edit'))
  assert.ok(!filter.allow.includes('bash'))
})

test('verifier: awaits SubagentRun.result, applies reviewer filter, and disposes run', async () => {
  let request
  let disposed = false
  const ctx = {
    subagents: {
      start: async (_provider, req) => {
        request = req
        return {
          result: Promise.resolve({
            stopReason: 'completed',
            structured: { verdict: 'PASS', confidence: 'high', reasons: [], requiredFixes: [] },
          }),
          dispose: async () => { disposed = true },
        }
      },
    },
  }
  const result = await dispatchVerifier({
    ctx,
    parent: { session: { header: { cwd: '/project' } } },
    taskId: 'task-1',
    evidence: {},
    signal: new AbortController().signal,
  })
  assert.equal(result.verdict, 'PASS')
  assert.deepEqual(request.toolFilter, toolFilterFor('reviewer'))
  assert.equal(disposed, true)
})

test('gates: no-regression and verifier-pass cover all outcomes', () => {
  assert.equal(gateNoRegression({}, { baselineFailures: ['old'], currentFailures: ['old'] }).verdict, 'PASS')
  assert.equal(gateNoRegression({}, { baselineFailures: ['old'], currentFailures: ['old', 'new'] }).verdict, 'FAIL')
  assert.equal(gateVerifierPass({}, {}).verdict, 'SKIP')
  assert.equal(gateVerifierPass({}, { verifierResult: { verdict: 'PASS' } }).verdict, 'PASS')
  assert.equal(gateVerifierPass({}, { verifierResult: { verdict: 'FAIL', summary: 'bad' } }).verdict, 'FAIL')
})

test('gates: asset-valid skips source files and rejects unruled binary assets', () => {
  assert.equal(gateAssetValid({}, { changedFiles: ['src/gameplay/player.gd'] }).verdict, 'SKIP')
  assert.equal(gateAssetValid({}, { changedFiles: ['assets/unmatched.png'] }).verdict, 'FAIL')
})
