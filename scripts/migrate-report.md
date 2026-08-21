# M1 资源迁移报告

- 迁移时间：2026-08-21T16:46:23.835Z
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

## 迁移策略说明

- agents/skills：frontmatter 仅保留 keep 清单字段，其余（含未列入 remove 的未知字段）一律丢弃并记录如下。
- rules：剥离 frontmatter（`paths` 已并入 manifest 的 `globs`），正文压缩至 ≤40 行。
- templates：为满足 assets/ 清洗断言（无 `.claude/`、`AskUserQuestion`、`Claude Code`），
  模板并非逐字节复制，而是应用了与 agents 相同的替换规则，且超过 100 行的文件被截断。

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
- [ ] 截断：rules/data-files.md 由 41 行压缩到 40 行，请人工复核信息损失
- [ ] 截断：templates/accessibility-requirements.md 由 331 行压缩到 100 行，请人工复核信息损失
- [ ] 截断：templates/architecture-decision-record.md 由 176 行压缩到 100 行，请人工复核信息损失
- [ ] 截断：templates/architecture-doc-from-code.md 由 266 行压缩到 100 行，请人工复核信息损失
- [ ] 截断：templates/architecture-traceability.md 由 101 行压缩到 100 行，请人工复核信息损失
- [ ] 截断：templates/collaborative-protocols/design-agent-protocol.md 由 157 行压缩到 100 行，请人工复核信息损失
- [ ] 截断：templates/collaborative-protocols/implementation-agent-protocol.md 由 158 行压缩到 100 行，请人工复核信息损失
- [ ] 截断：templates/collaborative-protocols/leadership-agent-protocol.md 由 181 行压缩到 100 行，请人工复核信息损失
- [ ] 截断：templates/concept-doc-from-prototype.md 由 304 行压缩到 100 行，请人工复核信息损失
- [ ] 截断：templates/design-doc-from-implementation.md 由 204 行压缩到 100 行，请人工复核信息损失
- [ ] 截断：templates/difficulty-curve.md 由 330 行压缩到 100 行，请人工复核信息损失
- [ ] 截断：templates/economy-model.md 由 130 行压缩到 100 行，请人工复核信息损失
- [ ] 截断：templates/faction-design.md 由 166 行压缩到 100 行，请人工复核信息损失
- [ ] 截断：templates/game-concept.md 由 317 行压缩到 100 行，请人工复核信息损失
- [ ] 截断：templates/game-design-document.md 由 219 行压缩到 100 行，请人工复核信息损失
- [ ] 截断：templates/game-pillars.md 由 313 行压缩到 100 行，请人工复核信息损失
- [ ] 截断：templates/hud-design.md 由 505 行压缩到 100 行，请人工复核信息损失
- [ ] 截断：templates/incident-response.md 由 135 行压缩到 100 行，请人工复核信息损失
- [ ] 截断：templates/interaction-pattern-library.md 由 1072 行压缩到 100 行，请人工复核信息损失
- [ ] 截断：templates/level-design-document.md 由 111 行压缩到 100 行，请人工复核信息损失
- [ ] 截断：templates/narrative-character-sheet.md 由 111 行压缩到 100 行，请人工复核信息损失
- [ ] 截断：templates/pitch-document.md 由 140 行压缩到 100 行，请人工复核信息损失
- [ ] 截断：templates/player-journey.md 由 357 行压缩到 100 行，请人工复核信息损失
- [ ] 截断：templates/project-stage-report.md 由 199 行压缩到 100 行，请人工复核信息损失
- [ ] 截断：templates/prototype-report.md 由 114 行压缩到 100 行，请人工复核信息损失
- [ ] 截断：templates/release-checklist-template.md 由 125 行压缩到 100 行，请人工复核信息损失
- [ ] 截断：templates/release-notes.md 由 103 行压缩到 100 行，请人工复核信息损失
- [ ] 截断：templates/sound-bible.md 由 130 行压缩到 100 行，请人工复核信息损失
- [ ] 截断：templates/systems-index.md 由 146 行压缩到 100 行，请人工复核信息损失
- [ ] 截断：templates/test-plan.md 由 122 行压缩到 100 行，请人工复核信息损失
- [ ] 截断：templates/ux-spec.md 由 544 行压缩到 100 行，请人工复核信息损失
- [ ] 截断：templates/vertical-slice-report.md 由 169 行压缩到 100 行，请人工复核信息损失
