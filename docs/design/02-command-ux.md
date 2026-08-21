# 02 — 命令与 UX

> 前置阅读：[00 §4 斜杠命令](00-dsh-integration-contract.md)。
> 硬约束：DSH 命令名正则 `[a-z][a-z0-9_-]*`，**不支持冒号**。原方案的 `/game:start`
> 全系列改为 **单命令 `/game` + 子命令 rawInput**。

## 1. 用户层只暴露一个命令

```
/game <subcommand> [args…]
```

注册（伪代码，机制见 00 §4）：

```js
ctx.inject(['commands'], (commandCtx) => {
  commandCtx.commands.register({
    name: 'game',
    description: 'DSH Game Studio：AI 游戏开发工作室入口',
    input: { hint: 'start|design|prototype|build|debug|test|review|perf|ship|status|mode …', images: false },
    handler: ({ agent, rawInput, signal }) => dispatchGameCommand(agent, rawInput, signal),
  })
})
```

## 2. 子命令表（V0.1 实现范围以 10 号文档为准）

| 子命令 | 语义 | 执行方式 | V0.1 |
|---|---|---|---|
| `/game start` | 初始化 / 接管项目：检测引擎、建状态目录、引导对话 | 确定性检测 + steer 一条引导消息进模型 | ✅ |
| `/game status` | 当前项目/任务/门禁状态 | 纯确定性读状态，零 token，直接返回 text | ✅ |
| `/game build <desc>` | 功能开发（feature workflow） | steer 模型走 Orchestrator 工具面 | ✅ |
| `/game debug <desc>` | Bug 修复 workflow | 同上 | ✅ |
| `/game test [scope]` | 运行测试 + QA workflow | 确定性跑引擎测试 + 模型分析失败 | ✅ |
| `/game review` | 综合 Review（按 review-mode 档位） | steer 模型 | ✅ |
| `/game mode <solo\|lean\|studio>` | 切换 Review Mode | 纯确定性写状态 | ✅ |
| `/game design <desc>` | 游戏设计 workflow | steer 模型 | V0.2 |
| `/game prototype <desc>` | 原型 workflow | steer 模型 | V0.2 |
| `/game perf` | 性能分析 workflow | 引擎 profile + 模型分析 | V0.2 |
| `/game ship` | 发布 workflow（release checklist + gate） | steer 模型 | V0.2 |
| `/game agents` / `/game skills` | 列出 registry（调试用） | 纯确定性 | ✅ |

分发器规则：
- 未知子命令 → `{ kind: 'error', text: 用法帮助 }`（不进模型）。
- 纯查询类（status/mode/agents/skills）**必须零 token**：handler 直接读状态返回 text。
- 工作流类（build/debug/…）：handler 先做确定性准备（检测引擎、读状态、生成 Focus
  Contract 骨架、写 active-task.json），然后 `agent.steer(createUserMessage({...}))` 把
  一条**结构化任务卡**交给宿主模型，由模型走 §4 的工具面执行。
- 全部 handler 尊重 `signal`（命令可中止）。

## 3. 结构化任务卡（steer 进模型的消息格式）

```
[game-studio task]
workflow: debug
engine: ue5 (5.4, detected)
review-mode: lean
state: .dsh/game-studio/state/active-task.json
goal: <用户原话>
下一步：调用 game_studio_route 提交分类，然后按返回的 plan 执行。
```

固定短格式：可缓存前缀友好、不复述 skill 全文（skill 由模型按需经 `skill` 工具加载）。

## 4. 模型可见工具面（`ctx.tools` 注册，六个）

| 工具 | 参数要点 | 行为 |
|---|---|---|
| `game_studio_status` | – | 返回项目/引擎/任务/门禁状态 JSON（读 06 状态目录） |
| `game_studio_route` | `category`/`subsystem`/`workflow` 全 enum；`engine` 自动填充 | 校验分类 → 返回选配 plan：agents[]（来自 03 选配算法）、skills[]、gates[]、focus contract 模板 |
| `game_studio_dispatch` | `role`（enum：lead/specialist/verifier）、`agentId`（registry 校验）、`task`（Focus Contract 字段） | 组装 persona+skill+contract → `ctx.subagents` 派发（00 §6），返回结构化结果 |
| `game_studio_engine` | `action`: detect/build/test/run/logs + 引擎特定参数 | 引擎适配器统一入口（05） |
| `game_studio_gate` | `gate`（enum）、`evidence`（结构化证据） | 跑确定性门禁 + 可选 Verifier 裁决（07），返回 PASS/FAIL+原因 |
| `game_studio_state` | `op`: read/update-task/log-decision/log-issue | 状态读写（06 的白名单操作，不是任意写文件） |

原则：
- **enum 一切可枚举的参数**——Router 的可靠性来自 schema 收窄，不来自 prompt 恳求。
- 工具描述精炼（每个 ≤ 3 句），六个工具常驻；skill 全文绝不进工具描述。
- 引擎命令（build/test）是长任务：`game_studio_engine` 内部走后台 job 模式，返回摘要
  + 日志文件路径，避免大输出灌上下文。

## 5. 自然语言入口

用户不打 `/game` 直接说「帮我做一个第三人称机器人控制系统」时：
- 插件通过 `ctx.systemPrompt.section()` 注入一小段常驻引导（≤10 行）：检测到游戏项目时，
  声明 game-studio 工具面存在 + 「游戏开发任务应先 `game_studio_status` → `game_studio_route`」。
- section 只在**引擎检测命中**的工作区注入（避免污染非游戏会话）；检测结果缓存于状态目录。

## 6. 输出与可观测性

- 每次 dispatch/gate 结果写 `decisions.jsonl` / `verification/`（06）。
- `/game status` 汇总：当前任务、阶段、上次 gate 结果、活跃 subagent、下一步。
- 命令 handler 返回的 text 用紧凑 Markdown（DSH Web 渲染命令结果不进模型历史，00 §4）。
