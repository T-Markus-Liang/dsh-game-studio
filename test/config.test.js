import { test } from 'node:test'
import assert from 'node:assert/strict'
import { registerSettings, SETTINGS_NAMESPACE } from '../src/config.js'

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
  await registerSettings(mockCtx, { reviewMode: 'solo' }, value => { received = value }, () => { detach.called = true })
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
  await registerSettings(mockCtx, {}, value => { received = value })
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
  await registerSettings(mockCtx, base, value => { received = value }, () => { detach.called = true })
  assert.equal(received.reviewMode, 'studio')
  const disposer = effectDisposer()
  assert.equal(typeof disposer, 'function')
  disposer()
  assert.equal(detach.called, true)
})