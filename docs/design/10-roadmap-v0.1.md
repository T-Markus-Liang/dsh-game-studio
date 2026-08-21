# 10 — V0.1 路线图、验收标准与实现指令

> 本文档是给实现模型的**执行入口**。读完 00（必读）后按里程碑顺序做，每个里程碑
> 有独立验收标准，做完一个提交一个。

## 0. 全局约束（违反即返工）

1. 只使用 [00 号契约](00-dsh-integration-contract.md) 列出的 DSH 机制；用到任何未列机制，
   先到 `/Users/markus/deepseek-harness` 核实源码并把结论补进 00 号文档（PR 一并提交）。
2. 纯 ESM JavaScript + JSDoc；DSH 包一律 peerDependencies；Node ≥ 22.13；
   `node --check` + `node --test` 必须全绿。
3. 分层纪律（01 §2）：agents/skills/rules/tools/gates 互不内联。
4. 确定性优先：能用代码判定的绝不请模型；能 enum 的参数绝不自由文本。
5. 所有对模型的输出讲预算：digest 不超 40 行、目录条目 ≤2 句、日志走文件指针。
6. 每个里程碑附测试；测试要点已写在各设计文档末节。

## 1. 里程碑

### M0 — 仓库与打包骨架（½ 天）
- 按 01 §3 目录建骨架；package.json（00 §3.1）、cordis.patch.yml（00 §3.2）、
  `lib/index.js` 空插件（name/inject/apply + Config schema 占位）。
- **验收**：本地 link 安装（00 §3.3 路径 2）后，DSH web 启动日志出现插件加载行；
  从补丁层删行即卸载无残留。

### M1 — 资源迁移（1 天）
- `scripts/migrate.mjs` + `migration-rules.json`（09 号文档全部规则）；
  固定上游 commit 克隆 → 生成 `assets/` + `manifest.json` + `migrate-report.md`。
- **验收**：09 §5 的 CI 断言全绿；复核清单逐条处理完毕。

### M2 — 命令面 + 状态 + 引擎检测（1–2 天）
- `/game` 命令注册与子命令分发（02）；`src/state/`（06）；`src/engines/detect.js` +
  Godot 适配器完整实现，Unity/UE detect+模板（05）。
- **验收**：在三个 fixture 项目中 `/game start` 正确检测引擎并建状态目录；
  `/game status`、`/game mode` 零 token 往返；detect/parseLog 表驱动测试绿。

### M3 — Registry + Orchestrator 工具面（2 天）
- Agent/Skill registry 加载器（03、04）；skills provider 注册；六个模型工具（02 §4）；
  路由表 + 选配算法（03 §4）；WORKFLOWS 编排表（04 §5）。
- **验收**：03 §8、04 §7 测试绿；真实会话中 `/game build <desc>` 能走完
  route → dispatch（specialist 真实产出 outputSchema 结构化结果）。

### M4 — Verifier + 质量门 + Git（2 天）
- Gate 引擎全部确定性 gate（07 §2）；Verifier 派发与裁决判定（07 §3）；修复回路；
  Commit Gate；hooks 监听器（08：commit/push 拦截、资产规则、审计行）。
- **验收**：07 §7、08 §4 测试绿；端到端演练（§2）通过。

### M5 — 打磨与发布（1 天）
- system prompt section（02 §5）；`/game agents|skills`；README 使用文档；
  `dsh plugin add` 冒烟（GitHub 私仓或本地 tarball）；版本 0.1.0 打 tag。
- **验收**：§1.1「发布检查清单」逐项通过；Release 工作流在 tag 推送后自动产出
  GitHub Release，changelog 与 commit 一致。

#### M5.1 发布检查清单（V0.1 Release 前逐项核对）

> 配套基建已就绪：`.github/workflows/ci.yml`（push/PR 自动测试）与
> `.github/workflows/release.yml`（tag 触发 → 版本校验 → 测试 → 自动 changelog →
> GitHub Release）。发布路径 = 本清单通过后打 tag 推送。

**版本与 tag（硬性校验，Release 工作流会拒绝不一致）**
1. `package.json` 的 `version` 与即将打的 tag **完全一致**：`git tag v0.1.0` ↔
   `"version": "0.1.0"`（工作流的 `Verify version matches tag` 步骤强校验，不一致即失败）。
2. 变更分级符合 semver 预期：破坏性变更 → minor bump 并在 changelog 标注；纯修复/新
   功能 → patch/minor；**V0.1 仍是 pre-release 形态时建议保留 `0.x` 并接受任意 break**。
3. 打 tag 前 `git status` 干净（无未提交改动）；tag 打在 `main` 的最新提交上，
   不追中间 commit。

**代码与测试**
4. `node --check lib/*.js` 全绿；`node --test test/*.test.js` 全绿（CI 同样强制）。
5. `npm pack --dry-run` 检查发布包内容：包含 `lib/`、`assets/`、`cordis.patch.yml`、
   `LICENSE`、`README.md`，**不包含** `.github/`、`test/`（files 白名单生效）。
6. 无 TODO/FIXME 遗留（grep 确认）；README 使用文档与当前命令面一致。

**安装链路（卸载 = 删行，语义不变）**
7. `dsh plugin add "github:T-Markus-Liang/dsh-game-studio"` 冒烟通过，插件加载行出现
   在 DSH 启动日志。
8. 从补丁层删行 → 命令/工具/skill 目录全部消失，无报错残留（验证可卸载）。

**仓库卫生**
9. LICENSE（MIT）与 README 致谢段在 repo 根；`docs/design/` 全套设计文档随包发布
   （设计即文档，公开可读）。
10. GitHub topics 已配置（deepseek-harness, dsh-plugin, game-development, unity,
    unreal-engine, godot, ai-agents, verifier…）；Release 描述用 changelog 自动生成。

**发布动作（全部完成才打 tag）**
11. 提交所有改动到 `main` 并推送。
12. `git tag v0.1.0 && git push origin v0.1.0` → Release 工作流自动跑
    版本校验 → 测试 → changelog → 创建 Release。
13. 到 Releases 页人工确认：标题 `dsh-game-studio v0.1.0`、changelog 完整、
    tag 已 verify；必要时补 pre-release 标记。
14. （可选）在 README 加「安装」徽章区（GitHub release 徽章 / 版本号），方便用户
    看到最新版。

> 后续版本（v0.2.0…）复用同一清单：改 `package.json` version → 按 semver 分级
> changelog 期望 → 打对应 tag → 推送。清单第 1 条是硬门槛，其余按实际迭代收敛。

规模预估：src/ 约 2500–4000 行 JS + 测试；assets/ 为生成物。
发布路径：M5 验收后按 §1.1 清单打 tag → Release 工作流自动出包（见 M5.1）。

## 2. 端到端验收演练（V0.1 的 Definition of Done）

在一个最小 Godot fixture 项目（含 1 个故意 bug + GUT 测试）中，全程只用 DSH Web GUI：

1. `/game start` → 检测出 godot + 版本，建 `.dsh/game-studio/`，引导语正确。
2. `/game debug 玩家偶发双跳` → 模型调 `game_studio_route`（分类落在 enum 内）→
   `game_studio_dispatch` 派发 specialist（persona/toolFilter/outputSchema 断言可查
   decisions.jsonl）→ specialist 改代码。
3. gates：build-pass、tests-pass 由真实 godot headless 运行判定；scope-clean 生效
   （故意越界写文件 → FAIL 演示一次）。
4. Verifier 独立裁决（decisions.jsonl 可见裁决 JSON；verifier 无 write 工具）。
5. 全绿 → 自动 commit（消息含 gate 摘要）；`git log` 与 `/game status` 一致。
6. 手动 bash `git push` → 被 ask 拦截。
7. 关掉会话重开 → `/game status` 完整恢复；触发一次 compaction → 任务不丢。
8. 从补丁层移除插件 → 命令、工具、skill 目录全部消失，无报错残留。

## 3. V0.2 展望（不做，只留接口）

- PLAYTEST/视觉 QA：引擎 run + 截图 → 视觉模型报告（01 §6；本机已有图像桥）。
- Unity/UE build+test 补全；`/game design|prototype|perf|ship`；Director Gate 默认启用
  评估；best-of-N 深度集成（07 §4）；team-* skills 解冻评估（04 §5）；
  detect-gaps 报告（08 §1）；`/game start` 生成项目骨架（09 §6）。

## 4. 风险与对策

| 风险 | 对策 |
|---|---|
| DSH pre-release API 漂移 | 00 号文档标注来源；CI 对 DSH rc 冒烟；peer 版本宽松 |
| subagent provider 具体签名与文档出入 | M3 开工第一件事：读 `packages/subagent/subagent/src/types.ts` 对齐，出入回写 00 |
| skills provider 契约细节 | 同上：照抄 `dsh-skill-filesystem` 实现骨架 |
| 73 目录 token 实测过重 | 04 §6 的动态过滤预案 |
| 引擎二进制不在 CI | 集成测试 optional-skip（05 §8），本地演练兜底 |
| 模型不听 route 流程 | enum schema 收窄 + section 引导 + 命令路径可完全绕开模型自由发挥 |
