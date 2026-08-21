# 06 — 持久化状态（Persistent Task State）

> 前置阅读：[00 §10 Compaction/Goal](00-dsh-integration-contract.md)。
> 核心原则：**凡是必须跨 compaction、跨 session、跨 agent 存活的信息，一律落文件；
> 对话上下文只是缓存。** DSH 自动压缩挂在 `agent/pre-step`，插件不假设对话完整。

## 1. 目录布局（游戏项目工作区内）

```
<project>/.dsh/game-studio/
├── state/
│   ├── project.json          # 引擎检测结果 + 项目元数据（05 §2）
│   ├── review-mode           # solo|lean|studio 单行文本（01 §7）
│   ├── active-task.json      # 当前任务（§2，同一时刻至多 1 个）
│   ├── decisions.jsonl       # 追加型：路由决策、gate 裁决、模型选择
│   └── issues.jsonl          # 追加型：blocked 项、回归、技术债
├── verification/<taskId>/    # 每任务的证据包：diff 摘要、测试输出、verifier 裁决 JSON
├── logs/                     # 引擎 build/test 全量日志（05 §1）
└── playtests/                # V0.2：截图、指标、录制帧
```

- `vision.md` / `architecture.md` 等设计文档**不放这里**——它们属于项目本身
  （`design/`、`docs/`），由 design 类 skill 管理；`.dsh/game-studio/` 只放运行时状态。
- 写入全部经 `src/state/` 模块的白名单操作（02 §4 `game_studio_state`），原子写
  （tmp+rename），JSONL 只追加。
- `.gitignore` 建议：`logs/` 与 `playtests/` 忽略，`state/` 与 `verification/` 可选入库
  （团队共享任务状态）——由 `/game start` 询问一次并写入。

## 2. active-task.json（Focus Contract 的持久化本体）

```jsonc
{
  "id": "2026-08-22-fix-double-jump",
  "workflow": "debug",                  // 04 §5 的 workflow id
  "phase": "IMPLEMENT",                 // Game Dev Loop 阶段（01 §6）
  "contract": {
    "goal": "修复角色跳跃偶发双跳",
    "scope": ["src/gameplay/movement/**"],
    "input": ["bug report", "logs/2026-08-22-test.log"],
    "output": "minimal patch",
    "done": ["tests pass", "no regression"]
  },
  "engine": { "id": "godot", "version": "4.3" },
  "reviewMode": "lean",
  "git": { "branch": "game/fix/double-jump", "checkpoint": "abc1234" },
  "agents": [ { "role": "specialist", "id": "gameplay-programmer", "status": "done" } ],
  "gates": { "tests-pass": "PASS", "verifier-pass": "PENDING" },
  "completed": ["triage"],
  "next": "run regression suite",
  "updatedAt": "2026-08-22T10:30:00Z"
}
```

生命周期：workflow 命令创建 → 每阶段更新 phase/gates/next → 全 gate PASS 且 commit 后
归档到 `decisions.jsonl` 并清空。新任务发现旧 active-task 未完 → `/game status` 提示
续做或归档（不静默覆盖）。

## 3. 恢复路径（精神分裂防线）

1. **会话内 compaction**：`ctx.systemPrompt.section()` 注入的项目 section（02 §5）
   只含指针（engine + active-task 摘要 ≤5 行），压缩后仍在；细节靠模型调
   `game_studio_status` 重新拉取。
2. **新 session / 重启**：`/game status` 或首次工具调用直接读盘重建全景。
3. **subagent**：dispatch prompt 自带 contract（03 §4.3），子 agent 不依赖父上下文。
4. **多轮长目标**：goal 轮次驱动（00 §10）每轮开始读 active-task.json，结束写回。

## 4. decisions.jsonl 行格式

```jsonc
{ "ts": "…", "taskId": "…", "kind": "route|dispatch|gate|verifier|commit|archive",
  "data": { /* kind 特定 */ } }
```

`/game status` 取末 N 行渲染时间线；09 号文档的 hooks 审计也写这里（原 log-agent.sh 职能）。

## 5. 测试要点

- 原子写：模拟中断不产生半个 JSON。
- 归档流转：active → decisions.jsonl → 新任务可建。
- 恢复：删内存态，仅凭目录重建 status 输出。
- 并发追加 JSONL 不互相吞行（同进程串行队列即可，跨进程不承诺）。
