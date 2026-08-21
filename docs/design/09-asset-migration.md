# 09 — 资源迁移方案（Studio Knowledge Layer → assets/）

> 前置阅读：[03](03-agent-registry.md)、[04](04-skill-registry.md)、[08](08-hooks-events.md)。
> 源仓库：`https://github.com/donchitos/claude-code-game-studios`（MIT）。
> 已核实的源结构（浅克隆样本在 `/tmp/ccgs`，实现时重新克隆固定 commit）：

```
.claude/
├── agents/          49 个 *.md（YAML frontmatter + persona 正文）
├── skills/          73 个 <id>/SKILL.md
├── rules/           11 个 *.md（ai-code, data-files, design-docs, engine-code,
│                    gameplay-code, narrative, network-code, prototype-code,
│                    shader-code, test-standards, ui-code）
├── hooks/           12 个 *.sh（→ 08 号文档，不迁文件只迁逻辑）
├── docs/            工作流目录/协调地图/gate 定义/templates（40+ 模板）
├── settings.json / statusline.sh / agent-memory/   （不迁，Claude Code 专有）
design/ docs/ production/ src/                       （项目骨架，选择性参考）
```

## 1. 迁移原则

1. **保留内容，重组组织，不一开始就删。** 49/73/11/模板全量进 `assets/`；
   V0.1 运行时只直接引用其中一小部分（04 §5），其余作为目录可见的资源池。
2. **迁移是脚本，不是手工。** `scripts/migrate.mjs` 从固定 commit 的克隆读入 →
   清洗 → 写 `assets/` + 生成 `manifest.json`。可重跑、可 diff、上游更新可再同步。
3. **清洗规则显式化。** 所有替换规则住 `scripts/migration-rules.json`，CI 断言清洗后
   资产不含违禁模式（§5）。
4. **License 合规**：保留上游 MIT LICENSE 副本于 `assets/UPSTREAM-LICENSE`，README 致谢。

## 2. 清洗规则表（migration-rules.json 的语义）

| 模式（源） | 处理 |
|---|---|
| frontmatter `tools:` / `allowed-tools:` | 删除；按 03 §3 折算 `toolProfile` 进 manifest |
| frontmatter `model: opus/sonnet/haiku` | 删除；折算 `modelTier: S/A/B` 进 manifest |
| frontmatter `maxTurns` / `memory:` / `user-invocable` | 删除（skill 的 user-invocable 语义改由 provider 统一 false，04 §3） |
| 正文 `.claude/docs/...`、`.claude/skills/...` 路径 | 重写为插件资产相对引用或删除（引用目标未迁移时删除并记 TODO 注释） |
| `AskUserQuestion` 用法段 | 重写为「向用户提问（宿主 ask 机制）」的中性表述 |
| `production/session-state` 等原状态路径 | 重写为 `.dsh/game-studio/state/`（06） |
| Slash 命令引用 `/start`、`/dev-story` 等 | 重写为 `/game <sub>` 或 skill 名引用（02） |
| `CLAUDE.md` / `Claude Code` 字样 | 除致谢外重写为 DSH 中性表述 |
| Windows/CRLF、尾空格 | 归一化 LF |
| Agent 正文 > 300 行者 | 不截断，但在 manifest 标 `long: true`（派发时提示实现者审阅压缩空间） |

## 3. manifest.json 生成

- agents：49 条（03 §2 字段）。`department/engines/subsystems/tier/modelTier/toolProfile`
  由规则表 + 文件名/frontmatter 推导，**推导不确定的字段进人工复核清单**
  （`scripts/migrate-report.md` 输出，实现模型跑完脚本后逐条确认）。
- skills：73 条（04 §4 字段）。`category` 按原目录语义映射（start/design/…/team/meta）。
- rules：11 条 + `globs`。glob 初值按规则名推导（如 `shader-code` →
  `**/*.{shader,gdshader,hlsl,usf,ush}` 等），进复核清单。
- templates：40+ 个原样拷贝到 `assets/templates/`（低风险，仅路径重写），manifest 记
  `id/file/summary`。

## 4. 引擎专家的特殊处理

15 个引擎专家（godot-\*5、unity-\*5、ue-\*5 = 15）persona 保留全文；其 frontmatter 中的
引擎版本假设（Godot 4.x、UE5.x）写进 manifest `engines` + `summary`，供 05 检测结果
匹配版本时选配。

## 5. CI 断言（validate-skill-change.sh 的转生，08 §1）

`node --test test/assets.test.mjs`：
- 数量：agents=49、skills=73、rules=11、manifest 与磁盘一致。
- 违禁模式扫描：`.claude/`、`allowed-tools`、`AskUserQuestion`、`maxTurns`、
  `subagent_type`、`/game:`（冒号命令）在 assets/ 中零命中。
- 每个 manifest 条目：file 存在、enum 字段合法、summary ≤ 200 字符。
- WORKFLOWS 编排表（04 §5）引用的 skill id 全部存在。

## 6. 不迁移清单（明确弃置）

| 源 | 理由 |
|---|---|
| `hooks/*.sh` | 逻辑重写为原生监听器（08），shell 不进包 |
| `settings.json`、`statusline.sh`、`agent-memory/` | Claude Code 专有 |
| `CCGS Skill Testing Framework/` | 上游自测设施；本仓库有自己的 test/（价值高的用例思路可参考） |
| 顶层 `design/ docs/ src/ production/` 项目骨架 | 属于「示例游戏项目」而非插件；`/game start` 未来可选生成同构骨架（V0.2 评估） |
| `UPGRADING.md`、GitHub workflow | 上游运维文件 |
