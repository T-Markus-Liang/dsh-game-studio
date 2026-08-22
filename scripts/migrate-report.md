# M1 资源迁移报告

- 迁移时间：2026-08-22T01:15:40.251Z
- 源目录：`/tmp/ccgs-source`
- 源 commit：`984023ddac0d5e27624f2baacde6105e45de375f`
- 清洗规则：`scripts/migration-rules.json`

## 数量统计

| 类型 | 数量 |
| --- | --- |
| agents | 49 |
| skills | 73 |
| rules | 11 |
| templates | 40 |
| docs | 63 |

## 迁移策略说明

- agents/skills：frontmatter 仅保留 keep 清单字段，其余（含未列入 remove 的未知字段）一律丢弃并记录如下。
- skills：上游 frontmatter 的 `agent:` 字段从正文移除，但保留到 manifest 的 skill 条目 `agent` 字段。
- rules：剥离 frontmatter（`paths` 已并入 manifest 的 `globs`，globs 对齐上游 paths），正文全量迁移不截断。
- templates：为满足 assets/ 清洗断言（无 `.claude/`、`AskUserQuestion`、`Claude Code`），
  模板并非逐字节复制，而是应用了与 agents 相同的替换规则；全量迁移，不做行数截断。
- docs：上游 `.claude/docs/` 全量镜像到 `assets/docs/`（应用 docs 替换规则），修复正文引用断链。

## 人工复核清单

- [ ] frontmatter 未知字段被丢弃：agents/art-director.md → `disallowedTools`（不在 keep/remove 清单中）
- [ ] frontmatter 未知字段被丢弃：agents/audio-director.md → `disallowedTools`（不在 keep/remove 清单中）
- [ ] frontmatter 未知字段被丢弃：agents/community-manager.md → `disallowedTools`（不在 keep/remove 清单中）
- [ ] frontmatter 未知字段被丢弃：agents/creative-director.md → `disallowedTools`（不在 keep/remove 清单中）
- [ ] frontmatter 未知字段被丢弃：agents/creative-director.md → `skills`（不在 keep/remove 清单中）
- [ ] agent subsystems 推导不确定：`devops-engineer` 未命中任何规则，置为 []
- [ ] frontmatter 未知字段被丢弃：agents/economy-designer.md → `disallowedTools`（不在 keep/remove 清单中）
- [ ] frontmatter 未知字段被丢弃：agents/game-designer.md → `disallowedTools`（不在 keep/remove 清单中）
- [ ] frontmatter 未知字段被丢弃：agents/game-designer.md → `skills`（不在 keep/remove 清单中）
- [ ] frontmatter 未知字段被丢弃：agents/lead-programmer.md → `skills`（不在 keep/remove 清单中）
- [ ] frontmatter 未知字段被丢弃：agents/level-designer.md → `disallowedTools`（不在 keep/remove 清单中）
- [ ] frontmatter 未知字段被丢弃：agents/live-ops-designer.md → `disallowedTools`（不在 keep/remove 清单中）
- [ ] frontmatter 未知字段被丢弃：agents/narrative-director.md → `disallowedTools`（不在 keep/remove 清单中）
- [ ] frontmatter 未知字段被丢弃：agents/producer.md → `skills`（不在 keep/remove 清单中）
- [ ] agent subsystems 推导不确定：`producer` 未命中任何规则，置为 []
- [ ] frontmatter 未知字段被丢弃：agents/prototyper.md → `isolation`（不在 keep/remove 清单中）
- [ ] frontmatter 未知字段被丢弃：agents/qa-lead.md → `skills`（不在 keep/remove 清单中）
- [ ] frontmatter 未知字段被丢弃：agents/release-manager.md → `skills`（不在 keep/remove 清单中）
- [ ] agent subsystems 推导不确定：`release-manager` 未命中任何规则，置为 []
- [ ] frontmatter 未知字段被丢弃：agents/sound-designer.md → `disallowedTools`（不在 keep/remove 清单中）
- [ ] frontmatter 未知字段被丢弃：agents/systems-designer.md → `disallowedTools`（不在 keep/remove 清单中）
- [ ] agent subsystems 推导不确定：`technical-artist` 未命中任何规则，置为 []
- [ ] frontmatter 未知字段被丢弃：agents/ue-blueprint-specialist.md → `disallowedTools`（不在 keep/remove 清单中）
- [ ] frontmatter 未知字段被丢弃：agents/ux-designer.md → `disallowedTools`（不在 keep/remove 清单中）
- [ ] frontmatter 未知字段被丢弃：agents/world-builder.md → `disallowedTools`（不在 keep/remove 清单中）
- [ ] agent subsystems 推导不确定：`world-builder` 未命中任何规则，置为 []
- [ ] frontmatter 未知字段被丢弃：agents/writer.md → `disallowedTools`（不在 keep/remove 清单中）
- [ ] frontmatter 未知字段被丢弃：skills/changelog/SKILL.md → `context`（不在 keep/remove 清单中）
- [ ] skill category 推导不确定：`consistency-check` 未命中显式规则，回退为 "meta"
- [ ] skill category 推导不确定：`content-audit` 未命中显式规则，回退为 "meta"
- [ ] skill category 推导不确定：`day-one-patch` 未命中显式规则，回退为 "meta"
- [ ] skill category 推导不确定：`design-review` 未命中显式规则，回退为 "meta"
- [ ] skill category 推导不确定：`gate-check` 未命中显式规则，回退为 "meta"
- [ ] frontmatter 未知字段被丢弃：skills/help/SKILL.md → `context`（不在 keep/remove 清单中）
- [ ] skill category 推导不确定：`milestone-review` 未命中显式规则，回退为 "meta"
- [ ] skill category 推导不确定：`playtest-report` 未命中显式规则，回退为 "meta"
- [ ] skill category 推导不确定：`propagate-design-change` 未命中显式规则，回退为 "meta"
- [ ] frontmatter 未知字段被丢弃：skills/prototype/SKILL.md → `isolation`（不在 keep/remove 清单中）
- [ ] skill category 推导不确定：`reverse-document` 未命中显式规则，回退为 "meta"
- [ ] skill category 推导不确定：`review-all-gdds` 未命中显式规则，回退为 "meta"
- [ ] skill category 推导不确定：`scope-check` 未命中显式规则，回退为 "meta"
- [ ] skill category 推导不确定：`security-audit` 未命中显式规则，回退为 "meta"
- [ ] skill category 推导不确定：`setup-engine` 未命中显式规则，回退为 "meta"
- [ ] skill category 推导不确定：`skill-improve` 未命中显式规则，回退为 "meta"
- [ ] skill category 推导不确定：`skill-test` 未命中显式规则，回退为 "meta"
- [ ] frontmatter 未知字段被丢弃：skills/sprint-plan/SKILL.md → `context`（不在 keep/remove 清单中）
- [ ] skill category 推导不确定：`tech-debt` 未命中显式规则，回退为 "meta"
- [ ] frontmatter 未知字段被丢弃：skills/vertical-slice/SKILL.md → `isolation`（不在 keep/remove 清单中）
- [ ] skill category 推导不确定：`vertical-slice` 未命中显式规则，回退为 "meta"
