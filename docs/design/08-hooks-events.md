# 08 — Hooks 事件映射（原 12 hook → DSH 事件总线）

> 前置阅读：[00 §9 事件总线](00-dsh-integration-contract.md)。
> 原项目 hook 是 `.claude/settings.json` 驱动的 shell 脚本；DSH 没有该机制（00 §11）。
> **V0.1 不走 `dsh-hooks-claude-code` 桥**，全部改写为插件内原生监听器（`src/hooks/`）——
> 原因：桥为兼容而生，原生监听器才能拿到 typed decision 与结构化上下文。

## 1. 逐一映射表

| 原 hook（shell） | 原触发 | DSH 原生实现 | V0.1 |
|---|---|---|---|
| `session-start.sh` | SessionStart | `agent/session-start` 监听：读 06 状态 → 若引擎项目则注入 system prompt section（02 §5） | ✅ |
| `session-stop.sh` | Stop | `turn/end` / agent dispose effect：把内存态 flush 到状态目录（06 本就随写随落，此处仅兜底） | ✅ |
| `pre-compact.sh` | PreCompaction | **不需要**：06 §3 的设计让状态天然跨 compaction（section 指针 + 落盘）。保留一个 `session/event` compaction 观测器写 decisions.jsonl 审计行 | ✅(审计) |
| `post-compact.sh` | PostCompaction | 同上——压缩后模型首次工具调用即可经 `game_studio_status` 重建全景，无需主动恢复 | –（由 06 吸收） |
| `log-agent.sh` | SubagentStart | `game_studio_dispatch` 内部直接写 decisions.jsonl（kind: dispatch）——派发本来就走我们的代码，不需要事件旁路 | ✅ |
| `log-agent-stop.sh` | SubagentStop | 同上（dispatch await 返回处写 kind: dispatch-done + outputSchema 结果摘要） | ✅ |
| `validate-commit.sh` | PreToolUse(git commit) | 升级为 07 §6 Commit Gate（确定性代码路径）；另加 `tools/pre-execute` 兜底：拦 bash `git commit/push`，任务上下文中未过 gate → deny + 提示走 `/game review` | ✅ |
| `validate-push.sh` | PreToolUse(git push) | `tools/pre-execute` 拦 push → 一律 `ask`（经 ctx.approval，00 §10）；V0.1 政策：插件永不自动 push（07 §6） | ✅ |
| `validate-assets.sh` | PostToolUse(Write) | `tools/post-execute` 观测 write/edit：命中资产扩展名 → 跑 asset 规则（09 迁移），违规 → 附加模型可见警告上下文（不回滚，gate 兜底） | ✅ |
| `detect-gaps.sh` | 会话扫描 | 降级为 `/game status` 的一个报告段（检测 scope 外改动、未测试文件）；不做常驻扫描 | V0.2 |
| `validate-skill-change.sh` | Write(.claude/skills) | 转生为**本仓库 CI**：assets/ 清洗断言（04 §7、09 §5），运行时无此事件 | ✅(CI) |
| `notify.sh` | Notification | DSH UI 自带会话通知；插件不重复实现 | – |

## 2. 规则注入（原 11 条路径规则的运行时化）

原项目 `rules/*.md` 按文件路径生效（gameplay-code.md、shader-code.md…）。DSH 实现：

- `assets/manifest.json` 中每条 rule 带 `globs: ["**/*.gd", "src/gameplay/**"]`。
- **派发时机**（主路径）：`game_studio_dispatch` 组装 persona 时，按 contract.scope 命中
  的 rules 直接拼进 persona（03 §4.3）——规则在 agent 开工前就在场。
- **写入时机**（兜底）：`tools/post-execute` 观测到 write/edit 命中 glob 而对应规则未注入
  → `agent.inject()` 补一条规则摘要（00 §5 异步通知语义，非唤醒）。
- 规则文本控制在每条 ≤40 行（09 清洗时压缩），避免 persona 膨胀。

## 3. 监听器纪律

- 全部监听器**幂等且吞不掉错误**：自身异常 catch + 写 issues.jsonl，绝不 veto 无关流程
  （DSH 观测器语义：listener 失败不得饿死后续，00 §7 skills/change 同理）。
- `tools/pre-execute` 只做**deny/ask 白名单内**的事（git commit/push 拦截），不做泛化
  权限系统——那是宿主 approval/sandbox 的领地（00 §10）。
- 所有注册经 `ctx.on(...)` / 瀑布注册，卸载即解除（Cordis effect，00 §3.4）。

## 4. 测试要点

- commit 拦截：未过 gate 的 bash `git commit` → deny 且提示文案正确；过 gate 放行。
- push 一律 ask。
- 资产写入 → 规则警告注入一次（不重复轰炸：同任务同规则去重）。
- 监听器抛错不影响工具正常执行（注入故障断言）。
