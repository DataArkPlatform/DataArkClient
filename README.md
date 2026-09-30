# 语料方舟 DataArt — AI 会话 · 本地管理

本地 AI 会话收集与管理桌面客户端。一键读取电脑上各 AI 编码代理（OpenCode / Codex / Claude Code / Copilot / Gemini CLI / Qoder / DeepSeek Harness）的本地会话数据，统一管理、全文搜索、本地备份。**数据全程留在你的电脑，不上传任何服务器。**

## 功能

- **AI Agent 读取页**：自动探测本机已安装的数据源 → 一键增量读取（worker 线程，不阻塞 UI）→ 读取完成统计与结果网格
- **会话管理**：虚拟滚动列表、标题+内容全文搜索（SQLite FTS5 trigram，支持中文）、时间/收藏筛选、多选批量分组/删除、拖拽归组
- **会话详情**：Markdown 渲染、代码块复制、思考过程折叠、工具调用卡片（状态徽标）、成果文件浮窗、一键复制全文
- **回收站**：软删除保留 24 小时自动清除，恢复 / 彻底删除 / 批量操作
- **设置**：自动读取频率调度、索引库快照自动备份、明暗主题切换
- **导出**：单条 / 批量 JSON 与 Markdown 导出

## 技术栈

Electron 44 + React 18 + TypeScript(strict) + Vite(electron-vite) + better-sqlite3(FTS5 trigram) + zustand

## 开发

要求 Node ≥ 22（本项目基线 v22.22.0）。

```bash
npm install          # postinstall 自动应用 patches/
npm run dev          # 开发模式（热更新）
npm run typecheck    # 类型检查（node + web 两套 tsconfig）
npm test             # vitest 单元测试
npm run lint         # eslint
npm run dist:win     # 构建 Windows NSIS 安装包 → release/<version>/
npm run dist:mac     # 构建 macOS 安装包（arm64 + x64，dmg + zip）→ release/<version>/
```

### 构建 macOS 安装包

`dist:mac` **必须在 macOS 上执行**（Apple 工具链限制，`electron-builder` 会直接拒绝在 Windows/Linux 上构建 mac 目标）：

- `.dmg` 生成依赖 macOS 的 `hdiutil`，签名/公证依赖 macOS 的 `codesign`/`notarytool`；
- macOS 版 `Electron.app` 内含 framework 符号链接，Windows 无符号链接权限（EPERM）时解压会损坏包结构。

在 Mac 上：

```bash
npm ci                # 或 npm install
npm run dist:mac
```

产物（未签名，可直接内测分发）：

```
release/1.0.0/语料方舟-1.0.0-arm64.dmg   # Apple Silicon
release/1.0.0/语料方舟-1.0.0-x64.dmg     # Intel
release/1.0.0/语料方舟-1.0.0-arm64-mac.zip
release/1.0.0/语料方舟-1.0.0-x64-mac.zip
```

> **未签名说明**：首次打开会被 Gatekeeper 拦截，右键「打开」或执行
> `xattr -dr com.apple.quarantine "/Applications/语料方舟.app"` 即可。
> 如需正式签名/公证，在 `electron-builder.yml` 的 `mac` 段补充 `identity`、
> `hardenedRuntime` 与 `notarize` 配置（或设置对应环境变量）。
>
> **原生模块**：`better-sqlite3@13` 采用 prebuildify，包内自带
> `darwin-arm64` / `darwin-x64` 预编译二进制，配合 `npmRebuild: false`
> 无需在 Mac 上重新编译 node-gyp。
>
> **图标**：`mac.icon` 指向 `build/icon-1024.png`（由 256px 源图放大，仅占位）。
> 有正式 1024×1024 品牌图后直接替换同名文件即可。

> **调试**：开发模式下按 `Ctrl + Shift + I` 打开 DevTools。

> **国内网络**：`.npmrc` 已配置 Electron 及 builder 二进制的 npmmirror 镜像。

## 数据源支持矩阵

| 数据源 | 状态 | 说明 |
|---|---|---|
| OpenCode | ✅ 已支持 | 只读 `%USERPROFILE%\.local\share\opencode\opencode.db`，V1 表结构已支持；检测到 V2（session_message）时明确报错提示（适配中）；WAL 快照兜底 |
| Codex CLI | ✅ 已支持 | `~/.codex/sessions/YYYY/MM/DD/rollout-*.jsonl`（RolloutLine：session_meta/response_item/…，只读流式；`.jsonl.zst` 暂不解析） |
| Claude Code | ✅ 已支持 | ~/.claude/projects JSONL（只读流式）；subagents/transcripts 后续版本 |
| GitHub Copilot | ✅ 已支持 | **通配发现**任意 VS Code 变体（Code / Insiders / VSCodium / Cursor / Windsurf / 未来新变体）`<应用数据>/<任意编辑器>/User/globalStorage/github.copilot*/session-store.db`，并覆盖便携版安装目录；多者并存取最近修改 |
| Gemini CLI | ✅ 已支持 | `~/.gemini/tmp/<project-id>/chats/session-*.jsonl`（新版 JSONL / 旧版 .json；projects.json + .project_root 反查项目路径） |
| Qoder | ✅ 已支持 | **多端多布局自动发现**（不写死路径）：CLI `~/.qoder[-cn]/projects/<项目>/<session-id>.jsonl`、桌面端 `<应用数据>/Qoder[CN]/SharedClientCache/cli/projects/*.session.execution.jsonl`、IDE 会话历史 `…/conversation-history/<id>/<id>.jsonl`、归档 `~/Documents/Qoder[CN]/<日期>/<id>/`；支持 `QODER_CONFIG_DIR`/`QODERCN_CONFIG_DIR` 覆盖；按内容特征识别并排除其它 Agent 文件 |
| DeepSeek Harness | ✅ 已支持 | `~/.dsh/sessions/<project>/<session>/session[.vN].jsonl[.zstd]`（dsh 拼接 Zstandard 帧，Node 原生 zstd + 帧边界扫描解压；也支持 `compression:'none'` 明文） |

新增数据源只需实现 `src/main/readers/types.ts` 的 `ReaderAdapter` 接口并注册。

## 架构速览

```
src/main/       主进程：readers(适配器) → pipeline(归一化/钩子) → db(SQLite)
src/preload/    contextBridge 类型安全 API
src/renderer/   React UI（pages/components/stores/styles）
src/shared/     IPC 契约 + 统一会话数据模型
patches/        node_modules 补丁（patch-package 自动应用）
```

核心设计原则：**源数据只读**——各 Agent 的原始文件/数据库永不写入；本地 SQLite 是可随时重建的派生索引层。处理管线预留脱敏(redact)/标准化(standardize)钩子位。

## 隐私声明

语料方舟是一款**本地优先**的 AI 会话管理工具。我们尊重并保护你的隐私，特此说明：

1. **数据来源**：仅在本地读取你电脑上已安装的 AI 编码工具（如 OpenCode、Claude Code、Copilot、Qoder 等）生成的会话文件。
2. **数据存储**：所有数据只保存在你本机的索引数据库与备份目录中，**不会上传到任何服务器**，也不会提供给第三方。
3. **网络使用**：工具全程可离线运行，除必要的更新检查外不发起任何网络请求。
4. **数据安全**：原始会话文件始终以**只读**方式访问，程序不会修改或删除任何源数据；你可随时在设置中关闭自动读取。
5. **开源透明**：本项目基于 MIT 协议开源，代码完全可审计。

> 应用内引导页点击「隐私声明」可查看同一份说明。

## 开源协议

本项目基于 [MIT License](./LICENSE) 开源。

## 贡献

欢迎提交 Issue 与 Pull Request，详见 [CONTRIBUTING.md](./CONTRIBUTING.md)。
