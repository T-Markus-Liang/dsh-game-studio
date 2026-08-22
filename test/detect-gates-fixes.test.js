import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { detectAll } from '../src/engines/detect.js'
import { gateBuildPass } from '../src/verify/gates.js'

// ── BUG-1: Godot 版本提取 ──────────────────────────────────

test('detect: PackedStringArray features 格式提取版本 (Godot 4 实际格式)', () => {
  const root = mkdtempSync(join(tmpdir(), 'gs-detect-psa-'))
  try {
    writeFileSync(join(root, 'project.godot'), [
      '; Engine configuration file.',
      'config_version=5',
      '',
      '[application]',
      'config/name="Test"',
      'config/features=PackedStringArray("4.7", "GL Compatibility")',
    ].join('\n'), 'utf-8')
    const r = detectAll(root)
    assert.equal(r.engine, 'godot')
    assert.equal(r.version, '4.7')
    assert.equal(r.projectRoot, root)
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})

test('detect: 旧方括号 features 格式仍工作', () => {
  const root = mkdtempSync(join(tmpdir(), 'gs-detect-bracket-'))
  try {
    writeFileSync(join(root, 'project.godot'), [
      'config_version=5',
      '[application]',
      'features=["4.2", "Forward Plus"]',
    ].join('\n'), 'utf-8')
    const r = detectAll(root)
    assert.equal(r.engine, 'godot')
    assert.equal(r.version, '4.2')
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})

test('detect: 无 features 时回退 config_version 推断', () => {
  const root = mkdtempSync(join(tmpdir(), 'gs-detect-cv-'))
  try {
    writeFileSync(join(root, 'project.godot'), 'config_version=5\n', 'utf-8')
    const r = detectAll(root)
    assert.equal(r.engine, 'godot')
    assert.equal(r.version, '4.x')
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})

// ── BUG-2: 向上扫描只认强证据 ──────────────────────────────

test('detect: 父目录杂散 .gd/.tscn 不把空子目录误判为 godot 项目', () => {
  const parent = mkdtempSync(join(tmpdir(), 'gs-detect-stray-'))
  try {
    // 模拟 /tmp 现场：父目录有杂散弱证据文件
    writeFileSync(join(parent, 'stray.gd'), 'extends Node\n', 'utf-8')
    writeFileSync(join(parent, 'stray.tscn'), '[gd_scene]\n', 'utf-8')
    const empty = join(parent, 'empty-dir')
    mkdirSync(empty)
    const r = detectAll(empty)
    assert.equal(r.engine, 'unknown', '空目录不应被父目录弱证据污染')
    assert.equal(r.projectRoot, empty, 'projectRoot 不应漂移到父目录')
  } finally {
    rmSync(parent, { recursive: true, force: true })
  }
})

test('detect: 父目录强证据 (project.godot) 仍向上生效', () => {
  const parent = mkdtempSync(join(tmpdir(), 'gs-detect-strong-'))
  try {
    writeFileSync(join(parent, 'project.godot'), [
      'config_version=5',
      'config/features=PackedStringArray("4.7")',
    ].join('\n'), 'utf-8')
    const sub = join(parent, 'Scripts')
    mkdirSync(sub)
    const r = detectAll(sub)
    assert.equal(r.engine, 'godot')
    assert.equal(r.version, '4.7')
    assert.equal(r.projectRoot, parent, '强证据应让 projectRoot 上移到项目根')
  } finally {
    rmSync(parent, { recursive: true, force: true })
  }
})

test('detect: 起始目录弱证据 (*.gd/*.tscn) 仍生效', () => {
  const root = mkdtempSync(join(tmpdir(), 'gs-detect-weak-'))
  try {
    writeFileSync(join(root, 'player.gd'), 'extends Node\n', 'utf-8')
    writeFileSync(join(root, 'main.tscn'), '[gd_scene]\n', 'utf-8')
    const r = detectAll(root)
    assert.equal(r.engine, 'godot')
    assert.equal(r.projectRoot, root)
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})

test('detect: 父目录杂散 Unreal/Unity 弱证据同样不生效', () => {
  const parent = mkdtempSync(join(tmpdir(), 'gs-detect-stray2-'))
  try {
    mkdirSync(join(parent, 'Content'))
    mkdirSync(join(parent, 'Source'))
    mkdirSync(join(parent, 'Library'))
    const empty = join(parent, 'empty-dir')
    mkdirSync(empty)
    const r = detectAll(empty)
    assert.equal(r.engine, 'unknown')
  } finally {
    rmSync(parent, { recursive: true, force: true })
  }
})

// ── 观察-4: gateBuildPass 检查 digest.errors ───────────────

test('gates: build-pass exit 0 但 digest.errors 非空应 FAIL (Godot Parse Error 场景)', () => {
  const sr = {
    ok: true,
    exitCode: 0,
    durationMs: 500,
    digest: {
      errors: [
        { file: 'res://test/run_tests.gd', line: 8, message: 'SCRIPT ERROR: Parse Error: Cannot infer the type of "player" variable' },
      ],
      warnings: [],
      summary: '1 errors, 0 warnings',
    },
  }
  const r = gateBuildPass({}, { stepResult: sr })
  assert.equal(r.verdict, 'FAIL')
  assert.ok(r.reasons.some(x => x.includes('1 个错误')), '应报告错误个数')
  assert.ok(r.reasons.some(x => x.includes('Parse Error')), '应列出错误详情')
})

test('gates: build-pass digest.errors 空且 ok 仍 PASS', () => {
  const r = gateBuildPass({}, { stepResult: { ok: true, durationMs: 100, digest: { errors: [], warnings: [], summary: 'ok' } } })
  assert.equal(r.verdict, 'PASS')
})
