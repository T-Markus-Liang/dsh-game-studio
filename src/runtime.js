/**
 * DSH runtime helpers shared by commands, tools, hooks, and subagents.
 * The session header is the canonical workspace source for an agent.
 */

/**
 * Resolve an agent's project cwd without depending on client-only workspace APIs.
 * @param {import('@deepseek-ai/cordis').Agent|undefined|null} agent
 * @param {string} [fallback]
 */
export function resolveAgentCwd(agent, fallback = process.cwd()) {
  const cwd = agent?.session?.header?.cwd
  return typeof cwd === 'string' && cwd.length > 0 ? cwd : fallback
}

/**
 * Named, least-privilege child-tool policies from design/03-agent-registry.md.
 * These are host tool names, validated by DSH when a child is spawned.
 */
export const TOOL_PROFILES = Object.freeze({
  coder: Object.freeze({ allow: ['read', 'write', 'edit', 'glob', 'grep', 'bash', 'game_studio_engine', 'game_studio_state'] }),
  designer: Object.freeze({ allow: ['read', 'write', 'edit', 'glob', 'grep'] }),
  analyst: Object.freeze({ allow: ['read', 'glob', 'grep', 'bash', 'game_studio_engine'] }),
  reviewer: Object.freeze({ allow: ['read', 'glob', 'grep', 'game_studio_engine'] }),
})

/** @param {string|undefined} profile */
export function toolFilterFor(profile) {
  return TOOL_PROFILES[profile] || TOOL_PROFILES.coder
}
