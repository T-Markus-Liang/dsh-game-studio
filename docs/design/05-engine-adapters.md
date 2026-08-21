# 05 — Engine Adapters（Unity / UE5 / Godot）

> 前置阅读：[00 §5 工具](00-dsh-integration-contract.md)、[02 §4 工具面](02-command-ux.md)。
> 定位：把原项目的引擎「专家 prompt」升级为真正的**工具链适配器**——检测、构建、测试、
> 运行、日志解析全部是确定性代码；prompt 只负责领域知识（那是 03 的引擎专家 agent）。

## 1. 统一接口（`src/engines/types.js`，JSDoc typedef）

```js
/**
 * @typedef {Object} EngineAdapter
 * @property {string} id                      // 'unity' | 'unreal' | 'godot'
 * @property {(cwd) => Promise<Detection|null>} detect     // null = 不是本引擎
 * @property {(cwd, det, opts) => Promise<StepResult>} build
 * @property {(cwd, det, opts) => Promise<StepResult>} test
 * @property {(cwd, det, opts) => Promise<StepResult>} run  // headless/编辑器运行（V0.2 playtest 用）
 * @property {(raw: string) => LogDigest} parseLog          // 错误/警告结构化摘要
 * @property {string[]} assetRules                          // 命中的 rules 文件 id（08 注入用）
 */
// Detection: { engine, version, projectRoot, projectFile, evidence[] }
// StepResult: { ok, exitCode, durationMs, logPath, digest: LogDigest, artifacts[] }
// LogDigest: { errors: [{code?, file?, line?, message}], warnings: […], summary }
```

执行约束：
- 构建/测试是长任务 → 一律后台 job + 全量日志落 `.dsh/game-studio/logs/<ts>-<step>.log`，
  **只把 digest 回给模型**（02 §4 原则）。
- 命令模板全部可配（Config.engines.*.buildCommand 等覆盖位），默认值见 §3–5。
- 找不到引擎可执行文件时：`StepResult.ok=false` + 明确的安装/配置指引，不静默降级。

## 2. 检测算法（`src/engines/detect.js`）

按证据打分，多引擎命中时取分高者并在状态里记录竞争项：

| 引擎 | 强证据（各 +10） | 弱证据（各 +2） |
|---|---|---|
| Unity | `ProjectSettings/ProjectVersion.txt`（含版本，直接读出）、`Assets/` + `Packages/manifest.json` 同存 | `*.unity`、`*.asmdef`、`Library/` |
| Unreal | `*.uproject`（JSON，读 EngineAssociation 得版本） | `Content/`、`Config/DefaultEngine.ini`、`Source/` |
| Godot | `project.godot`（INI，读 config/features 得版本） | `*.gd`、`*.tscn`、`.godot/` |

- 从 cwd 向上最多 3 层 + 向下 1 层扫描（monorepo 里游戏在子目录的常见情形）。
- 结果缓存 `.dsh/game-studio/state/project.json`；`/game start` 与
  `game_studio_engine{action:detect}` 强制刷新。
- 全部落空 → `engine: "unknown"`，工作流仍可跑（跳过 build/test gate，仅剩 Verifier）。

## 3. Godot 适配器（V0.1 唯一做完整 build/test 的引擎）

选 Godot 打样的理由：CLI 最干净、免许可、headless 原生支持，能以最小成本验证适配器模式。

| 步骤 | 默认命令 |
|---|---|
| 可执行发现 | `godot`/`godot4` in PATH → Config 覆盖 `engines.godot.bin` |
| build（导出前检查） | `godot --headless --check-only`（逐 .gd 语法检查）+ `--export-pack` 可选 |
| test | GUT：`godot --headless -s addons/gut/gut_cmdln.gd -gexit`；gdUnit4：`--headless -s addons/gdUnit4/bin/GdUnitCmdTool.gd`；两者都没有 → `ok:true, skipped:true` 并在 gate 中记「无测试框架」 |
| run | `godot --headless --quit-after <n>`（冒烟）；V0.2 加截图 |
| parseLog | 匹配 `SCRIPT ERROR:`、`ERROR:`、`Parse Error:` + `res://` 路径行 |

## 4. Unity 适配器（V0.1 只做 detect + 命令模板，V0.2 补全）

| 步骤 | 默认命令模板 |
|---|---|
| 可执行发现 | Unity Hub 布局：macOS `/Applications/Unity/Hub/Editor/<ver>/…`；ver 来自 ProjectVersion.txt；Config 覆盖 |
| build | `Unity -batchmode -nographics -quit -projectPath <root> -executeMethod <BuildScript>`（需项目内 build 脚本，文档写明约定） |
| test | `Unity -batchmode -runTests -testResults <xml> -testPlatform EditMode`（解析 NUnit XML） |
| parseLog | `error CS\d+`、`Exception`、Burst/Shader 错误模式 |

## 5. Unreal 适配器（V0.1 只做 detect + 命令模板，V0.2 补全）

| 步骤 | 默认命令模板 |
|---|---|
| 可执行发现 | `.uproject` 的 EngineAssociation → 标准安装路径 / Config 覆盖 `engines.unreal.engineRoot` |
| build | `RunUAT BuildCookRun -project=<uproject> -build`（或 UBT 直调） |
| test | `UnrealEditor-Cmd <uproject> -ExecCmds="Automation RunTests <filter>" -unattended -nullrhi -log` |
| cook | `RunUAT -cook`（V0.2） |
| parseLog | `Error:`、`Fatal error`、`LogInit`/`LogAutomationController` 结果行 |

## 6. `game_studio_engine` 工具（模型入口，02 §4）

```
action: detect | build | test | run | logs
→ detect: 返回 Detection
→ build/test/run: 后台执行 → { ok, digest, logPath }（digest ≤ 40 行）
→ logs: 按 logPath + 过滤器返回片段（分页，防灌上下文）
```

`/game test` 命令走同一适配器（命令层直接调，不经模型）。

## 7. 扩展契约

新引擎 = 新增一个实现 EngineAdapter 的模块 + registry 注册一行 + rules 文件。
适配器不 import 任何 agent/skill 内容（分层纪律，01 §2）。

## 8. 测试要点

- detect 表驱动：伪造三种项目树（fixtures/）断言引擎+版本；多引擎共存取分高者。
- parseLog 快照：真实日志样本 → digest 稳定。
- 命令模板渲染：Config 覆盖生效；缺可执行文件时的错误信息可操作。
- Godot 集成测试标记 optional（CI 无 godot 则 skip，不红）。
