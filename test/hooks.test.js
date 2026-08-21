import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { registerHooks } from '../src/hooks/index.js'
import { writeActiveTask } from '../src/state/index.js'

function setup() {
  const handlers = new Map()
  registerHooks({ on: (event, handler) => handlers.set(`${event}:${handlers.size}`, handler) })
  return [...handlers.values()]
}

test('hooks: direct git commit is denied before and after gates', () => {
  const [commit] = setup()
  const cwd = mkdtempSync(join(tmpdir(), 'game-studio-hooks-'))
  try {
    const agent = { session: { header: { cwd } } }
    const noTask = commit({ name: 'bash', arguments: { command: 'git commit -m x' }, agent }, () => ({ kind: 'allow' }))
    assert.equal(noTask.kind, 'deny')
    writeActiveTask(cwd, { id: 'task', gates: { 'tests-pass': 'PASS' } })
    const gated = commit({ name: 'bash', arguments: { command: 'git commit -m x' }, agent }, () => ({ kind: 'allow' }))
    assert.equal(gated.kind, 'deny')
    assert.match(gated.reason, /game_studio_gate\(action: commit\)/)
  } finally {
    rmSync(cwd, { recursive: true, force: true })
  }
})

test('hooks: git push always asks for confirmation', () => {
  const [, push] = setup()
  const agent = { session: { header: { cwd: '/tmp' } } }
  const pass = push({ name: 'bash', arguments: { command: 'git push origin main' }, agent }, () => ({ kind: 'allow' }))
  assert.equal(pass.kind, 'ask')
  assert.match(pass.reason, /git push/)
  const nonPush = push({ name: 'bash', arguments: { command: 'git status' }, agent }, () => ({ kind: 'allow' }))
  assert.equal(nonPush.kind, 'allow')
})

test('hooks: matching rules are injected only once per task', () => {
  const [, , post] = setup()
  const cwd = mkdtempSync(join(tmpdir(), 'game-studio-hooks-'))
  try {
    writeActiveTask(cwd, { id: 'task', gates: {} })
    const injected = []
    const agent = { session: { header: { cwd } }, inject: message => injected.push(message) }
    const exec = { name: 'write', arguments: { file_path: 'src/gameplay/player.gd' }, agent }
    post(exec, {}, () => ({ kind: 'allow' }))
    post(exec, {}, () => ({ kind: 'allow' }))
    assert.equal(injected.length, 1)
  } finally {
    rmSync(cwd, { recursive: true, force: true })
  }
})
