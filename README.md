# DSH Game Studio

**AI-native Game Development Runtime for DeepSeek Harness**

把 DeepSeek Harness 变成一个 AI 游戏开发工作室：一个可安装、可卸载、可升级的 DSH 社区插件，
以 [claude-code-game-studios](https://github.com/donchitos/claude-code-game-studios) 已验证的
Studio Knowledge Layer（49 Agents / 73 Skills / 12 Hooks / 11 Rules / 40+ Templates）为资源池，
在其上补齐真正的 **Runtime + Routing + State + Engine Tooling + Verification**。

```
DeepSeek Harness
        │
        ▼
┌────────────────────────┐
│    DSH Game Studio     │
│       Plugin           │
├────────────────────────┤
│ Orchestrator           │
│ Agent Pool (dynamic)   │
│ Game Skills            │
│ Engine Adapters        │
│ Quality Gates          │
│ Hooks (event bus)      │
│ State / Memory         │
│ Verification           │
└───────────┬────────────┘
            │
   ┌────────┼────────┐
   ▼        ▼        ▼
 Unity     UE5      Godot
```

## 功能特性

### `/game` 子命令（用户层只有一个命令）

| 子命令 | 语义 | 版本 |
|---|---|---|
| `/game start` | 初始化 / 接管项目：检测引擎、建状态目录、引导对话 | V0.1 ✅ |
| `/game status` | 当前项目 / 任务 / 门禁状态（零 token，纯确定性） | V0.1 ✅ |
| `/game build <desc>` | 功能开发 workflow | V0.1 ✅ |
| `/game debug <desc>` | Bug 修复 workflow | V0.1 ✅ |
| `/game test [scope]` | 运行引擎测试 + 模型分析失败 | V0.1 ✅ |
| `/game review` | 综合 Review（按 review-mode 档位） | V0.1 ✅ |
| `/game mode <solo\|lean\|studio>` | 切换 Review Mode（纯确定性写状态） | V0.1 ✅ |
| `/game agents` / `/game skills` | 列出 registry（调试用） | V0.1 ✅ |
| `/game help` | 用法帮助（未知子命令同样返回帮助，不进模型） | V0.1 ✅ |
| `/game design` / `prototype` / `perf` / `ship` | 设计 / 原型 / 性能 / 发布 workflow | V0.2 计划中 |

### 模型工具面（6 个常驻工具）

| 工具 | 行为 |
|---|---|
| `game_studio_status` | 返回项目 / 引擎 / 任务 / 门禁状态 JSON |
| `game_studio_route` | 意图分类（category / subsystem / workflow 全 enum 收窄）→ 返回选配 plan：agents / skills / gates / Focus Contract 模板 |
| `game_studio_dispatch` | 组装 persona + skill + contract → 派发 subagent，返回结构化结果 |
| `game_studio_engine` | 引擎适配器统一入口：detect / build / test / run / logs（长任务走后台 job，返回摘要 + 日志文件指针） |
| `game_studio_gate` | 跑确定性门禁 + 可选 Verifier 裁决，返回 PASS / FAIL + 原因 |
| `game_studio_state` | 状态读写（白名单操作：read / update-task / log-decision / log-issue） |

### 核心机制

- **动态 Agent Pool**：49 角色元数据索引，每次任务按需选配 **≤6 个并发**（1 Orchestrator + 1 Lead + 1..3 Specialist + 1 Verifier），其余 40+ 不加载、不进上下文、不耗 token。
- **三档 Review Mode**：`solo`（Coder → Test）/ `lean`（默认，+Verifier）/ `studio`（Lead → Specialist → Test → Verifier → Director Gate）。
- **确定性质量门 + 独立 Verifier**：build-pass / tests-pass / scope-clean 等由代码判定；Verifier 是独立 persona 的 subagent（无 write 工具），FAIL 触发修复回路（默认最多 2 轮），全绿才进 commit gate。
- **Godot 引擎适配器**：V0.1 完整实现 detect / build / test（headless）；Unity / UE5 提供 detect + 适配器模板。
- **持久化任务状态**：`.dsh/game-studio/` 落盘，跨 compaction / 跨 session 恢复，`/game status` 随时可查。

## 安装

### 路径一：开发期 link 安装（当前推荐）

```bash
# 1. symlink 到 DSH profiles 的 node_modules
ln -s /Users/markus/deepseek-harness/local-plugins/dsh-game-studio \
      ~/.dsh/profiles/node_modules/dsh-game-studio

# 2. 在 ~/.dsh/profiles/web/cordis.patch.yml 加一行插件项
```

```yaml
- insert:
    - id: game-studio
      name: dsh-game-studio
```

保存即热重载，刷新 DSH Web 页面生效。

### 路径二：发布后安装

```bash
pnpm dsh plugin --profile web add "github:T-Markus-Liang/dsh-game-studio"
# 若已发布到 npm，可改用 npm 包名 spec
```

### 卸载

从目标 profile 补丁层（`cordis.patch.yml`）删掉对应行即可——Cordis effect 自动解除全部注册（命令、工具、skill 目录），无残留。

## 快速开始

在**游戏项目根目录**打开的 DSH 会话里：

```
/game start
```

插件确定性检测引擎（如 godot 4.x）、创建 `.dsh/game-studio/` 状态目录，并给出引导语。然后：

```
/game debug 玩家偶发双跳
```

背后发生的事：

1. 命令 handler 做确定性准备（读状态、生成 Focus Contract 骨架、写 `active-task.json`），把一条结构化任务卡 steer 进宿主模型；
2. 模型调 `game_studio_route` 提交分类（如 `{category: bug, subsystem: movement}`，只能在 enum 内选）→ 拿到选配 plan；
3. `game_studio_dispatch` 派发 specialist（persona + toolFilter + outputSchema）修代码；
4. `game_studio_engine` headless 跑 build / test，`game_studio_gate` 判定 PASS / FAIL，Verifier 独立裁决；
5. 全绿 → 自动 commit（消息含 gate 摘要），`/game status` 可查全程。

## 配置说明

`cordis.patch.yml` 中 `config` 块（schemastery schema，出现在 Web 设置页）：

| 字段 | 默认 | 说明 |
|---|---|---|
| `reviewMode` | `lean` | Review 档位：`solo` / `lean` / `studio` |
| `verify.maxRepairRounds` | `2` | Verifier FAIL 后的修复回路轮数上限，超轮记 blocked 并汇报 |
| `engines` | `{}` | 引擎适配器覆盖位（如可执行文件路径、版本钉死） |
| `models.orchestrator/lead/specialist/verifier/utility` | 全 `null` | 分层模型配置；`null` = 跟随宿主 agent 当前模型，零配置可用 |

## 状态目录

```
<project>/.dsh/game-studio/
├── state/           # project.json / review-mode / active-task.json / decisions.jsonl / issues.jsonl
├── verification/    # 每任务证据包：diff 摘要、测试输出、verifier 裁决 JSON
└── logs/            # 引擎 build/test 全量日志（建议 .gitignore）
```

写入全部经白名单操作、原子写（tmp + rename），JSONL 只追加。

## 架构一页图

```
/game <sub> │ 自然语言
     ▼
Orchestrator（确定性代码优先，模型兜底）
     ▼
Workflow Router（enum 收窄的意图分类 → 工作流 → Agent 选配）
     ▼
Subagents（≤6：Lead / Specialist / Verifier，按需 spawn）
     ▼
Engine Adapter（detect / build / test / run / logs）
     ▼
Quality Gate（确定性 PASS/FAIL）+ Independent Verifier
     ▼
Git Commit → Persistent State（.dsh/game-studio/）
```

五个正交概念互不内联：**Agent = WHO**（persona）、**Skill = HOW**（SOP）、**Tool = WITH WHAT**（确定性能力）、**Rule = CONSTRAINT**（路径约束）、**Gate = PASS/FAIL**（质量门）。

## 开发指南

```bash
node --test test/*.test.js      # 单元测试（node 内建 test runner，Node ≥ 22.13）
node scripts/migrate.mjs        # 从固定上游 commit 克隆 CCGS → 再生成 assets/ + manifest.json
```

- 纯 ESM JavaScript + JSDoc 类型注释，免构建；DSH 包一律 peerDependencies。
- `assets/` 是 `scripts/migrate.mjs` 的生成物，不要手改——改 `migration-rules.json` 后重新生成。
- CI 断言清单：`node --check` + `node --test` 全绿；migrate 产物断言（09 号文档 §5）；`npm pack --dry-run` 白名单校验（含 `lib/`、`assets/`、`cordis.patch.yml`，不含 `test/`、`.github/`）。

设计文档全套见 [`docs/design/`](docs/design/)（从 [00 DSH 集成契约](docs/design/00-dsh-integration-contract.md) 读起）。

## Roadmap

**V0.1 六件套 ✅**

1. DSH Plugin Loader（打包 + `dsh plugin add` / link 安装）
2. Agent Registry（49 角色索引，运行时按需 spawn ≤6）
3. Skill Registry（73 skill 作为 internal capabilities）
4. Engine Detection（Unity / UE5 / Godot 确定性识别；Godot build/test 完整）
5. Persistent Task State（跨 compaction / 跨 session）
6. Verifier + Quality Gate（独立裁判 + 确定性门禁 + Git checkpoint）

**V0.2 展望（计划中）**

- PLAYTEST 视觉 QA：引擎 headless run + 截图 → 视觉模型报告
- Unity / UE5 build + test 补全
- `/game design | prototype | perf | ship`
- Verifier best-of-N 深度集成、Director Gate 默认启用评估

## 致谢与许可

Studio Knowledge Layer 源自 [donchitos/claude-code-game-studios](https://github.com/donchitos/claude-code-game-studios)（MIT）。
本项目不是它的 "DeepSeek Edition"，而是把它的知识层装进一个真正的运行时。

本仓库以 [MIT License](LICENSE) 发布。
