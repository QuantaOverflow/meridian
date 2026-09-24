# Meridian

项目工程约定、目录归属、验证和部署规则见 `CLAUDE.md`，按路径生效的规则在 `.claude/rules/`；开始代码工作前阅读相关部分。

## 探索知识库

`docs/knowledge/` 只在本地、不入 git（新克隆里没有它就跳过）。什么时候查、写、整理，以及记录格式，都以本地的
`docs/knowledge/README.md` 为准；不要把整个知识库一次塞入上下文，按任务读相关记录。

`.codex/hooks.json` 的 Stop hook 在回复结束时只读校验知识库结构与 `INDEX.md` 是否最新（`pnpm -s knowledge --check-generated`）。
提示失败时修复对应记录或运行 `pnpm -s knowledge` 重建，不靠削弱校验通过；它不能判断是否漏记了经验，也不能证明结论正确。
