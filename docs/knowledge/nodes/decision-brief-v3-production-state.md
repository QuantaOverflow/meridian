---
{
  "id": "decision-brief-v3-production-state",
  "title": "简报 v3 已接进生产代码、本地 e2e 跑通，卡在月成本 $10.20 超上限 $10",
  "date": "2026-09-14",
  "status": "superseded",
  "source": "apps/backend/prototypes/brief-v3-prod/out/STOP.md",
  "invalidates_when": "成本上限被重定、或任一降本方案落地、或链路被部署（那时本节点改成已上线）",
  "type": "decision",
  "tasks": [
    "降低报告层成本",
    "上线简报v3"
  ],
  "scope": "仅限原节点正文与 source 所述模型、样本、目标及评测口径；未记录的条件未知",
  "conditions": [],
  "evidence_origin": "local_record",
  "relations": [
    {
      "type": "based_on",
      "to": "measure-report-cost-structure",
      "attributes": {
        "scope": "提出或解释结论的已有依据；不表示该方案已经直接测试"
      }
    },
    {
      "type": "constrained_by",
      "to": "invariant-support-count"
    },
    {
      "type": "constrained_by",
      "to": "invariant-citation-resolvable"
    }
  ],
  "legacy_type": "decision",
  "legacy_relations": {
    "measured_by": [
      "measure-report-cost-structure"
    ],
    "depends_on": [
      "invariant-support-count",
      "invariant-citation-resolvable"
    ]
  },
  "action": "历史决定或进度记录；实际状态以正文及 source 为准，不能由 live 推断已部署"
}
---
**已完成**：ai-worker 新增 `/meridian/report-v3`；`write-block-v3` 接上代码检查器（`marks` 只进内部
观测，读者看不到）；backend workflow 改成 报告 → 分层 4/10/其余 → 写作 v3 → 三节拼装 → 起标题 →
每期一份 v3 记录落 R2。`pnpm typecheck` 通过，本地 e2e 跑出过完整一期（25 块、4/10/11、23 条标记）。
**（写于部署前；已过期）未部署、未 commit。**

**2026-09-18 纠正**：本链路已于 2026-09-15T12:37Z 部署，reports 94/95/96 三期均为 v3 产出；
代码已于 2026-09-18 补提交（commit 320d9fe）。当前状态见 decision-brief-v3-deployed。
本节点余下内容保留为部署前的历史记录。

**2026-09-15 更新**：曾被当作唯一降本杠杆的 L2（抽取产出约束）已固化进代码并过了 M1 复验，
质量不伤，但**省不了钱**——同日两次跑 −6.3% / +0.7%，跨过基线，落在跑间波动里
（见 decision-tighter-output-constraint）。**$10.20 的缺口没被补上**，下面第 ① 条仍要人拍板。

同日的分步归因找到一个大一个量级的入口：去重 95.3% 的输入是重复贴的同一段判定说明书，
打包判定的算术上限是省总成本 18.3%，且各簇都吃得到（中位也会真降）——见 measure-dedup-fixed-overhead。
**未实测**，风险是跨组乱并。

**三件悬着的**（需要人拍板）：① 月成本 $10.20 vs 上限 $10——抬上限还是封顶每份报告 16 篇（→$8.87）；
② 提供方一抖触发重试，`observed` / `usage-recorded` 两道门必挂（span 数按「尝试」计、trace 按「调用」计，
失败那次拿不到 usage）——门的口径要不要改成「逻辑调用 + 提供方尝试 + 未知成本尝试」三个字段；
③ 标题大小写的修复只在函数级验过，整链复验要再花一轮 e2e。

验收脚本 `apps/backend/prototypes/brief-v3-prod/accept.ts`（冻结，sha 前 16 位 `ad73a86083b8b1df`），
三档 M1/M2/M3 的门与读数口径都在里面。
