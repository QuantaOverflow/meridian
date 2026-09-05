# RARR 误删守卫（扔掉型原型）

**问题**：G2「误删」守卫 `isBadDelete`（`src/utils/grounded-edits.ts`）判据是「整段 span 逐字在源里才拦」。实测两期简报共 43 条被应用的删除，G2 拦下 **0 条**——真实被删的是 130–216 字符的整句转述，措辞与源不同，逐字匹配永远落空；其中 9 条经独立复核确认是误删（删掉了源支持的内容）。

**跑**：`pnpm run probe`（`probe.ts`）

**结论**：见 `docs/engineering-notes/` 与 `grounded-edits.ts` 的守卫注释；六项修法的合并效果在 `../rarr-narrow-oracle/`。
