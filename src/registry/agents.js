/**
 * @file Agent Registry 加载器 (03-agent-registry.md).
 * 读取 assets/manifest.json + assets/agents/*.md，提供索引与 persona 组装。
 */

import { readFileSync, existsSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const here = dirname(fileURLToPath(import.meta.url))
const assetsRoot = join(here, '..', '..', 'assets')

/** @returns {Object} manifest.json 内容 */
export function loadManifest() {
  try {
    return JSON.parse(readFileSync(join(assetsRoot, 'manifest.json'), 'utf-8'))
  } catch {
    return { agents: [], skills: [], rules: [] }
  }
}

/** @returns {Array} 全部 agent 条目 */
export function listAgents() {
  return loadManifest().agents || []
}

/**
 * 按 id 查找 agent。
 * @param {string} id
 * @returns {Object|null}
 */
export function getAgent(id) {
  return listAgents().find(a => a.id === id) || null
}

/**
 * 读取 agent 的 persona 正文（清洗后的 Markdown）。
 * @param {Object} agent
 * @returns {string|null}
 */
export function readPersona(agent) {
  const file = join(assetsRoot, agent.file)
  if (!existsSync(file)) return null
  return readFileSync(file, 'utf-8')
}

/**
 * 组装完整 persona：persona 正文 + Focus Contract + 命中的 rules。
 * @param {Object} agent
 * @param {Object} [opts]
 * @param {Object} [opts.contract]  — Focus Contract 字段
 * @param {string[]} [opts.ruleIds] — 命中的 rule id 列表
 * @returns {string}
 */
export function composePersona(agent, opts = {}) {
  const body = readPersona(agent) || `You are the ${agent.id} agent.`

  const parts = [body]

  if (opts.contract) {
    const c = opts.contract
    parts.push('',
      '## Focus Contract',
      `GOAL:   ${c.goal || '(未指定)'}`,
      `SCOPE:  ${(c.scope || []).join(', ') || '(未指定)'}`,
      `INPUT:  ${(c.input || []).join(', ') || '(未指定)'}`,
      `OUTPUT: ${c.output || 'minimal change'}`,
      `DONE:   ${(c.done || []).join(', ') || '(未指定)'}`,
      '禁止：顺手重构 / 升级依赖 / 改 UI / 引入新模式。')
  }

  if (opts.ruleIds?.length) {
    const rules = loadManifest().rules || []
    for (const rid of opts.ruleIds) {
      const rule = rules.find(r => r.id === rid)
      if (rule && existsSync(join(assetsRoot, rule.file))) {
        parts.push('', `## Rule: ${rid}`, readFileSync(join(assetsRoot, rule.file), 'utf-8').trim())
      }
    }
  }

  return parts.join('\n\n')
}

/**
 * 按 glob 匹配文件路径，返回命中的 rule id 列表。
 * @param {string[]} filePaths
 * @returns {string[]}
 */
export function rulesForFiles(filePaths) {
  const manifest = loadManifest()
  const rules = manifest.rules || []
  const hit = new Set()
  for (const r of rules) {
    for (const glob of r.globs || []) {
      for (const fp of filePaths) {
        if (matchGlob(fp, glob)) { hit.add(r.id); break }
      }
      if (hit.has(r.id)) break
    }
  }
  return [...hit]
}

/** 极简 glob 匹配（支持双星与单星） */
function matchGlob(filePath, pattern) {
  // 转义正则
  const escaped = pattern
    .replace(/[.+^${}()|[\]\\]/g, '\\$&')
    .replace(/\*\*/g, '\u0000')
    .replace(/\*/g, '[^/]*')
    .replace(/\u0000/g, '.*')
  const re = new RegExp(`^${escaped}$`)
  return re.test(filePath)
}