# 07 — Verifier 与质量门

> 前置阅读：[00 §6 Subagent、§8 Verifier](00-dsh-integration-contract.md)、[06 状态](06-persistent-state.md)。
> 铁律：**写代码的不许判自己的卷子。** Coder 的「我检查过了」不构成任何 gate 证据。

## 1. 两级验证架构

```
Worker (specialist subagent)
   │ implementation
   ▼
Level 1: 确定性 Gates（零 LLM）        ← build-pass / tests-pass / scope-clean / …
   │ 全绿才有资格进入
   ▼
Level 2: Verifier（独立 LLM 裁判）      ← persona=verifier 的独立 subagent
   │
 ┌─┴─┐
FAIL  PASS
 │      │
repair  commit gate → git commit
(≤N 轮)
```

## 2. Level 1：确定性 Gate 引擎（`src/verify/gates.js`）

Gate = 纯函数 `(taskState, evidence) => { verdict: PASS|FAIL|SKIP, reasons[] }`：

| gate id | 检查 | 证据来源 |
|---|---|---|
| `build-pass` | 引擎 build StepResult.ok | 05 适配器 |
| `tests-pass` | 引擎 test ok 且 digest.errors 空 | 05 适配器 |
| `no-regression` | 本次失败集 ⊄ 基线失败集 | verification/<task>/ 基线 |
| `scope-clean` | `git diff --name-only` ⊆ contract.scope | git + 06 contract |
| `no-debug-junk` | diff 无 `print_debug`/`console.log`/TODO 泛滥（规则来自 assets/rules） | git diff |
| `asset-valid` | 触碰的资产通过原 validate-assets 规则（09 迁移） | git diff + 规则 |
| `verifier-pass` | Level 2 裁决 == PASS | §3 |

- workflow → gates 映射在编排表（04 §5）；`SKIP` 必须带原因并写进 decisions.jsonl
  （如「无测试框架」）——**跳过是显式记录的债，不是静默通过**。
- gate 结果写 `active-task.json.gates` + `verification/<taskId>/gates.json`。

## 3. Level 2：独立 Verifier subagent

### 3.1 派发方式（默认路径，零额外依赖）

- `provider: 'spawn'` **全新子 agent，绝不 fork 父历史**——防 coder 思路污染。
- `persona`：`assets/agents/qa-tester.md` 底稿 + verifier 追加段（09 迁移时生成
  `assets/agents/_verifier-overlay.md`）。
- `toolFilter: reviewer`（03 §5）：只读 + 跑测试，**无 write/edit**。
- 模型：`Config.models.verifier`（建议配置为 ≠ specialist 的模型，01 §8）。

### 3.2 输入（喂证据，不喂过程）

```
Task spec        ← contract（06）
Git diff         ← 完整 diff（超限则分文件摘要 + 可用工具自读）
Build/Test 输出  ← digest + logPath（可用 game_studio_engine logs 翻全文）
Game logs        ← 相关片段
Screenshots      ← V0.2（视觉 QA）
Perf metrics     ← V0.2
```

**不给**：coder 的对话史、coder 的自评、skill 全文。裁判读证据，不读辩护词。

### 3.3 裁决 outputSchema（强制结构化，00 §6）

```jsonc
{
  "type": "object",
  "required": ["verdict", "confidence", "reasons", "requiredFixes"],
  "properties": {
    "verdict": { "enum": ["PASS", "FAIL"] },
    "confidence": { "enum": ["high", "medium", "low"] },
    "reasons": { "type": "array", "items": { "type": "string" } },
    "requiredFixes": { "type": "array", "items": {
      "type": "object",
      "required": ["file", "issue", "severity"],
      "properties": { "file": {"type":"string"}, "issue": {"type":"string"},
                      "severity": { "enum": ["blocker", "major", "minor"] } } } },
    "notes": { "type": "string" }
  }
}
```

判定规则（确定性代码执行，不留给模型）：
- `verdict: FAIL` 或存在 `severity: blocker` → gate FAIL。
- 仅 minor 且 `confidence: high` PASS → PASS + issues.jsonl 记债。
- `confidence: low` 的 PASS 在 `studio` 模式下 → 升级 Director Gate（§5）。

### 3.4 修复回路

FAIL → `requiredFixes` 作为新 Focus Contract 的 INPUT 重派 specialist（同 persona 新
spawn，不续会话）→ 重跑 Level 1 → 重新裁决。最多 `Config.verify.maxRepairRounds`
（默认 2）轮；超轮 → active-task 标 blocked + issues.jsonl + 停下向用户汇报。
**修复轮永不跳过 Level 1。**

## 4. 可选增强：`ctx.verifier` best-of-N（检测到才启用）

本机已插入 `dsh-verifier-python`（00 §1）。当 `ctx.verifier` 服务在场且
`Config.verify.bestOfN.enabled`：
- `studio` 模式的核心任务可走 `best_of_n` 工具族路径：Git worktree 隔离生成 N 候选 →
  `ctx.verifier.select()` 锦标赛择优晋升（00 §8）。
- 服务不在场 → 静默走 §3 默认路径（探测式软依赖：`ctx.get?.('verifier')`，不 inject 硬依赖）。
- **best-of-N 择优不豁免 §3 裁决**：晋升的胜者仍要过独立 Verifier（select 是「谁更好」，
  不是「是否合格」）。

## 5. Director Gate（仅 studio 模式）

Level 2 之后追加：lead/director persona 的 reviewer subagent 读 verifier 裁决 + diff
摘要出终审（同 §3.3 schema）。用于核心系统/Release。V0.1 实现开关与链路，默认关闭。

## 6. Commit Gate（终点，确定性）

全部 gates PASS →
1. `git add`（限 contract.scope 命中文件 + 显式豁免清单）
2. commit message 模板：`<type>(<subsystem>): <goal>` + gate 摘要 + `Verified-by: game-studio`
3. 更新 active-task → 归档（06 §2）
4. **push 永不自动**：`/game ship`（V0.2）才碰远端，且需 approval（00 §10）。

## 7. 测试要点

- 各确定性 gate 表驱动用例（含 SKIP 语义与理由记录）。
- 裁决判定规则纯函数测试（blocker/minor/confidence 矩阵全覆盖）。
- 修复回路轮次上限与 blocked 流转。
- verifier 派发参数断言：provider=spawn、toolFilter=reviewer、无父历史。
- ctx.verifier 缺席时的降级路径。
