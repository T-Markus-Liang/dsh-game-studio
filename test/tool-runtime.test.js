import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL, fileURLToPath } from 'node:url'
import { dirname } from 'node:path'
import { writeProject, writeActiveTask, readActiveTask } from '../src/state/index.js'
import { toolFilterFor } from '../src/runtime.js'

const here = dirname(fileURLToPath(import.meta.url))
const entryUrl = pathToFileURL(join(here, '..', 'lib', 'index.js')).href

function loadTools() {
  const tools = []
  const ctx = {
    provide: () => {},
    logger: { info: () => {} },
    on: () => {},
    inject: (services, callback) => {
      if (services.includes('tools')) callback({ tools: { register: tool => tools.push(tool) } })
      if (services.includes('commands')) callback({ commands: { register: () => {} } })
      if (services.includes('skills')) callback({ skills: { registerProvider: () => () => {} } })
      if (services.includes('systemPrompt')) callback({ systemPrompt: { section: () => {} } })
    },
  }
  return import(entryUrl).then(mod => {
    mod.apply(ctx, {})
    return tools
  })
}

test('dispatch tool awaits run result, scopes tools, uses agent cwd, and disposes', async () => {
  const cwd = mkdtempSync(join(tmpdir(), 'game-studio-runtime-'))
  try {
    writeProject(cwd, { engine: 'godot', version: '4.3', projectRoot: cwd, projectFile: 'project.godot', evidence: [] })
    writeActiveTask(cwd, {
      id: 'task-1', workflow: 'debug', phase: 'IMPLEMENT',
      contract: { goal: 'fix jump', scope: ['src/gameplay/**'], input: [], output: 'minimal patch', done: ['tests pass'] },
      engine: { id: 'godot' }, reviewMode: 'lean', git: {}, agents: [], gates: {}, completed: [], next: 'dispatch',
    })
    let request
    let disposed = false
    const agent = {
      session: { header: { cwd } },
      ctx: {
        subagents: {
          start: async (_provider, req) => {
            request = req
            return {
              result: Promise.resolve({ stopReason: 'completed', structured: { status: 'done', summary: 'fixed', filesChanged: [], testsRun: 'ok', followups: [] } }),
              dispose: async () => { disposed = true },
            }
          },
        },
      },
    }
    const tools = await loadTools()
    const dispatch = tools.find(tool => tool.name === 'game_studio_dispatch')
    const output = await dispatch.execute({
      role: 'specialist', agentId: 'gameplay-programmer',
      task: { goal: 'fix jump', scope: ['src/gameplay/**'], input: [], output: 'minimal patch', done: ['tests pass'] },
    }, { agent, signal: new AbortController().signal })

    assert.equal(output.ok, true)
    assert.equal(output.result.status, 'done')
    await assert.rejects(
      () => dispatch.execute({ agentId: 'gameplay-programmer', task: {} }, { agent, signal: new AbortController().signal }),
      /missing required tool argument: role/,
    )
    assert.deepEqual(request.toolFilter, toolFilterFor('coder'))
    assert.match(request.prompt[0].text, /\[task card\]/)
    assert.equal(request.parent, agent)
    assert.equal(disposed, true)
    assert.equal(readActiveTask(cwd).id, 'task-1')

    const gate = tools.find(tool => tool.name === 'game_studio_gate')
    const gateOutput = await gate.execute({ action: 'evaluate', gates: ['no-debug-junk'] }, { agent, signal: new AbortController().signal })
    assert.equal(gateOutput.allPass, true)
    assert.equal(readActiveTask(cwd).gates['no-debug-junk'], 'PASS')
  } finally {
    rmSync(cwd, { recursive: true, force: true })
  }
})
