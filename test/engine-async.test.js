import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { runEngineCommand } from '../src/engines/detect.js'

test('engine command executes asynchronously and records output', async () => {
  const cwd = mkdtempSync(join(tmpdir(), 'game-studio-engine-'))
  try {
    const result = await runEngineCommand('node -e "console.log(\'engine-ok\')"', cwd, { timeoutMs: 2_000 })
    assert.equal(result.ok, true)
    assert.equal(result.exitCode, 0)
    assert.match(result.logPath, /\.dsh\/game-studio\/logs\//)
  } finally {
    rmSync(cwd, { recursive: true, force: true })
  }
})

test('engine command honors AbortSignal', async () => {
  const cwd = mkdtempSync(join(tmpdir(), 'game-studio-engine-'))
  try {
    const controller = new AbortController()
    controller.abort()
    const result = await runEngineCommand('node -e "setTimeout(() => {}, 5000)"', cwd, { timeoutMs: 10_000, signal: controller.signal })
    assert.equal(result.ok, false)
    assert.equal(result.exitCode, 130)
  } finally {
    rmSync(cwd, { recursive: true, force: true })
  }
})
