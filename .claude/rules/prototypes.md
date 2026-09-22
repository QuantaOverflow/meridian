---
paths:
  - "apps/*/prototypes/**"
  - "services/*/prototypes/**"
---

# 原型目录约定

原型只留本地、不入 git（根 `.gitignore` 整目录挡）。所以**结论必须蒸馏进入库的文档**，
否则等于没有——见 CLAUDE.md 的「知识蒸馏」一节。

## 三个子目录（2026-09-05 定，新建原型照此摆）

```
<prototype>/
  *.ts *.py          实验源码，选择性入库
  fixtures/          输入 fixture（可复现依赖）
  out/               全部运行产物：labels、dump、summary、日志
  scratch/           一次性探测脚本
```

**产物和一次性脚本必须写进 `out/` 与 `scratch/`，不许往原型根目录写。**

## `.gitignore` 标准模板（照抄）

```
node_modules/
__pycache__/
.cache/
out/
scratch/
```

按目录挡而不是按文件名模式挡，是 2026-09-05 的教训：旧模板挡的是 `*-result.json` 这类模式，
而脚本都往根目录写，于是每轮都有新文件名漏网——已删的 `dedup-band` 原型里
`armB-*` / `armC-*` / `armFa-*` 等 70 个产物从来没被挡住，每次提交前都要手工补规则补一次漏一次。
按目录挡只需两行，且新脚本天然合规。

## 大 fixture

含 embedding 的 fixture 会很大（聚类 fixture 两个窗口 11MB，现放 `prototypes/_data/`），
这种在 README 里写重建方式、`.gitignore` 里单独挡掉；小的输入 fixture 照常入库。

## workspace 成员

原型是 pnpm workspace 成员（`pnpm-workspace.yaml` 的 `apps/*/prototypes/*` /
`services/*/prototypes/*`），各目录只留 `package.json`，根目录 `pnpm install` 一次装完。
**不要**再单独 `pnpm install --ignore-workspace`——2026-09-05 之前它们不在任何 glob 里，
16 个目录各装一份依赖、各维护一份 lock。

## import 生产代码要当心

原型 import `src/` 里的东西时，那个依赖**没有任何机制保护**：生产代码被删，原型静默失效。
2026-09-22 发现 `sibling-context/probe.ts` import 的 `utils/block-overlap.ts` 一周前就被删了，
没有任何东西报错。

所以：原型跑出结论后，**读数要蒸馏，不要指望以后还能重跑**。

## 「毕业」约定

验证完 → 核心源码精简入库（样板 `prototypes/article-prompt-slim/`：README + 核心 `.ts` + fixtures），
结果产物与一次性 TUI 清掉，别把整轮实验的滚动残渣长期堆着。
