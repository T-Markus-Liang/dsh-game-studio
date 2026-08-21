/**
 * M1 资源迁移验证测试 — dsh-game-studio
 *
 * 前置：先运行 `node scripts/migrate.mjs` 生成 assets/。
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const ASSETS = path.join(ROOT, 'assets');
const MANIFEST_PATH = path.join(ASSETS, 'manifest.json');

/** @type {any} */
const manifest = JSON.parse(fs.readFileSync(MANIFEST_PATH, 'utf8'));

test('manifest 中 agent 条目数 == 49', () => {
  assert.equal(manifest.agents.length, 49);
});

test('manifest 中 skill 条目数 == 73', () => {
  assert.equal(manifest.skills.length, 73);
});

test('manifest 中 rule 条目数 == 11', () => {
  assert.equal(manifest.rules.length, 11);
});

test('所有 agent file 存在', () => {
  for (const agent of manifest.agents) {
    assert.ok(
      fs.existsSync(path.join(ASSETS, agent.file)),
      `agent 文件缺失：${agent.file}`,
    );
  }
});

test('所有 skill file 存在', () => {
  for (const skill of manifest.skills) {
    assert.ok(
      fs.existsSync(path.join(ASSETS, skill.file)),
      `skill 文件缺失：${skill.file}`,
    );
  }
});

test('所有 rule file 存在', () => {
  for (const rule of manifest.rules) {
    assert.ok(
      fs.existsSync(path.join(ASSETS, rule.file)),
      `rule 文件缺失：${rule.file}`,
    );
  }
});

test('所有 agent.id 唯一', () => {
  const ids = manifest.agents.map((/** @type {any} */ a) => a.id);
  assert.equal(new Set(ids).size, ids.length, 'agent id 存在重复');
});

test('所有 skill.id 唯一', () => {
  const ids = manifest.skills.map((/** @type {any} */ s) => s.id);
  assert.equal(new Set(ids).size, ids.length, 'skill id 存在重复');
});

test('清洗断言：assets/ 中无文件包含 .claude/、AskUserQuestion、Claude Code', () => {
  const forbidden = ['.claude/', 'AskUserQuestion', 'Claude Code'];
  /** @type {string[]} */
  const offenders = [];

  /** @param {string} dir */
  const walk = (dir) => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        walk(full);
        continue;
      }
      const content = fs.readFileSync(full, 'utf8');
      for (const needle of forbidden) {
        if (content.includes(needle)) {
          offenders.push(`${path.relative(ASSETS, full)} 含 "${needle}"`);
        }
      }
    }
  };
  walk(ASSETS);

  assert.deepEqual(offenders, [], `清洗不彻底：\n${offenders.join('\n')}`);
});
