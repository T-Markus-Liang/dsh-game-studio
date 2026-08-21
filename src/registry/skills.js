/**
 * @file Skill Registry provider (04-skill-registry.md).
 * 通过 ctx.skills.registerProvider 注册插件自带 assets/skills/ 为技能源。
 * 全部 { modelInvocable: true, userInvocable: false }（用户层只有 /game）。
 *
 * 契约（packages/skill/skill/src/index.ts）：
 *   SkillProvider = { name, list(options): Promise<候选[]|观察>, get(candidate, options): Promise<definition> }
 *   SkillCandidate 需 name/description/invocation/source/provider/rank/locator
 *   SkillDefinition 需 ...summary + content（正文）
 */

import { readFileSync, existsSync, readdirSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const here = dirname(fileURLToPath(import.meta.url))
export const skillsRoot = join(here, '..', '..', 'assets', 'skills')

/** 列出全部 skill id（目录名） */
export function listSkillIds() {
  try {
    return readdirSync(skillsRoot, { withFileTypes: true })
      .filter(d => d.isDirectory())
      .map(d => d.name)
      .filter(name => existsSync(join(skillsRoot, name, 'SKILL.md')))
  } catch {
    return []
  }
}

/** 读取 skill 全文 */
export function readSkillFile(id) {
  const file = join(skillsRoot, id, 'SKILL.md')
  if (!existsSync(file)) return null
  return readFileSync(file, 'utf-8')
}

/** 读取 skill 的 frontmatter（极简解析） */
export function readSkillFrontmatter(id) {
  const text = readSkillFile(id)
  if (!text) return null
  return parseFrontmatter(text)
}

/** 读取 skill 正文（去掉 frontmatter） */
export function readSkillBody(id) {
  const text = readSkillFile(id)
  if (!text) return null
  const m = text.match(/^---\n([\s\S]*?)\n---\n?([\s\S]*)$/)
  return m ? m[2].trim() : text.trim()
}

/** 极简 YAML frontmatter 解析：key: value / key: "quoted" */
export function parseFrontmatter(text) {
  const m = text.match(/^---\n([\s\S]*?)\n---/)
  if (!m) return {}
  const out = {}
  for (const line of m[1].split('\n')) {
    const kv = line.match(/^([A-Za-z0-9_-]+):\s*(.*)$/)
    if (!kv) continue
    let value = kv[2].trim()
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1)
    }
    out[kv[1]] = value
  }
  return out
}

/**
 * 注册 skill provider（正确契约）。
 * @param {import('@deepseek-ai/cordis').Context} skillCtx
 * @returns {() => void} disposer
 */
export function registerSkillProvider(skillCtx) {
  return skillCtx.skills.registerProvider(() => {
    const provider = 'game-studio'
    return {
      name: provider,
      async list(options) {
        const ids = listSkillIds()
        return ids.map((id, index) => {
          const fm = readSkillFrontmatter(id) || {}
          return {
            name: id,
            description: fm.description || `DSH Game Studio skill: ${id}`,
            whenToUse: fm.whenToUse || '',
            invocation: { modelInvocable: !id.startsWith('team-'), userInvocable: false },
            source: 'plugin',
            provider,
            rank: 200,
            locator: id,
          }
        })
      },
      async get(candidate) {
        const id = String(candidate.locator)
        const fm = readSkillFrontmatter(id) || {}
        const body = readSkillBody(id)
        if (body === null) return undefined
        return {
          name: id,
          description: fm.description || '',
          whenToUse: fm.whenToUse || '',
          invocation: { modelInvocable: true, userInvocable: false },
          source: 'plugin',
          provider,
          content: body,
        }
      },
    }
  })
}