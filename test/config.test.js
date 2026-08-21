import { test } from 'node:test'
import assert from 'node:assert/strict'
import { registerSettings, SETTINGS_NAMESPACE } from '../src/config.js'

/**
 * Create a minimal mock of schemastery's `z` that produces callable schemas
 * with default-value support.  Sufficient for testing registerSettings()
 * without pulling in the real @deepseek-ai/schemastery package.
 */
function mockZ() {
  /**
   * Build a chainable field function.
   * @param {unknown} value
   */
  function chain(value) {
    const fn = input => input !== undefined ? input : value
    fn._default = value
    fn.default = v => { fn._default = v; return fn }
    fn.step = () => fn
    fn.min = () => fn
    return fn
  }

  const z = chain(undefined)
  z.string = () => chain(undefined)
  z.number = () => chain(undefined)
  z.any = () => chain(undefined)
  z.dict = () => chain(undefined)

  z.object = (spec) => {
    const defaults = {}
    for (const [key, f] of Object.entries(spec)) {
      if (f._default !== undefined) defaults[key] = f._default
    }

    const obj = (data) => {
      const result = { ...defaults }
      if (data && typeof data === 'object') {
        for (const [key, value] of Object.entries(data)) {
          result[key] = typeof spec[key] === 'function' ? spec[key](value) : value
        }
      }
      return result
    }
    obj._default = undefined
    obj.default = v => { Object.assign(defaults, v); return obj }
    return obj
  }

  return z
}

const getMockZ = () => mockZ()

test('config: registers settings schema with live applies and no validate side-effect', async () => {
  let namespace
  let options
  let watcher
  let effectDisposer
  let received
  const detach = { called: false }
  const mockCtx = {
    settings: {
      register: (name, schema, opts) => {
        namespace = name
        options = opts
        return {
          get: () => schema({ verify: { maxRepairRounds: 3 }, models: { specialist: { provider: 'test', model: 'fast' } } }),
          watch: callback => { watcher = callback; return () => {} },
        }
      },
    },
    effect: callback => { effectDisposer = callback; return () => {} },
  }
  await registerSettings(mockCtx, { reviewMode: 'solo' }, value => { received = value }, () => { detach.called = true }, getMockZ)
  assert.equal(namespace, SETTINGS_NAMESPACE)
  assert.equal(options.applies, 'live')
  assert.equal(options.validate, undefined, 'validate must not be used for side-effects')
  assert.equal(received.verify.maxRepairRounds, 3)
  assert.equal(received.models.specialist.model, 'fast')
  assert.equal(received.reviewMode, 'lean', 'schema default should apply')
})

test('config: watch callback propagates committed settings changes', async () => {
  let watcher
  let received
  const mockCtx = {
    settings: {
      register: () => ({
        get: () => ({ reviewMode: 'studio', verify: { maxRepairRounds: 1 }, engines: {}, models: {} }),
        watch: callback => { watcher = callback; return () => {} },
      }),
    },
    effect: callback => { callback(); return () => {} },
  }
  await registerSettings(mockCtx, {}, value => { received = value }, undefined, getMockZ)
  assert.equal(received.reviewMode, 'studio')
  assert.equal(received.verify.maxRepairRounds, 1)
})

test('config: detach fallback restores base config', async () => {
  let effectDisposer
  let received
  const detach = { called: false }
  const mockCtx = {
    settings: {
      register: () => ({
        get: () => ({ reviewMode: 'studio', verify: { maxRepairRounds: 2 }, engines: {}, models: {} }),
        watch: () => () => {},
      }),
    },
    effect: callback => { effectDisposer = callback; return () => {} },
  }
  const base = { reviewMode: 'solo' }
  await registerSettings(mockCtx, base, value => { received = value }, () => { detach.called = true }, getMockZ)
  assert.equal(received.reviewMode, 'studio')
  const disposer = effectDisposer()
  assert.equal(typeof disposer, 'function')
  disposer()
  assert.equal(detach.called, true)
})