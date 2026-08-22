/**
 * Godot 引擎适配器二进制选择补丁回归测试。
 *
 * 覆盖：
 *   1. findGodotBinary(configuredBin) 优先使用配置的绝对路径（存在且可执行）；
 *   2. findGodotBinary(不存在的路径) 不抛错，回退到 PATH 候选；
 *   3. godotAdapter.test 收到 opts.bin 时把它用于命令构造；
 *   4. godotBinary() 无参保持旧行为兼容。
 *
 * 风格遵循现有 node:test + node:assert/strict。用可控 PATH + 假 godot 可执行文件
 * 保证确定性，不依赖宿主机是否安装 godot。
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, rmSync, writeFileSync, chmodSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { findGodotBinary, godotAdapter, godotBinary } from '../src/engines/godot.js'

/** 创建一个假 godot 可执行文件（node shebang），`<bin> --version` 打印版本。
 * 返回 { dir, bin, dirName }，其中 dirName 是含该可执行文件的 PATH 目录。 */
function makeFakeGodot(name = 'fake-godot') {
  const dir = mkdtempSync(join(tmpdir(), 'game-studio-godot-'))
  const bin = join(dir, name)
  const script = [
    '#!/usr/bin/env node',
    'if (process.argv[2] === "--version") { process.stdout.write("4.7.1.stable.official.fake\\n"); process.exit(0) }',
    'console.log(process.argv.join(" ")); process.exit(0)',
  ].join('\n')
  writeFileSync(bin, script, { mode: 0o755 })
  chmodSync(bin, 0o755)
  return { dir, bin }
}

/** 把 PATH 临时替换（finally 恢复），并返回恢复函数。 */
function overridePath(extraDir) {
  const saved = process.env.PATH
  process.env.PATH = `${extraDir}:${saved}`
  return () => { process.env.PATH = saved }
}

test('findGodotBinary(existing configured path) returns that path when it exists and is executable', () => {
  const { dir, bin } = makeFakeGodot()
  try {
    const resolved = findGodotBinary(bin)
    assert.equal(resolved, bin)
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('findGodotBinary(nonexistent configured path) does not throw and falls back to a PATH candidate', () => {
  // 造一个叫 godot 的假可执行文件，放进 PATH；配置一个不存在的绝对路径，
  // 验证探测器不抛错并回退到 PATH 候选（godot）。
  const { dir, bin } = makeFakeGodot('godot')
  const restore = overridePath(dir)
  try {
    const resolved = findGodotBinary('/definitely/not/a/real/godot')
    assert.ok(resolved === null || typeof resolved === 'string', 'should not throw; returns null or a PATH candidate')
    // 本环境下 PATH 候选里只有假 godot，因此回退应命中它。
    if (process.env.GODOT_BIN) {
      // 若宿主设置了 GODOT_BIN，回退应优先命中它（候选顺序 GODOT_BIN 在前）。
      assert.equal(resolved, process.env.GODOT_BIN)
    } else {
      assert.equal(resolved, 'godot')
    }
  } finally {
    restore()
    rmSync(dir, { recursive: true, force: true })
  }
})

test('godotBinary() without args stays compatible (no throw; null or a path)', () => {
  assert.equal(typeof godotBinary, 'function')
  const result = godotBinary()
  assert.ok(result === null || typeof result === 'string')
})

test('godotAdapter.test uses opts.bin in constructed command', async () => {
  const { dir, bin } = makeFakeGodot()
  const cwd = mkdtempSync(join(tmpdir(), 'game-studio-godot-test-'))
  const det = { projectRoot: join(cwd, 'proj') }
  try {
    const result = await godotAdapter.test(cwd, det, { bin, script: 'res://test/run_tests.gd', timeoutMs: 10_000 })
    assert.equal(result.ok, true, 'test should succeed with a configurable bin')
    assert.equal(result.exitCode, 0)
    const log = readFileSync(result.logPath, 'utf-8')
    assert.ok(log.startsWith(bin), `command should start with configured bin, got: ${log.split('\n')[0]}`)
    assert.match(log, /--headless/)
    assert.match(log, /--script/)
    assert.match(log, /res:\/\/test\/run_tests\.gd/)
  } finally {
    rmSync(dir, { recursive: true, force: true })
    rmSync(cwd, { recursive: true, force: true })
  }
})

test('godotAdapter.test builds positional scene command for .tscn scope (no --script/--quit)', async () => {
  const { dir, bin } = makeFakeGodot()
  const cwd = mkdtempSync(join(tmpdir(), 'game-studio-godot-tscn-'))
  const det = { projectRoot: join(cwd, 'proj') }
  try {
    const result = await godotAdapter.test(cwd, det, { bin, script: 'res://test/main.tscn', timeoutMs: 10_000 })
    assert.equal(result.ok, true, 'test should succeed with a configurable scene bin')
    assert.equal(result.exitCode, 0)
    const log = readFileSync(result.logPath, 'utf-8')
    assert.ok(log.startsWith(bin), `command should start with configured bin, got: ${log.split('\n')[0]}`)
    // 场景入口：以位置参数形式包含场景路径，无 --script、无 --quit。
    assert.match(log, /--headless/)
    assert.match(log, /--path/)
    assert.match(log, /res:\/\/test\/main\.tscn/)
    assert.doesNotMatch(log, /--script/)
    assert.doesNotMatch(log, /--quit/)
  } finally {
    rmSync(dir, { recursive: true, force: true })
    rmSync(cwd, { recursive: true, force: true })
  }
})

test('godotAdapter.test keeps --script/--quit behavior for .gd scope (unchanged)', async () => {
  const { dir, bin } = makeFakeGodot()
  const cwd = mkdtempSync(join(tmpdir(), 'game-studio-godot-gd-'))
  const det = { projectRoot: join(cwd, 'proj') }
  try {
    const result = await godotAdapter.test(cwd, det, { bin, script: 'res://test/run_tests.gd', timeoutMs: 10_000 })
    assert.equal(result.ok, true, 'test should succeed with a configurable bin')
    assert.equal(result.exitCode, 0)
    const log = readFileSync(result.logPath, 'utf-8')
    assert.ok(log.startsWith(bin), `command should start with configured bin, got: ${log.split('\n')[0]}`)
    // .gd 脚本入口保持旧行为：仍带 --script 与 --quit。
    assert.match(log, /--headless/)
    assert.match(log, /--path/)
    assert.match(log, /--script/)
    assert.match(log, /--quit/)
    assert.match(log, /res:\/\/test\/run_tests\.gd/)
  } finally {
    rmSync(dir, { recursive: true, force: true })
    rmSync(cwd, { recursive: true, force: true })
  }
})
