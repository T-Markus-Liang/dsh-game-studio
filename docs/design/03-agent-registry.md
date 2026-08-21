# 03 — Agent Registry（49 个角色，动态选配）

> 前置阅读：[00 §6 Subagent](00-dsh-integration-contract.md)、[01 §4 动态 Agent Pool](01-architecture.md)。

## 1. 设计原则

- **49 个领域角色全部保留为数据，绝不同时加载。** Registry 是磁盘上的索引，
  不是 49 个常驻 subagent。
- **Agent = persona + 能力元数据。** 运行时把 persona 注入 `SubagentStartRequest.persona`
  （00 §6），SOP 由 Orchestrator 按需拼接（skill），工具面由 `toolFilter` 收窄。
- 原项目的 Claude Code frontmatter（`tools: Read, Glob…`、`model: opus`、`maxTurns`、
  `memory: user`）**在 DSH 无对应物**（00 §11），迁移时按 §3 映射清洗。

## 2. 磁盘格式

```
assets/agents/<id>.md          # 清洗后的 persona 正文（Markdown）
assets/manifest.json           # 全量索引（agents + skills + rules 一个文件）
```

`manifest.json` 中每个 agent 条目：

```jsonc
{
  "id": "unreal-specialist",
  "kind": "agent",
  "tier": "specialist",            // director | lead | specialist | verifier-capable
  "department": "engine",          // core|programming|design|art|audio|narrative|qa|release|ops|engine
  "engines": ["unreal"],           // [] = 引擎无关；unity|unreal|godot
  "subsystems": ["gameplay", "rendering", "netcode", "gas", "blueprint"],
  "modelTier": "A",                // S|A|B —— 建议层级，映射到 Config.models（01 §8）
  "toolProfile": "coder",          // coder | designer | analyst | reviewer（→ §5 toolFilter 预设）
  "summary": "UE5 全域专家：GAS/Blueprint/Replication/UMG…",  // ≤2 句，用于选配与 /game agents
  "file": "agents/unreal-specialist.md"
}
```

## 3. 原 frontmatter → DSH 映射

| 原字段 | 处理 |
|---|---|
| `name` | → `id`（不变） |
| `description` | → 压缩为 `summary`（选配用），全文留正文 |
| `tools: Read, Glob, Grep, Write, Edit, Bash, WebSearch` | → `toolProfile` 四选一（§5）；原始列表丢弃 |
| `model: opus/sonnet/haiku` | → `modelTier: S/A/B`（只是建议位，实际模型来自插件 Config） |
| `maxTurns` | → 丢弃（DSH subagent 由 parent 控制；深度用 `maxDepth`） |
| `memory: user` | → 丢弃（记忆统一走 06 状态目录） |
| 正文中 Claude Code 专有指令（AskUserQuestion 用法、`.claude/` 路径） | → 09 号文档清洗规则重写 |

## 4. 分层与选配算法

### 4.1 分层

```
directors (3):  producer, creative-director, technical-director        → tier=director, modelTier=S
leads:          lead-programmer, qa-lead, art-director, audio-director,
                narrative-director …                                    → tier=lead, modelTier=S/A
specialists:    其余全部（含 15 个引擎专家）                              → tier=specialist, modelTier=A
utility 角色:   （无独立 agent；Tier B 是模型层级不是角色）
```

### 4.2 选配算法（确定性代码，`game_studio_route` 的内部实现）

输入：`{ category, subsystem, engine, reviewMode }`。输出：`{ lead, specialists[], verifier }`。

```
1. lead   = leadFor(category)                 # bug/feature→technical-director 或 lead-programmer；
                                              # design→creative-director；release→producer；
                                              # studio 模式必选 lead，lean/solo 模式 lead 可为空
2. pool   = agents.filter(a =>
              a.tier == 'specialist'
              && (a.engines.length == 0 || a.engines.includes(engine))
              && a.subsystems ∩ subsystems ≠ ∅)
3. specialists = rank(pool)                   # 命中 subsystem 数降序 → 引擎专属优先 → 取 1..3
                                              # solo 模式强制取 1
4. verifier = 独立于以上所有选择（07 号文档）；qa-tester persona 为默认底稿
5. 断言：|{lead} ∪ specialists ∪ {verifier}| ≤ 5（+宿主 Orchestrator = ≤6）
```

规则表 `leadFor` / subsystem 词表放 `src/orchestrator/routing-tables.js`，纯数据可测。

### 4.3 spawn 参数组装（`game_studio_dispatch` 内部）

```js
await ctx.subagents.start({           // 具体 API 形态实现时按 00 §6 来源核对
  label: agentId,
  provider: 'spawn-in-process',       // verifier 也用 spawn（不 fork，防思路污染，07）
  parent: hostAgent,
  persona: composePersona(agent),     // = persona 正文 + Focus Contract + 命中的 rules
  prompt: [taskCard],                 // 任务卡 + 选中 skill 的 <skill_content>
  toolFilter: TOOL_PROFILES[agent.toolProfile],
  outputSchema: OUTPUT_SCHEMAS[role], // §6
  maxDepth: 1,                        // specialist 不得再委托（V0.1）
  // provider/model 覆盖：按 modelTier 查 Config.models，null 则省略
})
```

## 5. toolFilter 预设

| profile | 允许工具（按宿主实际工具名对齐，实现时核对 tool catalog） |
|---|---|
| `coder` | read/write/edit/glob/grep/bash + `game_studio_engine` + `game_studio_state`(read) |
| `designer` | read/write/glob/grep（只写 design/ 与 docs/，路径由 08 hooks 拦截兜底） |
| `analyst` | read/glob/grep/bash(只读性质) + `game_studio_engine`(logs/test) |
| `reviewer` | read/glob/grep + `game_studio_engine`(test)；**无 write/edit** |

Verifier 固定用 `reviewer`。specialist 一律拿不到 subagent 派发工具（maxDepth=1 双保险）。

## 6. outputSchema（结构化交付）

所有 dispatch 强制 `outputSchema`（对象根 JSON Schema，00 §6 in-process 支持）：

```jsonc
// role = specialist (coder)
{
  "type": "object",
  "required": ["status", "summary", "filesChanged", "testsRun", "followups"],
  "properties": {
    "status": { "enum": ["done", "blocked", "needs-review"] },
    "summary": { "type": "string" },
    "filesChanged": { "type": "array", "items": { "type": "string" } },
    "testsRun": { "type": "string" },
    "followups": { "type": "array", "items": { "type": "string" } }
  }
}
// role = verifier → 07 号文档的裁决 schema
// role = lead → plan schema（tasks[]，每个含 goal/scope/done）
```

## 7. `/game agents` 输出

按 department 分组列出 `id — summary (tier, engines)`，纯读 manifest，零 token。

## 8. 测试要点

- manifest 完整性：49 个条目、id 唯一、file 存在、enum 字段合法（node --test 校验）。
- 选配算法表驱动测试：`(bug, animation, ue5, lean)` → 必含 `unreal-specialist`；
  `(feature, gameplay, godot, solo)` → 恰 1 个 specialist；等。
- persona 组装快照测试：不含 `.claude/`、不含 Claude Code 工具名。
