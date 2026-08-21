#!/usr/bin/env node
/**
 * M1 资源迁移脚本 — dsh-game-studio
 *
 * 从固定路径 /tmp/ccgs-source 读取上游 Claude Code Game Studio 资源，
 * 按 scripts/migration-rules.json（单一事实源）清洗后输出到 assets/：
 *
 *   assets/agents/            清洗后的 agent 正文（frontmatter 已清洗）
 *   assets/skills/<id>/SKILL.md
 *   assets/rules/             压缩到 ≤maxLines 行
 *   assets/templates/         模板（已做替换清洗 + maxLines 截断）
 *   assets/manifest.json      agents + skills + rules 完整索引
 *   assets/UPSTREAM-LICENSE   上游 MIT 许可副本
 *
 * 另写入 scripts/migrate-report.md 人工复核清单。
 *
 * 纯 ESM，无外部依赖，可重跑（先清空 assets/ 再写）。
 */

import fs from 'node:fs';
import path from 'node:path';
import { execSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const SCRIPT_DIR = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.dirname(SCRIPT_DIR);
const SOURCE = '/tmp/ccgs-source';
const ASSETS = path.join(ROOT, 'assets');
const RULES_PATH = path.join(SCRIPT_DIR, 'migration-rules.json');

/** @type {any} 清洗规则（单一事实源） */
const RULES = JSON.parse(fs.readFileSync(RULES_PATH, 'utf8'));

/** 人工复核清单条目 @type {string[]} */
const reviewItems = [];

// ---------------------------------------------------------------------------
// 通用工具
// ---------------------------------------------------------------------------

/**
 * 应用替换规则数组。pattern 为正则字符串（JSON 中已转义），
 * replacement 为 null 时表示删除匹配内容。
 * @param {string} text
 * @param {{pattern: string, replacement: string | null}[]} replacements
 * @returns {string}
 */
function applyReplacements(text, replacements) {
  let out = text;
  for (const { pattern, replacement } of replacements) {
    out = out.replace(new RegExp(pattern, 'g'), replacement ?? '');
  }
  return out;
}

/**
 * 简单 YAML frontmatter 行解析（不引入外部依赖）。
 * 顶层 `key: value` / `key: [a, b]` 开启一个条目；缩进行、列表行、
 * 注释行归属于上一个条目（作为原始续行保留）。
 * @param {string} text
 * @returns {{entries: {key: string, value: string, rawLines: string[]}[], body: string, hadFrontmatter: boolean}}
 */
function parseFrontmatter(text) {
  const normalized = text.replace(/\r\n/g, '\n');
  if (!normalized.startsWith('---\n')) {
    return { entries: [], body: normalized, hadFrontmatter: false };
  }
  const rest = normalized.slice(4);
  const endIdx = rest.indexOf('\n---');
  if (endIdx === -1) {
    return { entries: [], body: normalized, hadFrontmatter: false };
  }
  const fmBlock = rest.slice(0, endIdx);
  let body = rest.slice(endIdx + 4); // 跳过 "\n---"
  if (body.startsWith('\n')) body = body.slice(1);

  /** @type {{key: string, value: string, rawLines: string[]}[]} */
  const entries = [];
  let current = null;
  for (const line of fmBlock.split('\n')) {
    const m = /^([A-Za-z][\w-]*):(.*)$/.exec(line);
    if (m) {
      current = { key: m[1], value: m[2].trim(), rawLines: [line] };
      entries.push(current);
    } else if (current && (/^[\s]/.test(line) || line.startsWith('-'))) {
      current.rawLines.push(line);
      if (line.trim()) current.value += (current.value ? ' ' : '') + line.trim();
    }
    // 其余（空行 / 顶层注释）丢弃
  }
  return { entries, body, hadFrontmatter: true };
}

/**
 * 依据 keep/remove/add 规则重建 frontmatter 文本。
 * 未出现在 keep 与 remove 中的未知字段一律丢弃并记录到复核清单。
 * @param {{key: string, value: string, rawLines: string[]}[]} entries
 * @param {string[]} keep
 * @param {string[]} remove
 * @param {Record<string, unknown>} add
 * @param {{pattern: string, replacement: string | null}[]} replacements
 * @param {string} label 复核清单中的文件标识
 * @returns {string}
 */
function rebuildFrontmatter(entries, keep, remove, add, replacements, label) {
  const lines = ['---'];
  for (const entry of entries) {
    if (keep.includes(entry.key)) {
      for (const raw of entry.rawLines) {
        lines.push(applyReplacements(raw, replacements));
      }
    } else if (!remove.includes(entry.key)) {
      reviewItems.push(
        `frontmatter 未知字段被丢弃：${label} → \`${entry.key}\`（不在 keep/remove 清单中）`,
      );
    }
  }
  for (const [key, value] of Object.entries(add ?? {})) {
    lines.push(`${key}: ${JSON.stringify(value)}`.replace(/^(\S+: )"(.*)"$/, '$1"$2"'));
  }
  lines.push('---');
  return lines.join('\n');
}

/**
 * 从 frontmatter 条目中提取 description 值（去掉包裹引号），截取前 n 字符。
 * @param {{key: string, value: string}[]} entries
 * @param {number} n
 * @returns {string}
 */
function summaryFrom(entries, n = 80) {
  const entry = entries.find((e) => e.key === 'description');
  if (!entry) return '';
  let v = entry.value.trim();
  if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) {
    v = v.slice(1, -1);
  }
  return v.slice(0, n);
}

/**
 * 截断到 maxLines 行（含截断标记行），未超限则原样返回。
 * @param {string} text
 * @param {number} maxLines
 * @param {string} label
 * @returns {string}
 */
function truncateLines(text, maxLines, label) {
  const lines = text.replace(/\s+$/, '').split('\n');
  if (lines.length <= maxLines) return `${lines.join('\n')}\n`;
  const kept = lines.slice(0, maxLines - 1);
  kept.push(`<!-- 迁移时截断至 ${maxLines} 行，完整内容见上游源 -->`);
  reviewItems.push(`截断：${label} 由 ${lines.length} 行压缩到 ${maxLines} 行，请人工复核信息损失`);
  return `${kept.join('\n')}\n`;
}

/**
 * @param {string} filePath
 * @param {string} content
 */
function writeFile(filePath, content) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, content, 'utf8');
}

/**
 * 名称匹配助手：对易误伤的短词（ai/ui/ux/gas/engine）用连字符分词精确匹配，
 * 其余用子串匹配（如 tester 需命中 test）。
 * @param {string} name
 * @param {string} token
 * @returns {boolean}
 */
function nameHas(name, token) {
  const exactTokens = new Set(['ai', 'ui', 'ux', 'gas', 'engine']);
  if (exactTokens.has(token)) return name.split('-').includes(token);
  return name.includes(token);
}

// ---------------------------------------------------------------------------
// manifest 推导规则
// ---------------------------------------------------------------------------

const DIRECTOR_TIER = new Set(['producer', 'creative-director', 'technical-director']);
const LEAD_TIER = new Set([
  'lead-programmer', 'qa-lead', 'art-director', 'audio-director',
  'narrative-director', 'release-manager', 'localization-lead',
]);

/** @type {Record<string, string>} 精确文件名 → department */
const DEPARTMENT_MAP = {
  producer: 'core', 'creative-director': 'core', 'technical-director': 'core',
  'game-designer': 'design', 'systems-designer': 'design', 'level-designer': 'design',
  'economy-designer': 'design', 'ux-designer': 'design',
  'lead-programmer': 'programming', 'engine-programmer': 'programming',
  'gameplay-programmer': 'programming', 'ai-programmer': 'programming',
  'network-programmer': 'programming', 'tools-programmer': 'programming',
  'ui-programmer': 'programming',
  'art-director': 'art', 'technical-artist': 'art', 'world-builder': 'art',
  'audio-director': 'audio', 'sound-designer': 'audio',
  'narrative-director': 'narrative', writer: 'narrative',
  'qa-lead': 'qa', 'qa-tester': 'qa', 'performance-analyst': 'qa',
  'release-manager': 'release', 'devops-engineer': 'release', 'localization-lead': 'release',
  'community-manager': 'ops', 'live-ops-designer': 'ops', 'analytics-engineer': 'ops',
  'security-engineer': 'ops', 'accessibility-specialist': 'ops', prototyper: 'ops',
};

/**
 * @param {string} id agent 文件名（不含 .md）
 * @returns {string}
 */
function agentTier(id) {
  if (DIRECTOR_TIER.has(id)) return 'director';
  if (LEAD_TIER.has(id)) return 'lead';
  return 'specialist';
}

/**
 * @param {string} id
 * @returns {string}
 */
function agentDepartment(id) {
  if (DEPARTMENT_MAP[id]) return DEPARTMENT_MAP[id];
  if (id.includes('godot') || id.includes('unity') || id.includes('unreal') || id.includes('ue-')) {
    return 'engine';
  }
  reviewItems.push(`agent department 推导不确定：\`${id}\` 未命中任何映射，回退为 "ops"`);
  return 'ops';
}

/**
 * @param {string} id
 * @returns {string[]}
 */
function agentEngines(id) {
  if (id.includes('godot')) return ['godot'];
  if (id.includes('unreal') || id.includes('ue-')) return ['unreal'];
  if (id.includes('unity')) return ['unity'];
  return [];
}

/** 按序匹配的 subsystems 规则：[token, subsystem|null]，null 表示显式空数组 */
const SUBSYSTEM_RULES = /** @type {[string, string | null][]} */ ([
  ['gameplay', 'gameplay'], ['ai', 'ai'], ['network', 'netcode'], ['ui', 'ui'],
  ['shader', 'rendering'], ['engine', 'core'], ['tools', 'tools'],
  ['animation', 'animation'], ['rendering', 'rendering'], ['netcode', 'netcode'],
  ['level', 'level-design'], ['economy', 'economy'], ['ux', 'ux'],
  ['audio', 'audio'], ['sound', 'audio'], ['narrative', 'narrative'], ['writer', 'narrative'],
  ['test', 'testing'], ['security', 'security'], ['analytics', 'analytics'],
  ['accessibility', 'accessibility'], ['live-ops', 'live-ops'], ['community', 'community'],
  ['prototype', 'prototyping'], ['performance', 'performance'], ['localization', 'localization'],
  ['blueprint', 'blueprint'], ['gas', 'gas'], ['replication', 'replication'],
  ['umg', 'umg'], ['dots', 'dots'], ['addressables', 'addressables'],
  ['csharp', 'csharp'], ['gdextension', 'gdextension'], ['gdscript', 'gdscript'],
  ['specialist', null], ['director', null], ['lead', null],
  ['designer', 'game-design'],
]);

/**
 * @param {string} id
 * @returns {string[]}
 */
function agentSubsystems(id) {
  for (const [token, subsystem] of SUBSYSTEM_RULES) {
    if (nameHas(id, token)) return subsystem === null ? [] : [subsystem];
  }
  reviewItems.push(`agent subsystems 推导不确定：\`${id}\` 未命中任何规则，置为 []`);
  return [];
}

/**
 * @param {string} id
 * @param {string} tier
 * @returns {string}
 */
function agentToolProfile(id, tier) {
  if (id.includes('tester') || id.includes('analyst')) return 'analyst';
  if (tier === 'director' || tier === 'lead') return 'reviewer';
  if (id.includes('designer') || id.includes('writer')) return 'designer';
  return 'coder';
}

/**
 * @param {string} id skill 目录名
 * @returns {string}
 */
function skillCategory(id) {
  if (id === 'start' || id === 'help') return 'start';
  if (['design', 'brainstorm', 'map-systems', 'design-system', 'quick-design'].includes(id)) return 'design';
  if (id.startsWith('architecture-')) return 'architecture';
  if (id === 'adopt' || id === 'project-stage-detect') return 'meta';
  if (id === 'prototype') return 'prototype';
  if (id.startsWith('create-') || id === 'dev-story' || id.startsWith('story-')
    || id.startsWith('sprint-') || id === 'estimate') return 'develop';
  if (id === 'code-review') return 'review';
  if (id === 'QA' || id.startsWith('qa-') || id.startsWith('test-')
    || id.startsWith('regression') || id.startsWith('smoke') || id.startsWith('soak')) return 'test';
  if (id.startsWith('bug-')) return 'debug';
  if (id === 'balance-check') return 'develop';
  if (id.startsWith('perf-')) return 'perf';
  if (id.startsWith('release-') || id.startsWith('launch-') || id.startsWith('patch-') || id === 'hotfix') return 'release';
  if (id.startsWith('team-')) return 'team';
  if (id.startsWith('art-') || id.startsWith('asset-')) return 'art';
  if (id.startsWith('ux-')) return 'design';
  if (id === 'localize') return 'release';
  if (id === 'onboard' || id === 'retrospective') return 'meta';
  if (id === 'changelog') return 'release';
  reviewItems.push(`skill category 推导不确定：\`${id}\` 未命中显式规则，回退为 "meta"`);
  return 'meta';
}

/** @type {Record<string, string[]>} */
const CATEGORY_WORKFLOWS = {
  design: ['design'], develop: ['build', 'debug'], test: ['test'],
  review: ['review'], debug: ['debug'], release: ['ship'], team: ['build'],
};

/** @type {Record<string, string>} */
const CATEGORY_PHASE = {
  design: 'DESIGN', develop: 'IMPLEMENT', test: 'TEST',
  review: 'REVIEW', debug: 'IMPLEMENT', release: 'RELEASE',
};

/**
 * @param {string} id
 * @returns {string[]}
 */
function skillRoles(id) {
  if (id.includes('review') || id.includes('test')) return ['reviewer'];
  if (id.includes('design')) return ['designer'];
  return ['specialist'];
}

/** 按序匹配的 rule globs 规则 */
const RULE_GLOB_RULES = /** @type {[string, string[]][]} */ ([
  ['gameplay', ['**/*.gd', '**/*.cs', 'src/gameplay/**']],
  ['shader', ['**/*.gdshader', '**/*.shader', '**/*.hlsl']],
  ['ai', ['src/ai/**']],
  ['network', ['src/network/**']],
  ['ui', ['src/ui/**']],
  ['engine', ['src/engine/**']],
  ['data', ['**/*.json', '**/*.yaml', '**/*.yml']],
  ['design', ['design/**']],
  ['narrative', ['design/narrative/**']],
  ['test', ['**/*.test.*', '**/*.spec.*', 'tests/**']],
  ['prototype', ['prototypes/**']],
]);

/**
 * @param {string} id rule 文件名（不含 .md）
 * @returns {string[]}
 */
function ruleGlobs(id) {
  for (const [token, globs] of RULE_GLOB_RULES) {
    if (nameHas(id, token)) return globs;
  }
  reviewItems.push(`rule globs 推导不确定：\`${id}\` 未命中任何规则，置为 []`);
  return [];
}

// ---------------------------------------------------------------------------
// 迁移主流程
// ---------------------------------------------------------------------------

function main() {
  if (!fs.existsSync(SOURCE)) {
    console.error(`源目录不存在：${SOURCE}`);
    process.exit(1);
  }

  // 幂等：先清空 assets/ 再写
  fs.rmSync(ASSETS, { recursive: true, force: true });
  fs.mkdirSync(ASSETS, { recursive: true });

  // --- 1. agents -----------------------------------------------------------
  const agentsSrc = path.join(SOURCE, '.claude', 'agents');
  /** @type {any[]} */
  const agentEntries = [];
  for (const file of fs.readdirSync(agentsSrc).filter((f) => f.endsWith('.md')).sort()) {
    const id = file.replace(/\.md$/, '');
    const raw = fs.readFileSync(path.join(agentsSrc, file), 'utf8');
    const { entries, body } = parseFrontmatter(raw);
    const fm = rebuildFrontmatter(
      entries,
      RULES.agents.frontmatterKeep,
      RULES.agents.frontmatterRemove,
      RULES.agents.frontmatterMap ?? {},
      RULES.agents.personaReplacements,
      `agents/${id}.md`,
    );
    const cleanedBody = applyReplacements(body, RULES.agents.personaReplacements);
    writeFile(path.join(ASSETS, 'agents', `${id}.md`), `${fm}\n\n${cleanedBody.replace(/^\n+/, '')}`);

    const tier = agentTier(id);
    agentEntries.push({
      id,
      kind: 'agent',
      tier,
      department: agentDepartment(id),
      engines: agentEngines(id),
      subsystems: agentSubsystems(id),
      modelTier: tier === 'specialist' ? 'A' : 'S',
      toolProfile: agentToolProfile(id, tier),
      summary: applyReplacements(summaryFrom(entries), RULES.agents.personaReplacements).slice(0, 80),
      file: `agents/${id}.md`,
    });
  }

  // --- 2. skills ------------------------------------------------------------
  const skillsSrc = path.join(SOURCE, '.claude', 'skills');
  /** @type {any[]} */
  const skillEntries = [];
  for (const dir of fs.readdirSync(skillsSrc, { withFileTypes: true })
    .filter((d) => d.isDirectory()).map((d) => d.name).sort()) {
    const skillFile = path.join(skillsSrc, dir, 'SKILL.md');
    if (!fs.existsSync(skillFile)) {
      reviewItems.push(`skill 目录缺少 SKILL.md，已跳过：\`${dir}\``);
      continue;
    }
    const raw = fs.readFileSync(skillFile, 'utf8');
    const { entries, body } = parseFrontmatter(raw);
    const fm = rebuildFrontmatter(
      entries,
      RULES.skills.frontmatterKeep,
      RULES.skills.frontmatterRemove,
      RULES.skills.frontmatterAdd ?? {},
      RULES.skills.bodyReplacements,
      `skills/${dir}/SKILL.md`,
    );
    const cleanedBody = applyReplacements(body, RULES.skills.bodyReplacements);
    writeFile(path.join(ASSETS, 'skills', dir, 'SKILL.md'), `${fm}\n\n${cleanedBody.replace(/^\n+/, '')}`);

    const category = skillCategory(dir);
    skillEntries.push({
      id: dir,
      kind: 'skill',
      category,
      workflows: CATEGORY_WORKFLOWS[category] ?? [],
      phase: CATEGORY_PHASE[category] ?? 'DESIGN',
      roles: skillRoles(dir),
      summary: applyReplacements(summaryFrom(entries), RULES.skills.bodyReplacements).slice(0, 80),
      file: `skills/${dir}/SKILL.md`,
    });
  }

  // --- 3. rules ---------------------------------------------------------------
  const rulesSrc = path.join(SOURCE, '.claude', 'rules');
  /** @type {any[]} */
  const ruleEntries = [];
  for (const file of fs.readdirSync(rulesSrc).filter((f) => f.endsWith('.md')).sort()) {
    const id = file.replace(/\.md$/, '');
    const raw = fs.readFileSync(path.join(rulesSrc, file), 'utf8');
    // 剥离 frontmatter（paths 信息由 manifest.globs 承载），压缩到 maxLines
    const { body } = parseFrontmatter(raw);
    const cleaned = applyReplacements(body.replace(/^\n+/, ''), RULES.agents.personaReplacements);
    writeFile(
      path.join(ASSETS, 'rules', `${id}.md`),
      truncateLines(cleaned, RULES.rules.maxLines, `rules/${id}.md`),
    );
    ruleEntries.push({
      id,
      kind: 'rule',
      globs: ruleGlobs(id),
      file: `rules/${id}.md`,
    });
  }

  // --- 4. templates -----------------------------------------------------------
  // 注意：为满足清洗断言（assets/ 中不得出现 .claude/、AskUserQuestion、Claude Code），
  // 模板同样应用 personaReplacements，并按 templates.maxLines 截断；差异记入复核清单。
  const templatesSrc = path.join(SOURCE, '.claude', 'docs', 'templates');
  let templateCount = 0;
  /**
   * @param {string} srcDir
   * @param {string} relBase
   */
  const copyTemplates = (srcDir, relBase) => {
    for (const entry of fs.readdirSync(srcDir, { withFileTypes: true })) {
      const srcPath = path.join(srcDir, entry.name);
      const rel = relBase ? `${relBase}/${entry.name}` : entry.name;
      if (entry.isDirectory()) {
        copyTemplates(srcPath, rel);
      } else if (entry.name.endsWith('.md')) {
        const cleaned = applyReplacements(
          fs.readFileSync(srcPath, 'utf8'),
          RULES.agents.personaReplacements,
        );
        writeFile(
          path.join(ASSETS, 'templates', rel),
          truncateLines(cleaned, RULES.templates.maxLines, `templates/${rel}`),
        );
        templateCount += 1;
      } else {
        fs.mkdirSync(path.dirname(path.join(ASSETS, 'templates', rel)), { recursive: true });
        fs.copyFileSync(srcPath, path.join(ASSETS, 'templates', rel));
        templateCount += 1;
      }
    }
  };
  copyTemplates(templatesSrc, '');

  // --- 5. UPSTREAM-LICENSE ------------------------------------------------------
  fs.copyFileSync(path.join(SOURCE, 'LICENSE'), path.join(ASSETS, 'UPSTREAM-LICENSE'));

  // --- 6. manifest.json ----------------------------------------------------------
  let commit = 'unknown';
  try {
    commit = execSync('git rev-parse HEAD', { cwd: SOURCE, encoding: 'utf8' }).trim();
  } catch {
    reviewItems.push('无法读取源仓库 commit hash（源目录不是 git 仓库或 git 不可用）');
  }
  const generatedAt = new Date().toISOString();
  const manifest = {
    schemaVersion: 1,
    generatedAt,
    source: { path: SOURCE, commit },
    counts: {
      agents: agentEntries.length,
      skills: skillEntries.length,
      rules: ruleEntries.length,
      templates: templateCount,
    },
    agents: agentEntries,
    skills: skillEntries,
    rules: ruleEntries,
  };
  writeFile(path.join(ASSETS, 'manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`);

  // --- 7. 迁移报告 -----------------------------------------------------------------
  const report = [
    '# M1 资源迁移报告',
    '',
    `- 迁移时间：${generatedAt}`,
    `- 源目录：\`${SOURCE}\``,
    `- 源 commit：\`${commit}\``,
    `- 清洗规则：\`scripts/migration-rules.json\``,
    '',
    '## 数量统计',
    '',
    `| 类型 | 数量 |`,
    `| --- | --- |`,
    `| agents | ${agentEntries.length} |`,
    `| skills | ${skillEntries.length} |`,
    `| rules | ${ruleEntries.length} |`,
    `| templates | ${templateCount} |`,
    '',
    '## 迁移策略说明',
    '',
    '- agents/skills：frontmatter 仅保留 keep 清单字段，其余（含未列入 remove 的未知字段）一律丢弃并记录如下。',
    '- rules：剥离 frontmatter（`paths` 已并入 manifest 的 `globs`），正文压缩至 ≤40 行。',
    '- templates：为满足 assets/ 清洗断言（无 `.claude/`、`AskUserQuestion`、`Claude Code`），',
    '  模板并非逐字节复制，而是应用了与 agents 相同的替换规则，且超过 100 行的文件被截断。',
    '',
    '## 人工复核清单',
    '',
    ...(reviewItems.length
      ? [...new Set(reviewItems)].map((item) => `- [ ] ${item}`)
      : ['- （无待复核项）']),
    '',
  ].join('\n');
  writeFile(path.join(SCRIPT_DIR, 'migrate-report.md'), report);

  console.log(`迁移完成：agents=${agentEntries.length} skills=${skillEntries.length} rules=${ruleEntries.length} templates=${templateCount}`);
  console.log(`复核项：${new Set(reviewItems).size} 条，详见 scripts/migrate-report.md`);
}

main();
