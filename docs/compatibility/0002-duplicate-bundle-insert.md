# 兼容性问题 0002 — 同时使用 `dsh.profile.bundles` 与手动 `cordis.patch.yml` insert 导致双加载

- **状态**：**Fixed（方案 B 增强版：进程级 Symbol 注册表 + token 化 dispose 释放；方案 A 文档警告已有；方案 C 见集成契约 §3.3）**
- **发现日期**：2026-08-22
- **影响版本**：dsh-game-studio 0.1.0 / 0.1.1，以及所有自带 `dsh.bundle.patch` 的 DSH 社区插件
- **对照 DSH 版本**：`/Users/markus/deepseek-harness` 当前 checkout（pre-release）
- **严重级别**：中 —— 插件的 loader entry 重复，手动 patch 的 config 配置被静默忽略

## 问题描述

DSH 社区插件有两种安装路径，分别对应不同的 loader entry 注册方式：

| 安装路径 | loader entry 来源 | 触发条件 |
|---|---|---|
| `dsh.profile.bundles` 列表 | 插件自带的 `dsh.bundle.patch`（`cordis.patch.yml`）自动插入 | bundle 构建时自动合并 |
| 手动 `cordis.patch.yml` insert | 用户手工写 `<dsh-home>/profiles/<profile>/cordis.patch.yml` | 保存即热重载 |

这两种机制**不互斥**。如果同一个插件同时出现在 `dsh.profile.bundles` 列表和手动 `cordis.patch.yml` insert 中，结果就是：

1. **两个 loader entry 先后注册**，产生两份 `id` 相同的插件实例。
2. 先注册的实例（来自 bundle，无用户 config）生效。
3. 后注册的实例（来自手动 insert，通常带用户配置如 `ocrPython`/`modlensEnabled`）被静默忽略。
4. 插件内部的 `ctx.tools.register(tool)` 在第二次运行时抛出 `tool "xxx" is already registered`，被 `try/catch` 捕获后打印 `tool registration skipped` 日志。
5. loader 层面可能抛出 `duplicate loader entry id` 错误，导致 plugin tree 启动失败。

### 真实案例

`dsh-quicksight` 在 `dsh.profile.bundles` 中加载了一次，同时 `cordis.patch.yml` 第 43-48 行又手动 insert 了 `id: dsh-quicksight`。结果：

- bundle 实例先启动（无 config，使用默认值）。
- 手动 insert 实例后启动（带 `ocrPython` 和 `modlensEnabled` 配置），但被静默忽略。
- 日志持续打印 `[quicksight] tool registration skipped: tool "quicksight_ocr" is already registered`。
- 用户的 OCR Python 路径配置未生效，实际使用的是默认路径。

## 影响

1. **用户配置丢失**：手动 insert 中的 config 块被 bundle 实例的默认配置覆盖，用户以为配置已生效，实际未生效。
2. **日志噪声**：每次启动都打印 `... is already registered` 错误，容易掩盖其他真正的启动错误。
3. **启动失败风险**：如果插件没有 `try/catch` 包装 `tools.register`，第二个 loader entry 启动时直接抛错，导致 plugin tree 不可用。
4. **卸载困难**：用户以为从 `cordis.patch.yml` 删除 insert 就能卸载，但 bundle 实例仍在。

## 证据

- `dsh-quicksight` 的 `dsh/index.js` 第 145 行 `ctx.tools.register(tool)` 被 `try/catch` 包裹（第 144-148 行），抛出 `JsonSchemaError` 或 `"xxx is already registered"` 后只打印日志，不阻塞启动。
- 最终 `dsh --profile web --dump-config` 中只有一个 `id: quicksight` 条目（后注册的覆盖了先注册的？实际取决于 Cordis patch 合并策略），但 tools.register 层面确实运行了两次。

## 建议修复

### 方案 A（预防，推荐）：在文档中明确约定

在 README 安装说明和设计文档中明确写入：

> **不要同时使用 `dsh.profile.bundles` 和手动 `cordis.patch.yml` insert 安装同一个插件。**
> 二选一：
> - 发布后安装 → 用 `dsh plugin add`，自动通过 `dsh.bundle.patch` 注册。
> - 开发期 link → 只用手动 `cordis.patch.yml` insert，**不要加入 `dsh.profile.bundles`**。

### 方案 B（工程）：在 apply 入口检测重复

```js
if (APPLIED.has(ctx)) return // 或 throw
APPLIED.add(ctx)
```

这可以防止同一个插件实例在同一个宿主 context 上被 apply 两次，但无法阻止两个 loader entry 各自创建独立的子 context 并分别启动。

### 方案 C（发布流程）：在 `dsh.profile.bundles` 中只放无 bundle patch 的插件

不带 `dsh.bundle.patch` 的插件（如 `dsh-llm-fallbacks`、`dshmarket`）可以安全地加入 `bundles` 列表。
自带 `dsh.bundle.patch` 的插件应该通过 `dsh plugin add` 安装，或者由用户手动 insert。

## 修复记录

- **修复日期**：2026-08-22
- **修复形态**：方案 B 增强版 —— `lib/index.js` apply() 入口的进程级单实例守卫。
- **回归测试**：`test/duplicate-load.test.js`（4 用例）。

### 实现要点

1. **进程级注册表**：`globalThis[Symbol.for('dsh-game-studio.active')]` 存放 `{ token }`
   标记，`token` 为首个实例 apply 时生成的 `randomUUID()`。
2. **第二实例整体 no-op**：apply() 开头（任何注册之前）检测标记已存在且 token 不同时，
   经 `ctx.logger?.warn`（退回 `console.warn`）打印一次明确告警（含双加载诊断、
   「两种安装路径二选一」指引、指向本文档），随后**整体 return**——不注册任何
   commands/tools/skills/settings/hooks/section，因此不再有
   `tool "xxx" is already registered` 噪声，也不会覆盖首个实例的行为。
3. **token 化 dispose 释放**：首个实例经
   `ctx.effect(() => () => { 若标记 token === 自己的 token 则删除标记 }, 'dsh-game-studio: single-instance guard')`
   注册清理。卸载/HMR 重载时 Cordis fiber dispose 回调 cleanup 释放标记，之后的
   apply 可正常加载；后启动实例即使残留任何 cleanup 被调用，token 比对不通过，
   不会误清前者的标记。
4. **effect 注册时机**：守卫 effect 在 apply 同步段、任何其他注册之前注册，
   保证第二实例被拒时第一实例的清理链完整。
5. **降级路径**：宿主 ctx 无 `effect`（真实 Cordis Context 恒有；仅极简测试 mock
   可能缺失）时守卫不启用——无法保证卸载释放标记时，宁可不拦截也不留永久标记。

### 为什么普通 Map/WeakSet 挡不住两个 loader entry

原方案 B 的模块级 `APPLIED` 集合有两个盲区：

1. **两份模块实例**：link 安装（`~/.dsh/profiles/node_modules/` symlink）与 bundle 安装
   可能以不同 specifier / 不同真实路径解析同一入口文件，Node ESM 缓存按解析后 URL 区分，
   会加载**两份独立的模块实例**——各自的模块级 `Map`/`WeakSet` 互不可见，双方都以为自己是
   第一个。`Symbol.for` 走的是**进程级 symbol registry**，跨模块副本命中同一个键，
   `globalThis` 上的标记对两份副本同时可见。
2. **两个独立子 context**：两个 loader entry 各自创建独立的子 context，`APPLIED.has(ctx)`
   对不同 ctx 恒为 false。进程级标记不以 ctx 为键，天然覆盖该场景。

### cordis effect 语义核实（vendor/cordis/src/fiber.ts）

`Fiber#effect(execute, label)`（fiber.ts:402-441）：`execute` 立即运行，其返回的
disposer 被收集，在「返回的 disposer 被调用」或「fiber unload」时逆序执行（二者取先），
重复调用为 no-op。即插件卸载（loader entry 删除 / HMR 重载）时 cleanup 必然被回调，
守卫标记的释放有保证。`lib/index.js` 既有代码（settings watcher effect）已依赖同一语义。

### 验收结果

- `node --check lib/index.js` ✅
- `node --test test/*.test.js`：**118 全绿**（原 114 + 新增 4，无回归）
- 新增用例覆盖：双加载第二实例零注册且告警（含 '0002'/'双加载'）；第一实例 effect
  cleanup 后重新 apply 正常注册（HMR 不误伤）；token 保护（被拒实例的 cleanup 不清
  前者标记）；测试间 `globalThis[Symbol.for(...)]` 清理（beforeEach/afterEach）。

## 验收测试

1. 安装后检查 `dsh --profile web --dump-config` 中该插件的 `id` 是否只出现一次。
2. 检查启动日志中是否有 `"xxx is already registered"`。
3. 检查 Web 设置卡中的配置值是否与 `cordis.patch.yml` 中的 config 一致（而非 bundle 默认值）。

## 关联

- `docs/design/00-dsh-integration-contract.md` §3「社区插件打包与安装」应补充双加载风险说明。
- 本仓库 README 安装说明应包含双加载警告。