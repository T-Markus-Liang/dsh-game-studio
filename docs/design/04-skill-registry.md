# 04 — Skill Registry（73 个工作流，internal capabilities）

> 前置阅读：[00 §7 ctx.skills](00-dsh-integration-contract.md)、[02 命令与 UX](02-command-ux.md)。

## 1. 设计原则

- **73 个 skill 全部保留，但用户层零暴露。** 用户只见 `/game <sub>`；skill 是
  Orchestrator 与被派发 agent 的内部弹药。
- DSH 的 `ctx.skills` 邀约策略四象限（00 §7）是现成机制：本插件注册的 skill 一律
  `{ modelInvocable: true, userInvocable: false }`——模型目录可见、用户命令目录不可见。
- **不复制 skill 全文进任何 persona 或工具描述。** 模型经 `skill` 工具按需加载
  （`<skill_content>` 块，DSH 统一渲染）；派发 subagent 时由 Orchestrator 把选中 skill
  的渲染结果拼进 prompt（03 §4.3）。

## 2. Provider 注册

用 `ctx.skills.registerProvider()` 注册单一 provider（名字 `game-studio`），扫描插件自带
`assets/skills/`（**插件安装目录，不是用户工作区**——skill 随插件版本走，升级即更新）：

```js
ctx.inject(['skills'], (skillCtx) => {
  skillCtx.skills.registerProvider(({ signal, invalidate }) => ({
    name: 'game-studio',
    // 实现时按 packages/skill/skill/src 的 provider 契约核对方法签名；
    // 行为要求：列出 assets/skills/*/SKILL.md，全部 modelInvocable:true / userInvocable:false
  }))
})
```

注意：`dsh-skill-filesystem` 只扫本地 project/custom/user 根，不认插件资产目录，
所以必须自写 provider（参照其实现，代码量小）。

## 3. 磁盘格式（沿用原项目 SKILL.md，frontmatter 清洗）

```
assets/skills/<id>/SKILL.md
```

原 frontmatter 处理（09 号文档统一执行）：

| 原字段 | 处理 |
|---|---|
| `name` / `description` | 保留（DSH 目录用 description 渲染条目，控制 ≤2 句） |
| `argument-hint` | 保留为文档，不进目录 |
| `user-invocable: true` | → **一律改为 false**（用户层只有 /game） |
| `allowed-tools` | 丢弃（工具面由 dispatch 的 toolFilter 决定） |
| `model:` | 丢弃（模型由 Config.models 决定） |
| 正文 `.claude/` 路径、AskUserQuestion、Claude 命令引用 | 按 09 清洗表重写为 DSH 对应物 |

## 4. manifest 索引（与 agents 同文件）

```jsonc
{
  "id": "dev-story",
  "kind": "skill",
  "category": "develop",        // start|design|prototype|develop|debug|review|test|perf|release|team|meta
  "workflows": ["build"],       // 被哪些 /game 子命令的工作流引用
  "phase": "IMPLEMENT",         // Game Dev Loop 阶段（01 §6），可多值
  "roles": ["specialist"],      // 默认交给哪类角色执行
  "summary": "…",
  "file": "skills/dev-story/SKILL.md"
}
```

## 5. Workflow → Skill 序列（Orchestrator 的编排表）

`src/orchestrator/workflows.js`（纯数据）：

```js
export const WORKFLOWS = {
  build:  { phases: ['IMPLEMENT','BUILD','TEST','VERIFY','GATE','COMMIT'],
            skills: { plan: 'create-stories', implement: 'dev-story', review: 'code-review' },
            gates:  ['build-pass','tests-pass','verifier-pass'] },
  debug:  { skills: { triage: 'bug-triage', fix: 'dev-story', regression: 'regression-suite' },
            gates:  ['tests-pass','no-regression','verifier-pass'] },
  test:   { skills: { plan: 'qa-plan', run: 'smoke-check', evidence: 'test-evidence-review' },
            gates:  ['tests-pass'] },
  review: { skills: { solo: null, lean: 'code-review', studio: 'architecture-review' },
            gates:  ['verifier-pass'] },
  // design/prototype/perf/ship → V0.2，编排表结构已预留
}
```

73 个 skill 里 V0.1 主干只直接引用 ~10 个；其余全部进目录供模型按需取用
（`team-*` 编排类 skill 在 V0.1 标记 `modelInvocable: false` 冻结，防止模型绕过
Orchestrator 自开董事会；V0.2 评估解冻）。

## 6. Token 成本控制

- 目录条目成本 = 73 × (name + ≤2 句 description)。若实测目录过重：provider 按
  「当前 workflow 相关 category」动态过滤（`skills/change` 失效通知 + 重新 snapshot 是
  现成机制，00 §7）。V0.1 先全量，量了再说。
- skill body 只在两处出现：模型显式 `skill` 工具加载；dispatch prompt 拼接。都是按需。

## 7. 测试要点

- provider 契约测试：snapshot 返回 73 条、全部 userInvocable=false、body 可加载且
  渲染为合法 `<skill_content>`。
- 编排表引用完整性：WORKFLOWS 引用的每个 skill id 都在 manifest 中存在。
- 清洗断言：任何 SKILL.md 不含 `.claude/`、`AskUserQuestion`、`allowed-tools`。
