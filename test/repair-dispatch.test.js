import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { writeActiveTask, writeProject, readActiveTask } from '../src/state/index.js'
import { toolFilterFor } from '../src/runtime.js'
import { pathToFileURL, fileURLToPath } from 'node:url'
import { dirname } from 'node:path'

const here = dirname(fileURLToPath(import.meta.url))
const entryUrl = pathToFileURL(join(here, '..', 'lib', 'index.js')).href

async function loadGate() {
  const tools = []
  const ctx = {
    logger: { info: () => {} }, provide: () => {}, on: () => {},
    inject: (services, fn) => {
      if (services.includes('tools')) fn({ tools: { register: tool => tools.push(tool) } })
      if (services.includes('commands')) fn({ commands: { register: () => {} } })
      if (services.includes('skills')) fn({ skills: { registerProvider: () => () => {} } })
      if (services.includes('systemPrompt')) fn({ systemPrompt: { section: () => {} } })
    },
  }
  const mod = await import(entryUrl)
  mod.apply(ctx, { verify: { maxRepairRounds: 2 } })
  return tools.find(tool => tool.name === 'game_studio_gate')
}

test('gate failure re-dispatches prior specialist with a bounded repair contract', async () => {
  const cwd = mkdtempSync(join(tmpdir(), 'game-studio-repair-dispatch-'))
  try {
    writeProject(cwd, { engine: 'godot', version: '4', evidence: [] })
    writeActiveTask(cwd, {
      id: 'task-1', workflow: 'debug', phase: 'GATE', reviewMode: 'lean', repairRound: 0,
      contract: { goal: 'fix jump', scope: ['src/gameplay/**'], input: [], output: 'minimal patch', done: ['tests pass'] },
      agents: [{ role: 'specialist', id: 'gameplay-programmer', status: 'done' }], gates: {}, completed: [], git: {},
    })
    let request
    const agent = {
      session: { header: { cwd } },
      ctx: { subagents: { start: async (_provider, value) => {
        request = value
        return { result: Promise.resolve({ stopReason: 'completed', structured: { status: 'done', summary: 'repaired', filesChanged: [], testsRun: 'ok', followups: [] } }), dispose: async () => {} }
      } } },
    }
    const gate = await loadGate()
    const result = await gate.execute({
      action: 'evaluate', gates: ['tests-pass'],
      stepResult: { ok: false, exitCode: 1, digest: { errors: [{ message: 'jump test fails' }], summary: 'failed' } },
    }, { agent, signal: new AbortController().signal })
    assert.equal(result.repair.status, 'repair')
    assert.match(request.prompt[0].text, /jump test fails/)
    assert.deepEqual(request.toolFilter, toolFilterFor('coder'))
    assert.equal(readActiveTask(cwd).repairRound, 1)
  } finally {
    rmSync(cwd, { recursive: true, force: true })
  }
})
