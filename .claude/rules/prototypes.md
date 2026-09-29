---
paths:
  - "apps/*/prototypes/**"
  - "services/*/prototypes/**"
---

# 原型目录约定

原型只留本地、不入 git（根 `.gitignore` 整目录挡）。所以**结论必须蒸馏进入库的文档**，
否则等于没有——见 `docs/agents/knowledge-distillation.md`。

## 开工前先查知识库（任何原型都适用）

动手设计之前，先带路径搜 `docs/knowledge/`（它被 gitignore，不带路径的搜索会静默漏掉），在对话里答清：
最相关的旧记录是哪几条、这次改了什么变量、这轮唯一想拿到的新信息。怎么查见 `docs/knowledge/README.md`。

2026-09-29 教训：事件追踪做了 5 种 LLM 归并架构的原型，没一种赢过调低门槛。知识库里 08-30 就有一条
「相似度 0.94 附近该合与不该合交错排列、调阈值切不开」，它本可以一开始就提示难例是余弦分不开的边界、
小模型大概率也判不稳——开工时没查（ADR `docs/adr/0008-story-thread-grouping-threshold.md`）。

## 共用工具与现成数据集

取数据、调模型（Workers AI / codex）、事件追踪评测与生产基线都在 `eval/_kit/`，先看 `eval/_kit/README.md` 再动手，别在原型里重写一份。
人工金标放 `eval/_data/`（入 git），原型里只放派生产物。

## 比较多个方案时（有一把尺、在几个候选里挑一个）

只适用于比较型原型；可行性试探（能不能跑通）和设计探索（没有分数、靠人看）跳过这一节。

1. **先把最便宜的强基线调好**：现行算法扫一遍参数，几分钟的事，放在最前面。
   例外：还没有任何输出的冷启动阶段，可以先用粗尺排序（ADR `docs/adr/0006-eval-bootstrap-and-ruler-recalibration.md`）。
2. **基线是尺子，不是起点**。先对调好的基线剩下的错做错误分析并计数，得出「还有多少可赢的空间、错在哪几类」。
   在此之上：
   - 可以在基线上做增量，也可以从零搭异质架构——不因为有了基线就只做局部修补。
   - 每个方案开工前写一句：它凭什么可能赢——对准基线的哪类错，或者基线的结构性天花板在哪、它怎么绕过。
   - 所有方案都和调好的基线在同一套评测下比。可赢空间很小时先报出来，由用户决定还探不探。
3. **先用几十条难例单测关键机制**（例如「模型判同一事件的正确率」），过关了再集成。
4. **先量噪声底**：同一配置重跑、换折，分数波动多少。差距要超过噪声的两倍，并在 ≥2 份独立数据上都成立才算赢。
5. **错例分析由主会话做**，不让 agent 在唯一的开发集上按错例反复修——那是在考题上调参。

## 三个子目录（2026-09-05 定，新建原型照此摆）

```
<prototype>/
  *.ts *.py          实验源码
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
这种在 README 里写重建方式。（原型目录整体不入 git，fixture 也一样。）

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

验证完 → 有用的逻辑移植进生产代码（`<package>/src/`）或 eval harness（`eval/<domain>/`）才入库，
原型目录本身留本地；结果产物与一次性 TUI 清掉，别把整轮实验的滚动残渣长期堆着。
