# DSH Game Studio

**AI-native Game Development Runtime for DeepSeek Harness**

把 DeepSeek Harness 变成一个 AI 游戏开发工作室：一个可安装、可卸载、可升级的 DSH 社区插件，
以 [claude-code-game-studios](https://github.com/donchitos/claude-code-game-studios) 已验证的
Studio Knowledge Layer（49 Agents / 73 Skills / 12 Hooks / 11 Rules / 40+ Templates）为资源池，
在其上补齐真正的 **Runtime + Routing + State + Engine Tooling + Verification + Model Routing**。

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

## 状态

**当前阶段：设计文档（供实现模型执行）。** 尚无可运行代码。
本仓库先交付一套完整、逐段可执行的设计文档，全部机制均已在
`/Users/markus/deepseek-harness` 的源码与文档中核实（见 [00 号文档](docs/design/00-dsh-integration-contract.md)），
不含臆测的 API。

## 设计文档索引（按阅读顺序）

| # | 文档 | 内容 |
|---|---|---|
| 00 | [DSH 集成契约](docs/design/00-dsh-integration-contract.md) | **实现前必读。** 已验证的 DSH 插件机制事实：打包、安装、命令、工具、subagent、skill、verifier、事件。所有其他文档只允许使用本文档列出的机制。 |
| 01 | [总体架构](docs/design/01-architecture.md) | 插件分层、动态 Agent Pool、Review Mode、模型分层、Game Dev Loop、Focus Contract |
| 02 | [命令与 UX](docs/design/02-command-ux.md) | `/game <subcommand>` 语法（DSH 不支持冒号命令名）、自然语言入口、模型可见工具面 |
| 03 | [Agent Registry](docs/design/03-agent-registry.md) | 49 个 agent 的元数据格式、分层、按需 spawn（persona + toolFilter + model override） |
| 04 | [Skill Registry](docs/design/04-skill-registry.md) | 73 个 skill 作为 internal capabilities：`ctx.skills` provider、目录 token 成本控制 |
| 05 | [Engine Adapters](docs/design/05-engine-adapters.md) | Unity / UE5 / Godot 的 detect / build / test / run / log-parse 声明式适配器 |
| 06 | [持久化状态](docs/design/06-persistent-state.md) | `.dsh/game-studio/` 状态目录、compaction 生存策略、Focus Contract 文件格式 |
| 07 | [Verifier 与质量门](docs/design/07-verifier-quality-gates.md) | 独立 Verifier subagent、`ctx.verifier` best-of-N（可选增强）、Gate → Git 工作流 |
| 08 | [Hooks 事件映射](docs/design/08-hooks-events.md) | 原项目 12 个 hook → DSH 事件总线的逐一映射 |
| 09 | [资源迁移方案](docs/design/09-asset-migration.md) | 49/73/12/11/40+ 资源从 `.claude/` 到本仓库 `assets/` 的迁移规则与清洗 |
| 10 | [V0.1 路线图与验收](docs/design/10-roadmap-v0.1.md) | 六件套范围、里程碑拆分、验收标准、测试计划、给实现模型的执行指令 |

## V0.1 六件套（克制原则）

1. DSH Plugin Loader（社区插件打包 + `dsh plugin add` / `link:` 安装）
2. Agent Registry（49 agent 元数据索引，运行时按需 spawn ≤6 个）
3. Skill Registry（73 skill 作为 internal capabilities）
4. Engine Detection（Unity / UE5 / Godot 确定性识别）
5. Persistent Task State（`.dsh/game-studio/`，跨 compaction / 跨 session）
6. Verifier + Quality Gate（独立裁判 + 确定性门禁 + Git checkpoint）

## 一级用户入口（只有一个命令）

```
/game start | design | prototype | build | debug | test | review | perf | ship | status | mode
```

以及自然语言：「帮我做一个第三人称机器人控制系统」→ Orchestrator 自动走
识别项目 → 判断引擎 → 拆解任务 → 派发 Agent → 开发 → 测试 → Verifier → 质量门 → Commit。

## 上游致谢

Studio Knowledge Layer 源自 [donchitos/claude-code-game-studios](https://github.com/donchitos/claude-code-game-studios)（MIT）。
本项目不是它的 "DeepSeek Edition"，而是把它的知识层装进一个真正的运行时。
