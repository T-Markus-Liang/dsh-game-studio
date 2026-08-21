/**
 * @file Engine detection (05-engine-adapters.md §2).
 * 证据打分系统：从 cwd 向上 3 层 + 向下 1 层扫描。
 */

import { readFileSync, existsSync, readdirSync, mkdirSync, writeFileSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { spawn } from 'node:child_process'

/**
 * @typedef {Object} Detection
 * @property {string} engine   — 'unity' | 'unreal' | 'godot' | 'unknown'
 * @property {string|null} version
 * @property {string} projectRoot
 * @property {string|null} projectFile
 * @property {string[]} evidence
 */

/**
 * @typedef {Object} StepResult
 * @property {boolean} ok
 * @property {number|null} exitCode
 * @property {number} durationMs
 * @property {string} logPath
 * @property {LogDigest} digest
 * @property {string[]} artifacts
 */

/**
 * @typedef {Object} LogDigest
 * @property {Array<{code?:string,file?:string,line?:number,message:string}>} errors
 * @property {Array<{message:string}>} warnings
 * @property {string} summary
 */

/**
 * 从 cwd 开始向上扫描目录，寻找引擎证据。
 * @param {string} cwd
 * @param {number} upMax
 * @returns {Array<{depth:number, dir:string}>}
 */
function scanDirs(cwd, upMax = 3) {
  const dirs = [{ depth: 0, dir: cwd }]
  let current = cwd
  for (let i = 0; i < upMax; i++) {
    const parent = dirname(current)
    if (parent === current) break
    dirs.push({ depth: i + 1, dir: parent })
    current = parent
  }
  // 向下 1 层扫描子目录中是否有 project.godot
  try {
    const entries = readdirSync(cwd)
    for (const e of entries) {
      const sub = join(cwd, e)
      if (existsSync(sub) && existsSync(join(sub, 'project.godot'))) {
        dirs.push({ depth: -1, dir: sub })
      }
    }
  } catch { /* ignore */ }
  return dirs
}

/** @param {string} cwd @returns {string[]} */
function readdirLight(cwd) {
  try { return readdirSync(cwd) } catch { return [] }
}

/** @param {string} cwd @returns {Detection} */
export function detectAll(cwd) {
  const candidates = scanDirs(cwd, 3)
  let best = { engine: 'unknown', version: null, projectRoot: cwd, projectFile: null, evidence: [], score: 0 }

  for (const { dir } of candidates) {
    const r = tryDetectUnity(dir) || tryDetectUnreal(dir) || tryDetectGodot(dir)
    if (r && r.score > best.score) best = { ...r, projectRoot: dir }
  }

  const { score, ...detection } = best
  return detection
}

// ── Unity ──────────────────────────────────────────────────

function tryDetectUnity(dir) {
  const evidence = []
  let version = null
  let score = 0

  const pv = join(dir, 'ProjectSettings', 'ProjectVersion.txt')
  if (existsSync(pv)) {
    try {
      const text = readFileSync(pv, 'utf-8')
      const m = text.match(/m_EditorVersion:\s*(\S+)/)
      if (m) version = m[1]
    } catch { /* ignore */ }
    evidence.push(`ProjectSettings/ProjectVersion.txt (v${version || '?'})`)
    score += 10
  }

  if (existsSync(join(dir, 'Assets')) && existsSync(join(dir, 'Packages', 'manifest.json'))) {
    evidence.push('Assets/ + Packages/manifest.json')
    score += 10
  }

  if (score === 0) {
    if (hasExt(dir, '.unity')) { evidence.push('*.unity files'); score += 2 }
    if (hasExt(dir, '.asmdef')) { evidence.push('*.asmdef'); score += 2 }
    if (existsSync(join(dir, 'Library'))) { evidence.push('Library/'); score += 2 }
  }

  return score === 0 ? null : { engine: 'unity', version, projectFile: null, evidence, score }
}

// ── Unreal ─────────────────────────────────────────────────

function tryDetectUnreal(dir) {
  const evidence = []
  let version = null
  let projectFile = null
  let score = 0

  try {
    const files = readdirLight(dir)
    for (const f of files) {
      if (f.endsWith('.uproject')) {
        projectFile = f
        try {
          const json = JSON.parse(readFileSync(join(dir, f), 'utf-8'))
          version = json.EngineAssociation || null
        } catch { /* ignore */ }
        evidence.push(`${f} (EngineAssociation: ${version || '?'})`)
        score += 10
        break
      }
    }
  } catch { /* ignore */ }

  if (score === 0) {
    if (existsSync(join(dir, 'Content'))) { evidence.push('Content/'); score += 2 }
    if (existsSync(join(dir, 'Config', 'DefaultEngine.ini'))) { evidence.push('Config/DefaultEngine.ini'); score += 2 }
    if (existsSync(join(dir, 'Source'))) { evidence.push('Source/'); score += 2 }
  }

  return score === 0 ? null : { engine: 'unreal', version, projectFile, evidence, score }
}

// ── Godot ──────────────────────────────────────────────────

function tryDetectGodot(dir) {
  const evidence = []
  let version = null
  let score = 0

  const pg = join(dir, 'project.godot')
  if (existsSync(pg)) {
    try {
      const text = readFileSync(pg, 'utf-8')
      const m = text.match(/config_version\s*=\s*(\d+)/)
      if (m) {
        const cv = parseInt(m[1], 10)
        version = cv >= 5 ? '4.x' : '3.x'
      }
      const f = text.match(/features\s*=\s*\[(.+?)\]/)
      if (f) {
        const vm = f[1].match(/"(\d+\.\d+)"/)
        if (vm) version = vm[1]
      }
    } catch { /* ignore */ }
    evidence.push(`project.godot (v${version || '?'})`)
    score += 10
  }

  if (score === 0) {
    if (hasExt(dir, '.gd')) { evidence.push('*.gd files'); score += 2 }
    if (hasExt(dir, '.tscn')) { evidence.push('*.tscn files'); score += 2 }
    if (existsSync(join(dir, '.godot'))) { evidence.push('.godot/'); score += 2 }
  }

  return score === 0 ? null : { engine: 'godot', version, projectFile: 'project.godot', evidence, score }
}

// ── helpers ────────────────────────────────────────────────

function hasExt(dir, ext) {
  try { return readdirLight(dir).some(f => f.endsWith(ext)) } catch { return false }
}

/** 解析 Godot 构建日志为 digest */
export function parseGodotLog(raw) {
  const errors = []
  const warnings = []
  for (const line of raw.split('\n')) {
    if (line.includes('ERROR') || line.includes('error:')) {
      const m = line.match(/(?:ERROR\s+)?(.+?\.(?:gd|tscn)):(\d+)/)
      errors.push({ file: m?.[1] || null, line: m ? parseInt(m[2], 10) : null, message: line.slice(0, 200) })
    } else if (line.includes('WARNING') || line.includes('warning:')) {
      warnings.push({ message: line.slice(0, 200) })
    }
  }
  return { errors, warnings, summary: `${errors.length} errors, ${warnings.length} warnings` }
}

/**
 * 运行引擎命令，返回 StepResult。
 * @param {string} cmd
 * @param {string} cwd
 * @param {Object} [opts]
 * @param {number} [opts.timeoutMs]
 * @param {AbortSignal} [opts.signal]
 * @returns {Promise<StepResult>}
 */
export async function runEngineCommand(cmd, cwd, opts = {}) {
  const start = Date.now()
  const logDir = join(cwd, '.dsh', 'game-studio', 'logs')
  mkdirSync(logDir, { recursive: true })
  const logPath = join(logDir, `${Date.now()}-${Math.random().toString(36).slice(2, 8)}.log`)

  const result = await new Promise(resolve => {
    let stdout = ''
    let stderr = ''
    let settled = false
    if (opts.signal?.aborted) {
      resolve({ exitCode: 130, stdout, stderr: 'Cancelled by caller before start.' })
      return
    }
    const child = spawn(cmd, { cwd, shell: true, detached: true, stdio: ['ignore', 'pipe', 'pipe'] })
    const stop = () => {
      try { process.kill(-child.pid, 'SIGTERM') } catch { child.kill('SIGTERM') }
    }
    const finish = (exitCode, extra = '') => {
      if (settled) return
      settled = true
      clearTimeout(timeout)
      opts.signal?.removeEventListener('abort', abort)
      resolve({ exitCode, stdout, stderr: stderr + extra })
    }
    const abort = () => {
      stop()
      finish(130, '\nCancelled by caller.')
    }
    const timeout = setTimeout(() => {
      stop()
      finish(124, `\nTimed out after ${opts.timeoutMs ?? 300_000}ms.`)
    }, opts.timeoutMs ?? 300_000)
    opts.signal?.addEventListener('abort', abort, { once: true })
    child.stdout.on('data', chunk => { stdout += String(chunk) })
    child.stderr.on('data', chunk => { stderr += String(chunk) })
    child.on('error', err => finish(1, `\n${err.message}`))
    child.on('close', code => finish(code ?? 1))
  })

  const fullLog = `${cmd}\n\nSTDOUT:\n${result.stdout}\n\nSTDERR:\n${result.stderr}`
  writeFileSync(logPath, fullLog, 'utf-8')
  return { ok: result.exitCode === 0, exitCode: result.exitCode, durationMs: Date.now() - start, logPath, digest: parseGodotLog(fullLog), artifacts: [] }
}