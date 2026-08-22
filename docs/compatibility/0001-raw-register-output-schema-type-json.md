# 兼容性问题 0001 — raw `tools.register` 不接受 `{ type: 'json' }` 输出 schema

- **状态**：**Fixed**（2026-08-22，方案 A）
- **发现日期**：2025-08-22
- **影响版本**：dsh-game-studio 0.1.0 / 0.1.1（`lib/index.js` 全部 6 个模型工具）
- **对照 DSH 版本**：`/Users/markus/deepseek-harness` 当前 checkout（pre-release，`SESSION_FORMAT_VERSION = 0`）
- **严重级别**：高 —— 在真实 DSH 运行时下，插件的全部工具面注册失败

## 问题描述

`lib/index.js` 通过 **raw 定义 + `tools.register(guardedTool(...))`** 注册 6 个工具
（`game_studio_engine` / `status` / `state` / `route` / `dispatch` / `gate`），
它们的输出 schema 统一使用：

```js
// lib/index.js:50
const JSON_OUT = { type: 'json' }
```

但 `type: 'json'` **只属于 `defineTool` 的 author-facing ValueSchemaSpec 方言**，
不属于 DSH raw JSON Schema 受支持子集。raw `tools.register()` 会对
`output.schema` 直接做子集校验，`'json'` 不在允许的 7 种类型之列，注册即抛
`JsonSchemaError`。

两种方言的关系：

| 方言 | `'json'` 的地位 | 校验/编译入口 |
|---|---|---|
| `defineTool` ValueSchemaSpec（author-facing） | 合法，编译为 annotation-only 空 schema `{}` | `valueSchemaSpecToJsonSchema()`（`packages/core/tools/src/schema.ts:438`，`case 'json'` 分支在 `schema.ts:361`） |
| raw JSON Schema 子集（`tools.register` 直接接受的） | **非法**，`type` 必须是 `object/array/string/number/integer/boolean/null` 之一或省略 | `assertSupportedJsonSchema()`（`packages/core/tools/src/json-schema.ts:385`；类型白名单 `json-schema.ts:87`） |

本插件绕过了 `defineTool`（`guardedTool` 只包裹 `execute` 做参数守卫，见
`src/tool-args.js:25`，不做任何 schema 编译），因此 `{ type: 'json' }` 以原样
到达 `register()` 的 `assertSupportedJsonSchema(output.schema)`
（`packages/core/tools/src/index.ts:1045`）并被拒绝。

## 影响

1. **运行时**：在真实 DSH 下，`ctx.inject(['tools'], ...)` 回调中第一个
   `tools.register(guardedTool(engineTool()))`（`lib/index.js:94`）即抛
   `JsonSchemaError`（形如 `schema.type must be one of
   object/array/string/number/integer/boolean/null`），后续 5 个工具不会
   注册 —— **工具面整体不可用**（`/game` 命令、skills provider、hooks、
   system prompt section 是否存活取决于 Cordis 对 inject 回调异常的处理，
   但 6 个工具必然全部缺失）。
2. **测试假阳性**：`test/contract.test.js` 自称「与源码 register() 一致」
   （文件头注释引用 `packages/core/tools/src/index.ts:1037`），但其
   `assertRegisterable` 在第 30 行把 `type === 'json'` 当作合法值放行，
   与真实 `assertSupportedJsonSchema` 行为相反 —— 正是该文件头声明要避免的
   「测试自我印证假阳性」。
3. **文档漂移**：README「DSH 兼容性」小节称「当前公开 API 无需迁移」，
   与本问题矛盾；`docs/design/00-dsh-integration-contract.md` 记录了
   「output 必填 { schema, render }」但未记录 output.schema 的子集校验规则。

## 证据

插件侧（本仓库）：

- `lib/index.js:50` — `const JSON_OUT = { type: 'json' }`
- `lib/index.js:159, 202, 223, 245, 281, 369` — 6 个工具的
  `output: { schema: JSON_OUT, render: jsonRender }`
- `lib/index.js:94–99` — raw `tools.register(guardedTool(...))` 注册路径
- `src/tool-args.js:25–34` — `guardedTool` 仅包裹 `execute`，schema 原样透传
- `test/contract.test.js:30` — 错误地放行 `output.schema.type === 'json'`

DSH 侧（`/Users/markus/deepseek-harness`，记录时点的行号，pre-release 会漂移，
使用前请重新核对）：

- `packages/core/tools/src/index.ts:1045` — `register()` 调用
  `assertSupportedJsonSchema(output.schema)`
- `packages/core/tools/src/json-schema.ts:87` —
  `SCHEMA_TYPES = ['object', 'array', 'string', 'number', 'integer', 'boolean', 'null']`
- `packages/core/tools/src/json-schema.ts:303–306` — `type` 不在白名单即记录
  violation（`type must be one of object/array/string/number/integer/boolean/null`）
- `packages/core/tools/src/schema.ts:361` — `case 'json'` 仅存在于
  ValueSchemaSpec 编译器中，产出 annotation-only schema
- `packages/core/tools/src/schema.ts:545, 567` — `defineTool` 内部经
  `valueSchemaSpecToJsonSchema` 把方言编译为 raw 子集后才交给注册

## 建议修复（二选一，均不在本记录中实施）

**方案 A（最小改动，推荐）**：把 `JSON_OUT` 改为 raw 子集中的
「无约束 JSON」标准形态 —— annotation-only schema：

```js
const JSON_OUT = { description: 'lossless JSON result' }   // 或直接 {}
```

这正是 `defineTool` 把 `{ type: 'json' }` 编译出的目标形态，语义完全等价，
且不引入对 `@deepseek-ai/dsh-tools` 的构建期依赖。

**方案 B（对齐官方入口）**：改用 `defineTool`（`@deepseek-ai/dsh-tools`）
定义工具，保留 ValueSchemaSpec 方言写法，由其负责编译与参数校验；
届时 `guardedTool` 的手写参数守卫可一并移除（`defineTool` 的 execute
自带 `validateJsonSchemaValue` 参数校验）。需注意这会把 dsh-tools 从
运行时注入面提升为显式依赖，与当前 peerDependencies 策略（仅 cordis +
schemastery）需要协调。

同时无论选哪个方案，都必须修正 `test/contract.test.js:30`，删除对
`'json'` 的放行（见下）。

## 验收测试

1. **契约测试对齐真实校验**：`test/contract.test.js` 的
   `assertRegisterable` 改为忠实复刻 `assertSupportedJsonSchema` 的类型
   白名单（`type` 省略，或 ∈ `object/array/string/number/integer/boolean/null`；
   显式断言 `'json'` 会被拒绝），6 个工具的 `output.schema` 全部通过。
2. **负向回归**：新增用例断言 `{ type: 'json' }` 在该校验下必然失败，
   防止方言混用回潮。
3. **真实运行时冒烟**：在 DSH checkout 下按 README「路径一：开发期 link
   安装」装载插件，启动 `pnpm dsh web` 后确认 6 个 `game_studio_*` 工具
   全部出现在工具列表且无 `JsonSchemaError` 日志。
4. **现有套件不回退**：`npm run check`（`node --check` + `node --test`）
   全绿。

## 关联

- `docs/design/00-dsh-integration-contract.md` §「契约核对记录」应补充一条
  机制事实：raw `tools.register` 对 `output.schema` 执行
  `assertSupportedJsonSchema`，`type: 'json'` 仅为 defineTool 方言。
- README「DSH 兼容性」小节已改为指向本记录（不再声称「无需迁移」）。

## 修复记录

- **修复日期**：2026-08-22
- **采用方案**：**方案 A**（最小改动）—— `JSON_OUT` 由 `{ type: 'json' }`
  改为 annotation-only schema `{ description: 'lossless JSON result' }`，
  即 `defineTool` 把 `{ type: 'json' }` 编译出的目标形态，语义等价，
  不引入对 `@deepseek-ai/dsh-tools` 的构建期依赖。

### 改动文件清单

| 文件 | 改动 |
|---|---|
| `lib/index.js` | `JSON_OUT`（约 :56）改为 `{ description: 'lossless JSON result' }`，附方言说明注释 |
| `test/contract.test.js` | 删除对 `type === 'json'` 的错误放行（原 :30）；`assertRegisterable` 升级为忠实复刻 `assertSupportedJsonSchema` 的小型校验函数（type 白名单、CONSTRAINT/ANNOTATION 关键字集合、oneOf 规则、properties/items 递归、enum/const 类型匹配），并同时作用于 6 个工具的 `output.schema` 与 `parameters`；新增负向回归用例断言 `{ type: 'json' }`（含嵌套位置）必被拒绝 |
| 本文档 | 状态 Open → Fixed，补本节 |
| `docs/design/00-dsh-integration-contract.md` | §12 契约核对记录补充 raw register schema 子集校验机制事实 |

### 验收结果（2026-08-22）

1. **契约测试对齐真实校验** ✅ —— 复刻校验对 6 个工具的
   `output.schema` + `parameters` 全部通过；修复前基线下旧断言的
   `'json'` 放行分支已在真实语义下现形（修复前该用例对
   `{ type: 'json' }` 会失败，证明假阳性已消除）。
2. **负向回归** ✅ —— 新增用例断言 `{ type: 'json' }`（顶层与嵌套
   `properties` 位置）均被复刻校验拒绝，annotation-only 形态通过。
3. **真实校验器验证** ✅ —— 临时脚本 `/tmp/verify-0001.mjs` 直接 import
   构建产物 `packages/core/tools/lib/index.js` 导出的
   `assertSupportedJsonSchema`：
   - `{ description: 'lossless JSON result' }` → **通过**；
   - `{ type: 'json' }` → 抛 `JsonSchemaError: unsupported JSON schema:
     schema.type must be one of object/array/string/number/integer/boolean/null`。
4. **现有套件不回退** ✅ —— `node --check lib/index.js` 通过；
   `node --test test/*.test.js` 100 pass / 0 fail（修复前基线 83 pass +
   本次新增及并行改动带来的用例）。
5. **全仓扫描** ✅ —— `src/`、`lib/` 无其他 `type: 'json'` 残留
   （含 `src/orchestrator/`、`src/registry/`，均无此写法）；文档中的
   出现均为问题描述引用，非代码。
6. 真实运行时冒烟（§验收测试 第 3 条）留待下次 `pnpm dsh web` 装载时
   执行，不阻塞本记录关闭 —— 真实校验器已在第 3 项直接验证。
