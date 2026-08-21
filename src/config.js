/** Settings schema and strict config normalization for DSH Game Studio. */

export const SETTINGS_NAMESPACE = 'dsh-game-studio'

/**
 * @param {Object} ctx
 * @param {Object} baseConfig
 * @param {(value: Object) => void} onUpdate
 * @param {() => void} [onDetach]
 * @param {() => Object} [getZ] - Optional factory returning a schemastery-compatible `z`.
 *                                Defaults to importing from @deepseek-ai/schemastery.
 */
export async function registerSettings(ctx, baseConfig, onUpdate, onDetach = () => {}, getZ) {
  const z = typeof getZ === 'function' ? getZ() : (await import('@deepseek-ai/schemastery')).default
  const modelTarget = z.object({ provider: z.string(), model: z.string() })
  const schema = z.object({
    reviewMode: z.string().default('lean'),
    verify: z.object({
      maxRepairRounds: z.number().step(1).min(0).default(2),
    }).default({ maxRepairRounds: 2 }),
    engines: z.dict(z.any()).default({}),
    models: z.object({
      orchestrator: modelTarget,
      lead: modelTarget,
      specialist: modelTarget,
      verifier: modelTarget,
      utility: modelTarget,
    }).default({}),
  })
  const scope = ctx.settings.register(SETTINGS_NAMESPACE, schema, { base: baseConfig, applies: 'live' })
  const update = () => onUpdate(scope.get())
  update()
  ctx.effect(() => {
    const dispose = scope.watch(update)
    return () => {
      dispose()
      onDetach()
    }
  }, 'dsh-game-studio: settings watcher')
}
