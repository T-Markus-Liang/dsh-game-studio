/** Small runtime guard for plugin tool JSON schemas.
 * DSH ToolRuntime validates tool output but intentionally does not validate
 * hand-authored ToolDefinition parameters. This guard keeps the plugin's
 * published JSON-schema contract enforceable without bundling DSH internals.
 */

export function validateToolArgs(schema, args) {
  if (!schema || schema.type !== 'object') return
  if (!args || typeof args !== 'object' || Array.isArray(args)) throw new TypeError('tool arguments must be an object')
  for (const key of schema.required || []) {
    if (!(key in args)) throw new TypeError(`missing required tool argument: ${key}`)
  }
  for (const [key, value] of Object.entries(args)) {
    const rule = schema.properties?.[key]
    if (!rule || value === undefined || value === null) continue
    if (rule.type === 'array' && !Array.isArray(value)) throw new TypeError(`${key} must be an array`)
    if (rule.type === 'object' && (typeof value !== 'object' || Array.isArray(value))) throw new TypeError(`${key} must be an object`)
    if (rule.type === 'string' && typeof value !== 'string') throw new TypeError(`${key} must be a string`)
    if (rule.type === 'boolean' && typeof value !== 'boolean') throw new TypeError(`${key} must be a boolean`)
    if (rule.type === 'integer' && !Number.isInteger(value)) throw new TypeError(`${key} must be an integer`)
    if (rule.enum && !rule.enum.includes(value)) throw new TypeError(`${key} must be one of: ${rule.enum.join(', ')}`)
  }
}

export function guardedTool(definition) {
  const execute = definition.execute
  return {
    ...definition,
    async execute(args, exec) {
      validateToolArgs(definition.parameters, args)
      return execute(args, exec)
    },
  }
}
