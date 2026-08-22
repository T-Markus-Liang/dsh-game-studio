import { test } from 'node:test'
import assert from 'node:assert/strict'
import { dispatchVerifier } from '../src/verify/verifier.js'

function mockCtx() {
  const state = { request: null }
  const ctx = {
    subagents: {
      start: async (_provider, req) => {
        state.request = req
        return {
          result: Promise.resolve({
            stopReason: 'completed',
            structured: { verdict: 'PASS', confidence: 'high', reasons: [], requiredFixes: [] },
          }),
          dispose: async () => {},
        }
      },
    },
  }
  return { ctx, state }
}

const parent = { session: { header: { cwd: '/project' } } }

test('verifier model: configured models.verifier is forwarded as agentOptions', async () => {
  const { ctx, state } = mockCtx()
  const result = await dispatchVerifier({
    ctx,
    parent,
    taskId: 'task-1',
    evidence: {},
    signal: new AbortController().signal,
    models: { verifier: { provider: 'p', model: 'm' } },
  })
  assert.equal(result.verdict, 'PASS')
  assert.deepEqual(state.request.agentOptions, { provider: 'p', model: 'm' })
})

test('verifier model: unconfigured models.verifier keeps inherit semantics (no agentOptions)', async () => {
  const { ctx, state } = mockCtx()
  const result = await dispatchVerifier({
    ctx,
    parent,
    taskId: 'task-1',
    evidence: {},
    signal: new AbortController().signal,
    models: { orchestrator: null, lead: null, specialist: null, verifier: null, utility: null },
  })
  assert.equal(result.verdict, 'PASS')
  assert.ok(!('agentOptions' in state.request))
})

test('verifier model: omitted models argument defaults to no agentOptions', async () => {
  const { ctx, state } = mockCtx()
  const result = await dispatchVerifier({
    ctx,
    parent,
    taskId: 'task-1',
    evidence: {},
    signal: new AbortController().signal,
  })
  assert.equal(result.verdict, 'PASS')
  assert.ok(!('agentOptions' in state.request))
})
