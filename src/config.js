/** Settings schema and strict config normalization for DSH Game Studio. */

export const SETTINGS_NAMESPACE = 'dsh-game-studio'

export async function registerSettings(ctx, baseConfig, onUpdate, onDetach = () => {}) {
  const { default: z } = await import('@deepseek-ai/schemastery')
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
