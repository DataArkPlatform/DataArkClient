/**
 * 数据源路径解析单测 —— 覆盖「装了却识别不到」的常见原因：
 * 非默认 VS Code 变体（通配发现）、Qoder 多端多布局候选根、跨平台应用数据目录。
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { mkdirSync, mkdtempSync, rmSync, utimesSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { resolveStorePath } from '../copilot'
import { resolveQoderHome, resolveQoderRoots } from '../qoder'
import { appDataDirFor } from '../infra/app-data'

describe('appDataDirFor（跨平台应用数据根目录）', () => {
  // 断言用 host 的 join 构造期望值：本函数只会在真实平台上调用，
  // 单测模拟其他平台时校验的是「目录段结构」而非分隔符。
  it('Windows：优先 %APPDATA%，缺失时回落 ~/AppData/Roaming', () => {
    const appData = join('C:\\Users\\me', 'AppData', 'Roaming')
    expect(appDataDirFor('win32', { APPDATA: appData }, 'C:\\Users\\me')).toBe(appData)
    expect(appDataDirFor('win32', {}, 'C:\\Users\\me')).toBe(appData)
  })

  it('macOS：~/Library/Application Support', () => {
    expect(appDataDirFor('darwin', {}, '/Users/me')).toBe(
      join('/Users/me', 'Library', 'Application Support')
    )
  })

  it('Linux：优先 $XDG_CONFIG_HOME，缺失时回落 ~/.config', () => {
    expect(appDataDirFor('linux', { XDG_CONFIG_HOME: '/home/me/.config2' }, '/home/me')).toBe(
      '/home/me/.config2'
    )
    expect(appDataDirFor('linux', {}, '/home/me')).toBe(join('/home/me', '.config'))
  })
})

describe('Copilot 路径发现（通配多形态）', () => {
  let appData: string

  beforeEach(() => {
    appData = mkdtempSync(join(tmpdir(), 'da-copilot-paths-'))
  })
  afterEach(() => rmSync(appData, { recursive: true, force: true }))

  /** 造一个 VS Code 变体的 session-store.db */
  const seed = (variant: string, mtimeSec?: number): string => {
    const dir = join(appData, variant, 'User', 'globalStorage', 'github.copilot-chat')
    mkdirSync(dir, { recursive: true })
    const p = join(dir, 'session-store.db')
    writeFileSync(p, '')
    if (mtimeSec !== undefined) utimesSync(p, mtimeSec, mtimeSec)
    return p
  }

  it('默认路径缺失时，通配发现回退到 VS Code Insiders', () => {
    const insider = seed('Code - Insiders')
    expect(resolveStorePath({}, appData, undefined)).toBe(insider)
  })

  it('通配发现覆盖任意新变体（无需登记清单）', () => {
    const custom = seed('SomeFutureEditor')
    expect(resolveStorePath({}, appData, undefined)).toBe(custom)
  })

  it('多个变体并存时取最近修改者', () => {
    const now = Math.floor(Date.now() / 1000)
    seed('Code', now - 10_000)
    const insider = seed('Code - Insiders', now)
    expect(resolveStorePath({}, appData, undefined)).toBe(insider)
  })

  it('全局存储目录名含 copilot 即被发现（不限 github.copilot-chat）', () => {
    const dir = join(appData, 'Code', 'User', 'globalStorage', 'github.copilot')
    mkdirSync(dir, { recursive: true })
    const p = join(dir, 'session-store.db')
    writeFileSync(p, '')
    expect(resolveStorePath({}, appData, undefined)).toBe(p)
  })

  it('COPILOT_HOME 覆盖优先', () => {
    const custom = join(appData, 'custom-copilot')
    mkdirSync(custom, { recursive: true })
    seed('Code')
    expect(resolveStorePath({ COPILOT_HOME: custom }, appData, undefined)).toBe(
      join(custom, 'session-store.db')
    )
  })
})

describe('Qoder 候选根目录（多端多布局）', () => {
  it('覆盖 环境变量 / 家目录 / 应用数据 / 文档目录 四类候选', () => {
    const roots = resolveQoderRoots(
      { QODER_CONFIG_DIR: '/cfg/qoder', QODERCN_CONFIG_DIR: '/cfg/qoder-cn' },
      '/home/me',
      '/appdata'
    )
    expect(roots).toContain('/cfg/qoder')
    expect(roots).toContain('/cfg/qoder-cn')
    expect(roots).toContain(join('/home/me', '.qoder'))
    expect(roots).toContain(join('/home/me', '.qoder-cn'))
    expect(roots).toContain(join('/appdata', 'QoderCN'))
    expect(roots).toContain(join('/appdata', 'Qoder'))
    // 官方 CLI 默认布局的父目录（projects/ 下才是会话）
    expect(roots).toContain(join('/home/me', '.qoder'))
    // 桌面 IDE 归档形态（Documents/Qoder/<date>/<id>）
    expect(roots).toContain(join('/home/me', 'Documents', 'Qoder'))
  })

  it('候选去重（同一路径多来源只保留一次）', () => {
    const dup = '/home/me/.qoder'
    const roots = resolveQoderRoots({ QODER_HOME: dup, QODER_CONFIG_DIR: dup }, '/home/me', '/appdata')
    expect(roots.filter((r) => r === dup)).toHaveLength(1)
  })

  it('resolveQoderHome 优先返回含 Qoder 会话特征的已存在根', () => {
    const appData = mkdtempSync(join(tmpdir(), 'da-qoder-home-'))
    const home = mkdtempSync(join(tmpdir(), 'da-qoder-home-user-'))
    try {
      const qoderDir = join(appData, 'Qoder')
      mkdirSync(join(qoderDir, 'SharedClientCache', 'cli', 'projects'), { recursive: true })
      expect(resolveQoderHome({}, home, appData)).toBe(qoderDir)
    } finally {
      rmSync(appData, { recursive: true, force: true })
      rmSync(home, { recursive: true, force: true })
    }
  })
})
