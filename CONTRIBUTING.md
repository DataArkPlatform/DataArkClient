# 贡献指南

感谢你对 **语料方舟 DataArt** 的关注！欢迎通过 Issue 与 Pull Request 参与共建。

## 开发环境

- Node.js ≥ 22（本项目基线 v22.22.0）
- Windows 10/11 用于日常开发与 Windows 打包；macOS 打包需在 macOS 上执行

```bash
npm install          # postinstall 自动应用 patches/
npm run dev          # 开发模式（热更新）
```

## 提交前自检

```bash
npm run typecheck    # 类型检查（node + web）
npm test             # 单元测试
npm run lint         # ESLint
```

## 提交规范

- 单个 PR 只做一件事，保持改动聚焦
- 提交信息建议使用 `FEAT:` / `FIX:` / `STYLE:` / `DOCS:` / `REFACTOR:` 前缀
- 新增数据源：实现 `src/main/readers/types.ts` 的 `ReaderAdapter` 接口，并在 `src/main/readers/registry.ts` 注册

## 代码风格

- TypeScript strict；禁止 `any` / `@ts-ignore` / `@ts-expect-error`
- 格式化使用 Prettier（`.prettierrc`），Lint 使用 ESLint（`eslint.config.mjs`）

## 许可证

提交代码即表示你同意以 [MIT License](./LICENSE) 授权。
