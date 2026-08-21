/**
 * DSH Game Studio — 插件入口（V0.1 骨架）。
 *
 * 设计文档：docs/design/00-dsh-integration-contract.md（机制事实）
 *            docs/design/01-architecture.md（总体架构）
 *
 * 当前状态：M0 骨架 —— 仅验证「可加载 / 可卸载 / 可配置」链路。
 * 后续里程碑（docs/design/10-roadmap-v0.1.md）在此逐步填充：
 *   M2 命令面 + 状态 + 引擎检测
 *   M3 Registry + Orchestrator 工具面
 *   M4 Verifier + 质量门 + Git
 *   M5 打磨与发布
 */

import { createRequire } from 'node:module'

export const name = 'dsh-game-studio'

/**
 * 硬依赖注入。V0.1 骨架阶段不强制任何服务；
 * 后续按需扩展：['commands']、['tools']、['skills']、['subagents']…
 */
export const inject = []

const require = createRequire(import.meta.url)

/**
 * 加载并校验插件配置（schemastery）。
 * @param {import('@deepseek-ai/cordis').Context} ctx
 * @param {Record<string, unknown>} [config]
 */
export function apply(ctx, config = {}) {
  const entry = resolveConfig(config)

  // 标记插件已加载（启动日志可见，供安装链路验证）
  ctx.logger?.info?.(`[dsh-game-studio] loaded (reviewMode=${entry.reviewMode})`)

  // V0.1 骨架：提供状态查询服务，供后续模块与外部探测使用。
  ctx.provide?.('gameStudio', {
    version: '0.1.0',
    reviewMode: entry.reviewMode,
    status: () => Object.freeze({
      loaded: true,
      version: '0.1.0',
      reviewMode: entry.reviewMode,
      verify: entry.verify,
    }),
  })

  // 后续里程碑在此挂载：
  //  - ctx.inject(['commands'], commandCtx => commandCtx.commands.register({...}))  // /game
  //  - ctx.inject(['skills'], skillCtx => skillCtx.skills.registerProvider(...))     // 73 skills
  //  - ctx.tools.register(defineTool({...}))                                         // 六个模型工具
  //  - ctx.on('agent/session-start', ...) / tools/pre-execute 等监听器                // hooks
}

/**
 * 解析并校验插件配置（与 cordis.patch.yml 的 config 块对齐）。
 * @param {Record<string, unknown>} [config]
 */
function resolveConfig(config = {}) {
  const verify = config.verify ?? {}
  return Object.freeze({
    reviewMode: String(config.reviewMode ?? 'lean'),
    verify: Object.freeze({
      maxRepairRounds: Number(verify.maxRepairRounds ?? 2),
    }),
    engines: Object.freeze(config.engines ?? {}),
    models: Object.freeze(config.models ?? {
      orchestrator: null,
      lead: null,
      specialist: null,
      verifier: null,
      utility: null,
    }),
  })
}

// 引用 createRequire 结果，避免未使用告警；后续模块从这里解析 assets 路径。
void require
