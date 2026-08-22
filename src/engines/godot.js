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

/** 探测结果缓存（进程级，避免每次 build/test 都 execSync）。
 * `binaryProbed` 的短路语义只在未配置 `configuredBin` 时沿用旧行为；
 * 传入 `configuredBin` 时优先尝试它并照常写入缓存。 */
let cachedBinary = null
let binaryProbed = false

/**
 * 查找 Godot 可执行文件。
 * 候选顺序：`process.env.GODOT_BIN` → `configuredBin`（若非空字符串）→ `godot4` → `godot`。
 * 未传 `configuredBin` 时沿用旧 PATH 探测 + 进程级缓存语义；
 * 传入 `configuredBin`（插件配置的绝对路径）时优先尝试它，失败则回退候选，并照常缓存。
 * @param {string} [configuredBin] - 插件配置的 Godot 二进制绝对路径（可为空串）。
 * @returns {string|null}
 * @export 供测试直接验证候选顺序与回退行为。
 */
export function findGodotBinary(configuredBin) {
  const hasConfigured = typeof configuredBin === 'string' && configuredBin.length > 0
  // 未配置时命中缓存直接复用，保持旧行为。
  if (!hasConfigured && binaryProbed) return cachedBinary

  const candidates = []
  if (process.env.GODOT_BIN) candidates.push(process.env.GODOT_BIN)
  if (hasConfigured) candidates.push(configuredBin)
  candidates.push('godot4', 'godot')

  binaryProbed = true
  for (const c of candidates) {
    try {
      execSync(`${c} --version`, { stdio: 'ignore', timeout: 5000 })
      cachedBinary = c
      return c
    } catch { /* try next */ }
  }
  cachedBinary = null
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
    const bin = findGodotBinary(opts.bin)
    if (!bin) return { ok: false, exitCode: null, durationMs: 0, logPath: '', digest: { errors: [{ message: '未找到 Godot 可执行文件。请安装 Godot 4 并加入 PATH，或设置 GODOT_BIN 环境变量，或通过引擎配置 engines.godot.bin 指定绝对路径。' }], warnings: [], summary: 'godot binary not found' }, artifacts: [] }
    const cmd = `${bin} --headless --path ${shq(det.projectRoot)} --build-solutions --quit`
    return runEngineCommand(cmd, cwd, { timeoutMs: opts.timeoutMs ?? 300_000, signal: opts.signal })
  },

  async test(cwd, det, opts = {}) {
    const bin = findGodotBinary(opts.bin)
    if (!bin) return { ok: false, exitCode: null, durationMs: 0, logPath: '', digest: { errors: [{ message: '未找到 Godot 可执行文件。' }], warnings: [], summary: 'godot binary not found' }, artifacts: [] }
    const script = opts.script || 'res://test/run_tests.gd'
    // 场景入口分流：`.tscn` 以 positional 主场景形式运行（保留 autoload 单例加载）。
    // `--script` 的 SceneTree 模式不加载 autoload，会导致 `Identifier not found: GameState` 这类失败。
    const cmd = script.endsWith('.tscn')
      ? `${bin} --headless --path ${shq(det.projectRoot)} ${shq(script)}`
      : `${bin} --headless --path ${shq(det.projectRoot)} --script ${shq(script)} --quit`
    return runEngineCommand(cmd, cwd, { timeoutMs: opts.timeoutMs ?? 300_000, signal: opts.signal })
  },

  async run(cwd, det, opts = {}) {
    const bin = findGodotBinary(opts.bin)
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

/** 查找并返回 Godot 二进制路径（供测试注入）。
 * 不传参时等价旧行为（PATH/GODOT_BIN 探测 + 进程级缓存）。 */
export function godotBinary() {
  return findGodotBinary()
}
