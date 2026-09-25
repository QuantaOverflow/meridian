# direct-raw

This arm avoids extraction summaries. It renders every source sentence as
`[articleId:sentence]`, covers every article with character-budgeted overlapping windows, and asks
the same direct writer to produce evidence-bound prose candidates. One final call may only select
candidate ids and group them into event blocks; deterministic assembly copies candidate prose and
citations byte-for-byte.

```bash
node arms/direct-raw/direct-raw.test.mjs
node arms/direct-raw/direct-raw.mjs --plan --cluster=36
node arms/direct-raw/direct-raw.mjs --cluster=36
DIRECT_RAW_CONCURRENCY=1 node arms/direct-raw/direct-raw.mjs --cluster=36 --resume
node verify.mjs --arm=out/direct-raw --cluster=36
node arms/direct-raw/direct-raw.mjs              # dev only
node verify.mjs --arm=out/direct-raw             # dev only
```

## v6 配置（生产 brief-block-v6 的原型来源）

```bash
DIRECT_RAW_WRITE_AT_END=1 DIRECT_RAW_WRITE_TIER=exec DIRECT_RAW_WRITE_SUPPORT=1 DIRECT_RAW_WRITE_REPAIR=mech \
  node arms/direct-raw/direct-raw.mjs --dataset=<id>
```

开关含义见 `direct-raw.mjs` 顶部注释。`DIRECT_RAW_RUN=n` 为第 n 次独立重复，产物与缓存分目录。

## 删掉的开关（2026-09-25，结论留档）

都是试过、结论已定的分支；要复现从 git 历史取回（`aaf076d` 里还在）。

- `DIRECT_RAW_SINGLE_BLOCK=1`：选择步一簇只出一块（ADR 0003 簇即简报块）、同一事实去重。
  被 `WRITE_AT_END` 路线取代——写作步本来就一簇一段，不再靠选择步合块。
- `DIRECT_RAW_WRITE_TIER=lead`：写作步篇幅放到 8–14 句，试能否把被挤掉的核心事实写回来。
  没用：c28 把核心层的飞行员营救整条判成「别的故事」丢掉，卡召回的不是篇幅而是模型对「什么算这个故事」
  的判断，于是改由报道量决定（`WRITE_SUPPORT`）。
- `DIRECT_RAW_WRITE_REPAIR=1`（全套修复）：除了 mech 的两个确定性修复，还有窗口步出处上限 4→8、
  prompt 要求保留专名（c36 把 Perim 岛概括没了）与一句一条线。单次运行读数被随机波动淹没
  （2026-09-20 同设置重跑，漏线/重复/句数不足轮流出现），所以只留不引入随机性的 `mech`。
  同批试过又撤的：「杂烩只写报道最多的那件事」——报道篇数被各事件报道里反复交代的背景事实抬高
  （c43 的加沙死亡总数比任何真实事件都「多」，成稿混了三组），且把 c28 的营救线当成别的事件删掉。
- `DIRECT_RAW_MUST_SLACK=1`：必写档放宽到最高档与次一档。mech 三次运行里 c28 营救线 3/3 丢失，
  放宽后 3 次里营救 0/3 → 1/3，但写营救时挤掉了弹药部分（必写 12–14 条，5 句装不下）。撤回：
  用户定 c28 是两件事（9 月的监察长报告 / 4 月营救的采访与争议），只写报告是对的。
- `DIRECT_RAW_MODEL`：换写作模型。没有文档化的调用；模型固定 `@cf/zai-org/glm-4.7-flash`（与生产一致）。

## 默认参数

Defaults: 30,000 characters/window, one-article overlap, two concurrent window calls. Override
with `DIRECT_RAW_WINDOW_CHARS`, `DIRECT_RAW_OVERLAP_ARTICLES`, and
`DIRECT_RAW_CONCURRENCY`. Calls and timing are recorded under `out/direct-raw/`.

Each successful window is validated and atomically persisted as
`out/direct-raw/c<cluster>-windows/w<n>.json` before the run proceeds. `--resume` reuses only these
per-window files; it checks the cluster/window identity, exact article-id coverage, deterministic
candidate ids, and that every citation resolves inside that window. A malformed or stale cache is
an explicit failure rather than a silent regeneration. After all windows are present, the final
selector still receives evidence-backed candidates and may output candidate IDs only.
