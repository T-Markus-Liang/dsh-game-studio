/**
 * @file Persistent task state (06-persistent-state.md).
 * 所有读写经白名单操作，原子写（tmp+rename），JSONL 只追加。
 */

import { readFileSync, writeFileSync, mkdirSync, existsSync, appendFileSync, renameSync, rmSync } from 'node:fs'
import { join, dirname } from 'node:path'

/** 状态根目录（游戏项目工作区内） */
export function stateRoot(cwd) {
  return join(cwd, '.dsh', 'game-studio')
}

/** 确保状态目录存在 */
function ensureDir(p) {
  if (!existsSync(p)) mkdirSync(p, { recursive: true })
}

/** 原子写 JSON（tmp → rename） */
function atomicWrite(file, data) {
  const tmp = file + '.tmp'
  writeFileSync(tmp, JSON.stringify(data, null, 2), 'utf-8')
  renameSync(tmp, file)
}

/** 原子写纯文本 */
function atomicWriteText(file, text) {
  const tmp = file + '.tmp'
  writeFileSync(tmp, text, 'utf-8')
  renameSync(tmp, file)
}

// ── project.json ──────────────────────────────────────────

/**
 * @typedef {Object} ProjectState
 * @property {string|null} engine
 * @property {string|null} version
 * @property {string|null} projectRoot
 * @property {string|null} projectFile
 * @property {string[]} evidence
 */

/**
 * @param {string} cwd
 * @returns {ProjectState}
 */
export function readProject(cwd) {
  const file = join(stateRoot(cwd), 'state', 'project.json')
  try {
    return JSON.parse(readFileSync(file, 'utf-8'))
  } catch { return { engine: null, version: null, projectRoot: null, projectFile: null, evidence: [] } }
}

/** @param {string} cwd @param {ProjectState} state */
export function writeProject(cwd, state) {
  const dir = join(stateRoot(cwd), 'state')
  ensureDir(dir)
  atomicWrite(join(dir, 'project.json'), state)
}

// ── review-mode ────────────────────────────────────────────

const MODES = ['solo', 'lean', 'studio']

/** @param {string} cwd @returns {'solo'|'lean'|'studio'} */
export function readReviewMode(cwd) {
  const file = join(stateRoot(cwd), 'state', 'review-mode')
  try {
    const text = readFileSync(file, 'utf-8').trim()
    if (MODES.includes(text)) return text
  } catch { /* fallthrough */ }
  return 'lean'
}

/** @param {string} cwd @param {'solo'|'lean'|'studio'} mode */
export function writeReviewMode(cwd, mode) {
  const dir = join(stateRoot(cwd), 'state')
  ensureDir(dir)
  atomicWriteText(join(dir, 'review-mode'), mode + '\n')
}

// ── active-task.json ───────────────────────────────────────

/**
 * @typedef {Object} ActiveTask
 * @property {string} id
 * @property {string} workflow
 * @property {string} phase
 * @property {Object} contract
 * @property {string} contract.goal
 * @property {string[]} contract.scope
 * @property {string[]} contract.input
 * @property {string} contract.output
 * @property {string[]} contract.done
 * @property {Object} engine
 * @property {Object} git
 * @property {Array} agents
 * @property {Object} gates
 * @property {string[]} completed
 * @property {string} next
 * @property {string} updatedAt
 */

/** @param {string} cwd @returns {ActiveTask|null} */
export function readActiveTask(cwd) {
  const file = join(stateRoot(cwd), 'state', 'active-task.json')
  try {
    return JSON.parse(readFileSync(file, 'utf-8'))
  } catch { return null }
}

/** @param {string} cwd @param {ActiveTask} task */
export function writeActiveTask(cwd, task) {
  const dir = join(stateRoot(cwd), 'state')
  ensureDir(dir)
  atomicWrite(join(dir, 'active-task.json'), { ...task, updatedAt: new Date().toISOString() })
}

/** @param {string} cwd */
export function clearActiveTask(cwd) {
  const dir = join(stateRoot(cwd), 'state')
  ensureDir(dir)
  const file = join(dir, 'active-task.json')
  try { rmSync(file, { force: true }) } catch { /* ignore */ }
}

/** Persist a terminal task record and remove it from the active slot. */
export function archiveActiveTask(cwd, task, data = {}) {
  if (!task?.id) throw new TypeError('archiveActiveTask requires a task id')
  logDecision(cwd, 'archive', { taskId: task.id, task, ...data })
  clearActiveTask(cwd)
}

// ── decisions.jsonl (追加型) ───────────────────────────────

/**
 * @param {string} cwd
 * @param {string} kind
 * @param {Object} data
 */
export function logDecision(cwd, kind, data) {
  const dir = join(stateRoot(cwd), 'state')
  ensureDir(dir)
  appendFileSync(join(dir, 'decisions.jsonl'), JSON.stringify({ kind, data, ts: new Date().toISOString() }) + '\n', 'utf-8')
}

// ── issues.jsonl (追加型) ──────────────────────────────────

/** @param {string} cwd @param {Object} issue */
export function logIssue(cwd, issue) {
  const dir = join(stateRoot(cwd), 'state')
  ensureDir(dir)
  appendFileSync(join(dir, 'issues.jsonl'), JSON.stringify({ ...issue, ts: new Date().toISOString() }) + '\n', 'utf-8')
}

// ── verification/ ──────────────────────────────────────────

/** @param {string} cwd @param {string} taskId @returns {string} */
export function verificationDir(cwd, taskId) {
  return join(stateRoot(cwd), 'verification', taskId)
}

// ── logs/ ──────────────────────────────────────────────────

/** @param {string} cwd @returns {string} */
export function logsDir(cwd) {
  const dir = join(stateRoot(cwd), 'logs')
  ensureDir(dir)
  return dir
}

/**
 * 白名单操作：只允许读/写上述结构化状态。
 * 用于 game_studio_state 工具校验。
 * @param {string} cwd
 * @param {'read'|'write-task'|'write-mode'|'log-decision'|'log-issue'} op
 * @param {Object} [data]
 * @returns {Object}
 */
export function whitelistOp(cwd, op, data) {
  switch (op) {
    case 'read':
      return {
        project: readProject(cwd),
        reviewMode: readReviewMode(cwd),
        activeTask: readActiveTask(cwd),
      }
    case 'write-task':
      if (!data) throw new Error('write-task requires data')
      writeActiveTask(cwd, data)
      return { ok: true }
    case 'write-mode':
      if (!data?.mode) throw new Error('write-mode requires data.mode')
      writeReviewMode(cwd, data.mode)
      return { ok: true }
    case 'log-decision':
      if (!data?.kind) throw new Error('log-decision requires data.kind')
      logDecision(cwd, data.kind, data.payload ?? {})
      return { ok: true }
    case 'log-issue':
      logIssue(cwd, data ?? {})
      return { ok: true }
    default:
      throw new Error(`Unknown op: ${op}`)
  }
}