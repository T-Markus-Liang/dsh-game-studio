# 00 — DSH 集成契约（已验证机制事实）

> **本文档的地位：实现前必读，且是唯一的机制事实来源。**
> 后续所有设计文档（01–10）只允许使用本文档列出的 DSH 机制。任何本文档没有列出的
> API，实现模型必须先到 DSH checkout（`/Users/markus/deepseek-harness`）核实后再用，
> 禁止凭记忆或凭 Claude Code / 其他 harness 的经验类推。
>
> 核实方法：本文档每一条都标注了来源文件。DSH 处于 pre-release（会话格式
> `SESSION_FORMAT_VERSION = 0`，无兼容性承诺），实现前应重新核对来源是否漂移。

---

## 1. 运行环境事实

| 事实 | 值 | 来源 |
|---|---|---|
| DSH 源码 checkout | `/Users/markus/deepseek-harness` | 环境 |
| DSH 运行方式 | 从源码运行：`pnpm dsh web`（无全局 `dsh` 二进制，`which dsh` 为空） | 环境核查 |
| Web GUI | `http://127.0.0.1:3080` | 环境 |
| `$DSH_HOME` | `~/.dsh`（含 `profiles/`、`local-plugins/`、`sessions/`、`storages/`、`skills/`、`settings.yaml`） | 环境核查 |
| Profiles | `~/.dsh/profiles/{web,tui,headless}` + 共享 `profiles/node_modules/` | 环境核查 |
| 用户补丁层 | `~/.dsh/profiles/web/cordis.patch.yml`（顶层 YAML 数组：id 定向 config 覆盖、disable、insert；支持 `!!js` 表达式；**保存即热重载**） | 该文件头注释 |
| Node 要求 | `>= 22.13`（现有社区插件的 engines 约定） | `local-plugins/dsh-image-text-bridge/package.json` |
| 本机已启用 verifier | `@deepseek-ai/dsh-verifier-python` 已在 web profile 插入（morecode shim `http://127.0.0.1:15724/v1`，`deepseekCompatible: true`，对 `deepseek-v4-flash` 返回真实 logprobs） | `~/.dsh/profiles/web/cordis.patch.yml` |

## 2. 插件形态（Cordis）

DSH 底层是 vendored 的 Cordis 插件框架。一个插件 = 一个 ESM 模块：

```js
export const name = 'dsh-game-studio'
export const inject = ['tools']            // 硬依赖服务：不齐则 PENDING，齐了才 apply
export function apply(ctx, config = {}) {
  // 注册能力。所有通过 ctx 注册的东西（工具/命令/监听器/定时器）
  // 在插件卸载时自动清理；外部资源用 ctx.effect(() => disposer)。
}
```

关键 Cordis 语义（来源：`docs/cordis-primer.md`、`docs/cordis-tutorial/`）：

- **`inject` 是硬依赖**：列出的服务不存在时插件保持 PENDING；服务消失时依赖它的插件被卸载、服务回来时重新加载。
- **软依赖用 `ctx.inject(['svc'], (subCtx) => {...})`**：子闭包只在服务可用时挂载。实测范例：plan-mode 用 `ctx.inject(['commands'], commandCtx => commandCtx.commands.register({...}))` 注册命令（`packages/plan/plan-mode/src/index.ts:278`）。
- **`ctx.provide('key', value)`** 发布自己的服务（范例：image-text-bridge 的 `ctx.provide('imageTextBridge', {...})`）。
- **HMR 天然支持**：所有注册都是 effect，vendored HMR 直接生效（`docs/cookbook/extension-cookbook.md`）。
- **配置校验用 schemastery**：`import z from '@deepseek-ai/schemastery'`，配合 `ctx.settings.register(namespace, schema, { base, validate })` 可出现在 Web 设置页（范例：image-text-bridge `index.js`）。

## 3. 社区插件打包与安装（本仓库的交付形态）

已验证范本：`local-plugins/dsh-usage-vendor-stats`、`local-plugins/dsh-image-text-bridge`。

### 3.1 package.json 清单

```jsonc
{
  "name": "dsh-game-studio",
  "type": "module",
  "main": "lib/index.js",
  "exports": {
    ".": { "default": "./lib/index.js" },
    "./client": { "default": "./lib/client.js" },   // 仅当有 Web 客户端半边
    "./package.json": "./package.json"
  },
  "dsh": {
    "bundle": { "patch": "./cordis.patch.yml" },     // dsh plugin add 时自动插行
    "client": {                                       // 可选：Web 客户端半边
      "inject": ["@deepseek-ai/dsh-client-runtime"],
      "platform": "web"
    }
  },
  "peerDependencies": { "@deepseek-ai/cordis": "*" }  // DSH 包一律 peer，不打包
}
```

### 3.2 cordis.patch.yml（随包补丁）

```yaml
- insert:
    - id: game-studio
      name: dsh-game-studio
      config: {}   # 见 01 号文档的 Config schema
```

### 3.3 三种安装路径（按优先级支持）

> ⚠️ **双加载风险**：同一插件**不得同时**出现在 `dsh.profile.bundles` 列表**和**手动 `cordis.patch.yml` insert 中。
> 两路都会触发插件启动，导致 loader entry duplicate、工具注册失败（`"xxx" is already registered`），
> 且手动 patch 的 config 会被 bundle 实例静默忽略。详见 `docs/compatibility/0002-duplicate-bundle-insert.md`。
> 自带 `dsh.bundle.patch` 的插件应通过 `dsh plugin add` 安装，或由用户手动 insert（二选一，不可混用）。
>
> **工程防线（0002 已修复，v0.1.3+）**：本插件在 apply() 入口自带进程级单实例守卫
> （`globalThis[Symbol.for('dsh-game-studio.active')]` 注册表 + token 化 `ctx.effect` dispose 释放）。
> 双加载发生时，第二实例整体 no-op（不注册任何 commands/tools/skills/settings/hooks/section）
> 并在日志发出明确告警；首个实例卸载/HMR 重载后标记自动释放，不影响正常重载。
> 守卫是兜底而非许可——安装配置仍应二选一。
>
> **方案 C 发布约定**：自带 `dsh.bundle.patch` 的插件不要进 `dsh.profile.bundles` 列表。

1. **`dsh plugin add`（发布后）**：`pnpm dsh plugin --profile web add "github:<owner>/dsh-game-studio"`。
   CLI 的 `plugin` 子命令把剩余参数转发给 profile 目录里的 pnpm（来源：`apps/cli/src/args.ts:171`），
   然后 `dsh.bundle.patch` 里的行被并入 profile 补丁层。装完刷新页面即可，无需重启。
2. **本地开发 link**：在 `~/.dsh/profiles/node_modules/` 下建 symlink 指向本仓库，
   然后在 `~/.dsh/profiles/web/cordis.patch.yml` 手动加 insert 行（用户补丁层热重载：保存 + 刷新页面）。
   这是 V0.1 开发期的标准跑法（来源：dsh-usage-vendor-stats README「Manual registration」）。
3. **仓库内绝对路径（临时调试）**：patch 行的 `name` 可以直接是插件入口的绝对路径
   （来源：`docs/user/develop/basic/index.md`）。

### 3.4 卸载语义

从补丁层删掉 insert 行 = 卸载。Cordis 保证所有注册（命令、工具、监听、skill provider）
随插件 dispose 自动解除——**这就是「可安装、可卸载」的全部实现成本**，不需要自己写卸载器。

## 4. 斜杠命令（`ctx.commands`）

来源：`packages/interaction/commands/README.md` + `src/index.ts`。

- **命令名语法（硬约束）**：`/^\/([a-z][a-z0-9_-]*)(?=$|[\t\n\r ])/u`。
  **不允许冒号**——`/game:start` 在 DSH 中不可注册、不可解析。本项目采用 `/game <subcommand>`。
- 注册：`ctx.commands.register({ name, description, input: { hint, images }, recordInput?, handler })`。
  同层重名注册直接抛错；agent 作用域注册可遮蔽全局同名命令。
- handler 收到 `{ agent, rawInput, attachments, signal }`，返回 `{ kind: 'success'|'error', text? }`。
  **`rawInput` 是命令名之后的全部原文**（含前导空格）——子命令解析完全由我们自己做。
- **命令执行零 token**：命令在 UI command plane 执行，结果不进模型历史。
  需要触发模型工作时，由 handler 显式调用 `agent.steer(createUserMessage({...}))` 或
  `agent.followup(...)`（范例：plan-mode 对 `/plan [message]` 的处理）。
- 生命周期落库为 `command/run` / `command/done` 日志事件（不进模型上下文）。

## 5. 模型可见工具（`ctx.tools`）

来源：`docs/cordis-tutorial/07-into-the-harness.md`、`docs/cookbook/adding-a-tool.zh.md`。

```js
ctx.tools.register(defineTool({
  name: 'game_studio_detect_engine',
  description: '…',
  parameters: { /* spec → JSON Schema，自动进 system prompt */ },
  execute: async (args, exec) => { /* … */ },
}))
```

- 工具 schema 自动进入 system prompt 装配，无需额外接线。
- 拦截/策略走事件瀑布：`tools/pre-execute`（允许/拒绝/ask）→ `tools/execute`（包装分发）→
  `tools/post-execute`（改结果/附加上下文）→ `tools/result`（只读观测最终结果）。
- 异步通知模型：`agent.inject({ content, source: { kind: 'plugin', plugin: 'dsh-game-studio' } })`
  追加持久化上下文（不是唤醒；空闲 agent 保持空闲）。
- 渐进式披露：`ctx.tools.restrict()` 可按状态收缩模型可见工具集。

## 6. Subagent 派发（`ctx.subagents`）— 动态 Agent Pool 的地基

来源：`docs/subsystems/subagent.md`、`packages/subagent/README.md`。

- **多 provider 按名共存**：`spawn`（全新子 agent；in-process 实现）、`fork`（继承父完成史）、
  `acp` / `codex` / `claude-code` / `dsh-sdk`（外部进程）。V0.1 只依赖 in-process 两种。
- **一次性启动请求 `SubagentStartRequest`** 支持（逐项对应 capability 标志，不支持则
  `SubagentError('UNSUPPORTED_CAPABILITY')` 响亮失败）：
  - `label` — 显示名（如 `gameplay-programmer`）
  - `prompt: ContentBlock[]` — 子 agent 的用户消息
  - `parent: Agent` — 工作区/lineage/深度由此派生
  - `outputSchema` — **对象根 JSON Schema 强制结构化输出**（in-process 用强制 capture tool 实现）
  - `toolFilter` — 限制子 agent 可见工具
  - `persona` — 子 agent 的 system prompt 人格 ← **49 个 agent 定义从这里注入**
  - `maxDepth` — 委托深度限制
- 模型侧消费者：`dsh-tool-subagent`（每 provider 一个委托工具）、`dsh-tool-subagent-control`
  （`send_message` / `interrupt_agent` / `list_agents`）、`dsh-tool-subagent-report`（子→父汇报）。
- **推论（设计依据）**：Orchestrator 不需要自建执行器。「1 Lead + 1..3 Specialist + 1 Verifier」
  = 带不同 `persona` / `toolFilter` / `outputSchema` 的若干次 `ctx.subagents` 委托。

## 7. Skill 注册（`ctx.skills`）— 73 个 skill 的宿主

来源：`packages/skill/skill/README.md`。

- `ctx.skills.registerProvider(create)`：注册一个 skill 来源（我们注册一个读取本插件
  `assets/skills/` 的 provider；shipped 范本是 `dsh-skill-filesystem`）。
- `ctx.skills.register(skill)`：运行时注册单个 skill。
- **邀约策略是四象限**：`{ modelInvocable, userInvocable }` 独立控制模型目录与用户目录
  ——这正是「73 个 skill 全保留但不暴露给用户」的现成机制：全部
  `{ modelInvocable: true, userInvocable: false }`，Orchestrator 自己选。
- 目录进模型的成本由 `dsh-tool-skill` 控制：catalog 条目 + 按需加载 body（`<skill_content>` 块，
  `renderSkillContent` 是唯一渲染真源）。
- 变更通知：`skills/change` 事件，消费者自行重新 `snapshot()`。

## 8. Verifier（`ctx.verifier`）

来源：`packages/verifier/README.md`（包族）+ `verifier/verifier/README.md`（服务定义）。

- `ctx.verifier.select(request)`：一个 problem + 多条完整候选轨迹字符串 + 命名 criteria +
  显式 model + 锦标赛设置 → 返回胜者索引、逐候选分数与排名、比较次数、token 用量。
- 包族：`verifier`（服务定义）/ `verifier-python`（pinned `llm-verifier==0.2.0` provider）/
  `tool-verify-candidates`（对既有 Session 排名）/ `tool-best-of-n`（**Git worktree 隔离生成候选并晋升胜者**）。
- 默认 bundle 不含任何 verifier 包，须显式 opt-in——**但本机已配置 verifier-python**（见 §1）。
- 该 seam 只做选择，从不改工作区、从不当 LLM adapter。
- **设计定位**：质量门的「LLM 裁判」层有两条现成路：
  (a) 派发一个 persona=verifier、带 `outputSchema` 的 subagent 出结构化裁决（V0.1 默认，无额外依赖）；
  (b) 对核心系统用 `ctx.verifier` / `best_of_n` 做多候选择优（可选增强，检测到服务在场才启用）。

## 9. 事件总线（Hooks 的宿主）

来源：`docs/cookbook/extension-cookbook.md` §「Product feature → Plugin mechanism」映射表。

| DSH 事件/机制 | 语义 |
|---|---|
| `agent/session-start` | 会话开始 |
| `agent/pre-step` | 每步前（typed decision 瀑布；自动 compaction 也挂在这） |
| `agent/request` | 模型请求前（可改 messages；范例：image-text-bridge 的 listener 返回 `{ kind: 'enter', messages }`） |
| `tools/pre-execute` | 工具执行前（allow / deny / ask；ask 经 `ctx.approval`） |
| `tools/post-execute` | 工具执行后（可改结果、附上下文） |
| `tools/result` | 最终结果只读观测（审计/度量） |
| `agent/turn-stopping` | 回合将停（可 steer 追加一步 ← 质量门「不过就打回」的挂点） |
| `turn/end`（session 事件） | 回合结束（`/loop` 类续推挂点） |
| `session/event` | 全部持久化事件流（UI/遥测） |
| `agent/request-error` | 请求错误（溢出恢复等） |

另有现成桥：`dsh-hooks-claude-code` / `dsh-hooks-codex` 把 Claude Code / Codex 的 hook
配置文件映射到上述扩展点（`config-catalog` 中的 `pluginRoot` 即替换 `${CLAUDE_PLUGIN_ROOT}`）。
**V0.1 不用桥**，直接写原生监听器（见 08 号文档）。

## 10. 其他相关 seam（用到才碰）

- **System prompt 段**：`ctx.systemPrompt.section()` 支持排序与 scope 遮蔽——项目上下文
  （引擎、当前任务）以 section 注入。
- **Goal**：`ctx.goals` + `dsh-goal-round-driver` 做同会话长目标续推——Game Loop 的多轮推进不自造轮子。
- **Compaction**：`ctx.compaction` seam；自动压缩挂 `agent/pre-step`。
  **推论：凡是必须跨 compaction 存活的状态一律落文件**（见 06 号文档），不依赖对话内容。
- **Workflow**：`ctx.workflowEngine` + `workflow` 工具（脚本化多 agent 编排，带 outputSchema 校验）——
  大型 fan-out（如全资产审计）可复用，V0.1 不依赖。
- **Approval**：`tools/pre-execute` 返回 `ask` + `ctx.approval` 应答——质量门的人工确认走这里。
- **模型/Provider 路由**：per-agent provider/model 覆盖在 LLM policy 配置中（`docs/config-catalog.md`
  「Exact provider/model overrides; duplicate targets fail plugin load」）。**模型名是部署配置，
  不硬编码进本插件**——分层（Tier S/A/B）只落在插件 Config 的可配字段上。

## 11. 明确不存在 / 不可用（防幻觉清单）

- ❌ `/game:start` 冒号命令名——解析器不认（§4）。
- ❌ 全局 `dsh` 二进制——本机从源码 `pnpm dsh` 运行。
- ❌ `dsh plugin install` 子命令——实际是 `dsh plugin --profile <p> add <spec>`（转发 pnpm）。
- ❌ Claude Code 的 `.claude/settings.json` hooks / `subagent_type` / frontmatter `tools:` 语义——
  DSH 一概没有对应物，原项目资源里这些字段必须按 09 号文档清洗转换。
- ❌ 稳定 API 承诺——DSH pre-release，peerDependencies 用宽松版本并在 CI 里对 rc 版本冒烟。
- ⚠️ `deepseek-v4-flash` 等模型名是**本机部署配置**，文档与代码中只作为默认值示例出现，一律可配。

## 12. 契约核对记录

后验核对中确认的机制事实（每条附来源，行号为记录时点，pre-release 会漂移）：

- **raw `tools.register` 对 `output.schema` 执行 `assertSupportedJsonSchema`**
  （`packages/core/tools/src/index.ts:1045`，函数定义
  `packages/core/tools/src/json-schema.ts:385`）。受支持子集：`type`
  **省略（annotation-only，无约束 JSON 的标准形态）或 ∈
  `object/array/string/number/integer/boolean/null`**（白名单
  `SCHEMA_TYPES`，`json-schema.ts:87`；违规报
  `schema.type must be one of ...`，`json-schema.ts:303-306`）；
  关键字限于 `type/oneOf/properties/required/additionalProperties/items/enum/const`
  加注解 `description/title/default/examples`（`json-schema.ts:76-86`），
  `properties`/`items` 子 schema 递归受检。
  **`type: 'json'` 不在该子集内** —— 它仅是 `defineTool` 的 author-facing
  ValueSchemaSpec 方言（`packages/core/tools/src/schema.ts:361` 的
  `case 'json'` 分支），其编译产物是 annotation-only 空 schema；raw 路径
  直接写 `{ type: 'json' }` 会在注册时抛 `JsonSchemaError`。
  见兼容性记录
  [0001](../compatibility/0001-raw-register-output-schema-type-json.md)（Fixed）。
