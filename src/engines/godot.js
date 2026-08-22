/**
 * @file Godot engine adapter (05-engine-adapters.md §3).
 * V0.1 唯一做完整 build/test 的引擎。
 */

import { runEngineCommand, parseGodotLog } from './detect.js'
import { execSync } from 'node:child_process'

/**
 * POSIX shell 单引号转义：把任意动态段安全拼入 shell:true 的命令串。
 * 规则：整体包单引号，串内的 `'` 替换为 `'\''`。
 * （runEngineCommand 以字符串 + shell:true spawn，见 detect.js:234；
 * 保持其签名不变，仅对拼入的动态段转义，侵入最小。）
 * @param {unknown} segment
 * @returns {string}
 */
export function shq(segment) {
  return `'${String(segment).replace(/'/g, `'\\''`)}'`
}

/** 探测结果缓存（进程级，避免每次 build/test 都 execSync） */
let cachedBinary = null
let binaryProbed = false

/** 在 PATH 中查找 godot 可执行文件 */
function findGodotBinary() {
  if (binaryProbed) return cachedBinary
  binaryProbed = true
  const candidates = process.env.GODOT_BIN
    ? [process.env.GODOT_BIN]
    : ['godot4', 'godot']
  for (const c of candidates) {
    try {
      execSync(`${c} --version`, { stdio: 'ignore', timeout: 5000 })
      cachedBinary = c
      return c
    } catch { /* try next */ }
  }
  return null
}

/**
 * Godot 适配器。
 * @type {import('./detect.js').EngineAdapter}
 */
export const godotAdapter = {
  id: 'godot',

  async detect(cwd) {
    const { detectAll } = await import('./detect.js')
    const det = detectAll(cwd)
    return det.engine === 'godot' ? det : null
  },

  async build(cwd, det, opts = {}) {
    const bin = findGodotBinary()
    if (!bin) return { ok: false, exitCode: null, durationMs: 0, logPath: '', digest: { errors: [{ message: '未找到 Godot 可执行文件。请安装 Godot 4 并加入 PATH，或设置 GODOT_BIN 环境变量。' }], warnings: [], summary: 'godot binary not found' }, artifacts: [] }
    const cmd = `${bin} --headless --path ${shq(det.projectRoot)} --build-solutions --quit`
    return runEngineCommand(cmd, cwd, { timeoutMs: opts.timeoutMs ?? 300_000, signal: opts.signal })
  },

  async test(cwd, det, opts = {}) {
    const bin = findGodotBinary()
    if (!bin) return { ok: false, exitCode: null, durationMs: 0, logPath: '', digest: { errors: [{ message: '未找到 Godot 可执行文件。' }], warnings: [], summary: 'godot binary not found' }, artifacts: [] }
    const script = opts.script || 'res://test/run_tests.gd'
    const cmd = `${bin} --headless --path ${shq(det.projectRoot)} --script ${shq(script)} --quit`
    return runEngineCommand(cmd, cwd, { timeoutMs: opts.timeoutMs ?? 300_000, signal: opts.signal })
  },

  async run(cwd, det, opts = {}) {
    const bin = findGodotBinary()
    if (!bin) return { ok: false, exitCode: null, durationMs: 0, logPath: '', digest: { errors: [{ message: '未找到 Godot 可执行文件。' }], warnings: [], summary: 'godot binary not found' }, artifacts: [] }
    const frames = Number.isSafeInteger(opts.frames) && opts.frames > 0 ? opts.frames : 60
    const cmd = `${bin} --headless --path ${shq(det.projectRoot)} --quit-after ${frames}`
    return runEngineCommand(cmd, cwd, { timeoutMs: opts.timeoutMs ?? 300_000, signal: opts.signal })
  },

  parseLog(raw) {
    return parseGodotLog(raw)
  },

  assetRules: ['gameplay-code', 'shader-code', 'ui-code'],
}

/** 查找并返回 Godot 二进制路径（供测试注入） */
export function godotBinary() {
  return findGodotBinary()
}