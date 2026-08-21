# 01 — 总体架构

> 前置阅读：[00 DSH 集成契约](00-dsh-integration-contract.md)。本文档所有机制引用以 00 为准。

## 1. 定位

**DSH Game Studio 不是 prompt 模板包，是运行时。**
原项目（claude-code-game-studios）交付的是 Studio Knowledge Layer（角色、SOP、规则、模板）；
本插件在 DSH 上补齐它缺的执行层：路由、状态、引擎工具链、独立验证、模型分层。

```
                       USER
                         │
              /game <sub> │ 自然语言
                         ▼
                ┌─────────────────┐
                │  Orchestrator   │  ← 插件内确定性代码 + 模型工具面
                └────────┬────────┘
                         │
                ┌────────▼────────┐
                │ Workflow Router │  ← 意图分类 → 工作流选择 → Agent 选配
                └────────┬────────┘
                         │
       ┌─────────────────┼────────────────┐
       ▼                 ▼                ▼
   DESIGN             DEVELOP            QA        ← ctx.subagents 按需 spawn
       └─────────────────┼────────────────┘
                         ▼
                  Engine Adapter          ← detect/build/test/run/logs
                         │
          ┌──────────────┼──────────────┐
          ▼              ▼              ▼
        Tests         Game Logs      Visual QA
          └──────────────┼──────────────┘
                         ▼
              Independent Verifier       ← persona=verifier 的 subagent
                         │
                   Quality Gate           ← 确定性 PASS/FAIL
                         │
                    Git Commit
                         │
                 Persistent State         ← .dsh/game-studio/
```

## 2. 五个正交概念（解耦总纲）

| 概念 | 是什么 | 落在哪 |
|---|---|---|
| **Agent = WHO** | 角色：persona 文本 + 能力元数据 | `assets/agents/*.md` + registry 索引（03） |
| **Skill = HOW** | 工作流 SOP | `assets/skills/*/SKILL.md` + `ctx.skills` provider（04） |
| **Tool = WITH WHAT** | 确定性能力 | `ctx.tools` 注册的插件工具 + 引擎适配器（05） |
| **Rule = CONSTRAINT** | 路径/领域约束 | `assets/rules/*.md`，按触碰文件注入（08） |
| **Gate = PASS/FAIL** | 质量门 | 确定性检查 + Verifier 裁决（07） |

**硬规则：任何一层不得内联另一层的内容。** Agent persona 里不写 SOP 全文，SOL 由
Orchestrator 在派发时把选中的 skill 内容拼进 subagent prompt；规则按文件路径命中后注入。

## 3. 插件模块划分

单 npm 包、单 Cordis 插件入口，内部按目录分模块（不拆多插件，降低安装复杂度）：

```
dsh-game-studio/
├── package.json              # dsh.bundle 清单（00 §3.1）
├── cordis.patch.yml          # 安装补丁（00 §3.2）
├── lib/index.js              # 插件入口：apply(ctx, config)
├── src/
│   ├── config.js             # schemastery Config schema
│   ├── commands/             # /game 子命令分发（02）
│   ├── orchestrator/         # 意图→工作流→agent 选配（本文 §5）
│   ├── registry/
│   │   ├── agents.js         # Agent Registry 加载器（03）
│   │   └── skills.js         # ctx.skills provider（04）
│   ├── engines/              # 引擎适配器：unity.js / unreal.js / godot.js + detect.js（05）
│   ├── state/                # 持久化状态读写（06）
│   ├── verify/               # Verifier 派发 + Gate 引擎（07）
│   ├── hooks/                # 事件监听器（08）
│   ├── runtime.js            # 共享运行时辅助（resolveAgentCwd, toolFilter 预设）
│   ├── git.js                # 确定性 Git 操作（Commit Gate 用）
│   └── tool-args.js          # 工具参数运行时校验
├── assets/                   # ← 资源池，09 号文档迁移产物（纯数据，无代码）
│   ├── agents/               # 49 个（清洗后）
│   ├── skills/               # 73 个（清洗后）
│   ├── rules/                # 11 个
│   ├── templates/            # 40+ 个
│   └── manifest.json         # 全量索引（id/分类/引擎标签/模型层级建议）
├── lib/                      # 构建产物（V0.1 允许 src 即 lib，纯 ESM 免构建）
├── test/                     # node --test（仿 image-text-bridge）
└── docs/design/              # 本套文档
```

**语言决策：纯 ESM JavaScript + JSDoc 类型注释**（跟随 `dsh-image-text-bridge` 先例）。
理由：免构建步骤、`node --check` + `node --test` 即 CI、对 DSH 的 pre-release API 用
JSDoc 松耦合而不是 TS 编译期硬绑定。DSH 包一律 peerDependencies。

## 4. 动态 Agent Pool（49 不删，绝不同载）

Registry 分层（详见 03）：

```
Agent Registry
 ├─ Core:        producer, creative-director, technical-director
 ├─ Programming: gameplay, engine, ai, network, ui, tools
 ├─ Design:      game/systems/level/economy/ux…
 ├─ Art / Audio / Narrative / QA / Release / Ops
 └─ Engine:      godot-*(5), unity-*(5), ue-*(5)
```

**每次任务的运行时选配（上限 6）**：

```
1 × Orchestrator（宿主 agent 本体，不额外 spawn）
1 × Lead（按任务域选：technical-director / lead-programmer / qa-lead…）
1..3 × Specialist（按引擎 + 子系统选）
1 × Verifier（独立，见 07）
```

其余 40+ 个 agent：不加载、不进上下文、不耗 token。选配算法与元数据见 03 号文档。

## 5. Orchestrator 与 Router

Orchestrator 是**确定性代码优先、模型兜底**的两段式：

1. **确定性段（零 token）**：`/game <sub>` 命令 → 直接映射工作流；引擎检测、状态读取、
   分支/checkpoint 都是纯代码。
2. **模型段**：自然语言目标 → 宿主 agent 通过插件注册的工具面完成分类与选配：
   - `game_studio_status`（读状态）→ `game_studio_route`（提交分类结果：category /
     subsystem / engine / workflow / agents）→ `game_studio_dispatch`（派发 subagent）。
   - Router 的分类不靠自由发挥：`game_studio_route` 的参数 schema 用 enum 枚举合法的
     category（feature/bug/design/test/perf/release…）、subsystem（movement/animation/
     rendering/netcode/ui/audio…）与 workflow id，模型只能在合法集合内选择。

示例：「人物跑步卡顿」→ `{ category: bug, subsystem: animation, engine: ue5 }` →
workflow `debug` → agents `[unreal-specialist, performance-analyst]` + verifier。

## 6. Game Dev Loop（内建工作流骨架）

```
DESIGN → PROTOTYPE → IMPLEMENT → BUILD → PLAYTEST → ANALYZE → TUNE → REGRESSION
```

- 每个阶段 = 一个 skill 序列 + 一个 gate。编译通过 ≠ 好玩：`PLAYTEST` 阶段由引擎适配器
  headless 跑游戏收集 FPS / 日志 / 截图（05），`ANALYZE` 交给 Verifier 读指标（07）。
- 多轮推进复用 DSH 的 `ctx.goals` 轮次驱动（00 §10），不自造循环器。
- V0.1 只实现 IMPLEMENT→BUILD→TEST→VERIFY→GATE→COMMIT 主干；PLAYTEST/Visual QA 是
  V0.2 的第一优先级（依赖引擎 headless 运行 + 截图 → 本机已有视觉桥可读图）。

## 7. Review Mode（三档，继承并改名）

| 模式 | 链路 | 适用 |
|---|---|---|
| `solo` | Coder → Test | 快速 prototype |
| `lean`（默认） | Coder → Test → Verifier | 日常 feature/bug |
| `studio`（原 full） | Lead → Specialist → Test → Verifier → Director Gate | 核心系统 / Release |

存储：`.dsh/game-studio/state/review-mode`（06）；切换：`/game mode <solo|lean|studio>`。

## 8. 模型分层（全部可配，不硬编码）

插件 Config（schemastery，出现在 Web 设置页）：

```yaml
models:
  orchestrator: null       # null = 跟随宿主 agent 当前模型
  lead:        { provider: null, model: null }   # Tier S 建议位
  specialist:  { provider: null, model: null }   # Tier A
  verifier:    { provider: null, model: null }   # 独立裁判，建议 ≠ specialist
  utility:     { provider: null, model: null }   # Tier B：日志解析、格式化
```

派发 subagent 时按角色层级取配置传入（DSH 的 provider/model 覆盖机制见 00 §10）。
默认全 null（跟随宿主），保证零配置可用；分层是优化不是前提。

## 9. Focus Contract（ADHD 约束）

每次 `game_studio_dispatch` 派发 subagent 的 prompt 必须以合同开头（生成自任务状态，06）：

```
GOAL:   修复角色跳跃偶发双跳
SCOPE:  src/gameplay/movement/**        ← 越界写文件由 hooks 拦（08）
INPUT:  bug report + logs
OUTPUT: minimal patch
DONE:   tests pass, no regression
禁止：顺手重构 / 升级依赖 / 改 UI / 引入新模式
```

配合 `toolFilter`（00 §6）收窄子 agent 工具面 + `outputSchema` 强制结构化交付。
One Agent = One Bounded Task。

## 10. Git 工作流

- 每任务开工：`game/<type>/<slug>` 分支或 checkpoint commit（引擎大仓可配为 checkpoint-only）。
- Verifier FAIL → 不进 commit gate，回修（最多 N 轮，N 可配，默认 2）；
  超轮 → 状态记 blocked，向用户汇报。
- 大任务每阶段 checkpoint。Agent 发疯 → `git reset` 即回滚。
- 实现约束：git 操作走插件工具（确定性代码），不让子 agent 自由执行 push；
  `validate-commit`/`validate-push` 逻辑迁移为 gate 检查项（08、09）。
