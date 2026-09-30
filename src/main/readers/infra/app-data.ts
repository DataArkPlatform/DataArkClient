/**
 * 跨平台「应用数据根目录」解析 —— Copilot / Qoder 等按 OS 约定存放数据的源共用。
 *
 * - Windows: %APPDATA%（默认 ~/AppData/Roaming）
 * - macOS:   ~/Library/Application Support
 * - Linux:   $XDG_CONFIG_HOME 或 ~/.config
 *
 * 导出 `appDataDirFor` 纯函数以便单测覆盖三平台分支（不依赖真实 OS）。
 */
import { homedir, platform } from 'node:os'
import { join } from 'node:path'

/** 按平台约定计算应用数据根目录（纯函数，便于测试） */
export function appDataDirFor(
  plat: NodeJS.Platform,
  env: NodeJS.ProcessEnv,
  home: string
): string {
  switch (plat) {
    case 'win32':
      return env['APPDATA'] !== undefined && env['APPDATA'] !== ''
        ? env['APPDATA']
        : join(home, 'AppData', 'Roaming')
    case 'darwin':
      return join(home, 'Library', 'Application Support')
    default:
      return env['XDG_CONFIG_HOME'] !== undefined && env['XDG_CONFIG_HOME'] !== ''
        ? env['XDG_CONFIG_HOME']
        : join(home, '.config')
  }
}

/** 当前运行时的应用数据根目录 */
export function appDataDir(): string {
  return appDataDirFor(platform(), process.env, homedir())
}
