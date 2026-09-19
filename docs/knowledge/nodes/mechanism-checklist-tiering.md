---
{
  "id": "mechanism-checklist-tiering",
  "type": "mechanism",
  "title": "按支持篇数给事件清单分层,核心层作为覆盖门的判定范围",
  "date": "2026-09-19",
  "status": "candidate",
  "tasks": ["设计验收门"],
  "scope": "cluster-to-brief 的慢档覆盖轴;dev 五簇 + heldout 两簇都在用,核心层内容经过一次双模型校核,分层本身未验",
  "source": "scripts/eval/cluster-to-brief/build-checklist.mjs 的 computeTiers 与 expectations.json 的 coreTierRule",
  "conditions": [
    "核心层门槛必须是相对的:绝对 >=6 篇在 6 篇的簇上算不出来、在 116 篇的簇上形同虚设;按簇规模取比例则让大簇核心层恒为空(簇越大文章越分散到更多事件)",
    "口径只在 computeTiers 里定义一次,score-slow 读清单里写好的 coreMin,不自己算"
  ],
  "evidence_origin": "local_record",
  "relations": [
    {"type": "justified_by", "to": "lesson-scorer-steers-search"}
  ],
  "kind": "method",
  "input": "一份事件清单,每条带 articleIds(由 glm-4.7-flash 抽取并跨批归并)",
  "output": "coreMin = max(2, ceil(maxSupport × 0.5));核心层 = 支持篇数 ≥ coreMin,次层 = 2..coreMin-1,尾层 = 1 篇",
  "limits": "**分辨率极低**:dev 五簇核心层分别只有 6/2/7/3/3 条,翻一条就跳 17–50%。**次层 24 条完全不计分**,而它给出的排序与核心层相反(核心 direct-raw 95.2% 领先,次层它 54.2% 落后于 grounded/routed-storyline 的 58.3%)。**支持篇数不可靠**:nArticles 由 glm 分配的 articleIds 决定,再经阈值 0.90 的跨批归并——归并漏掉时同一事件劈成两条、支持篇数被分走、双双掉出核心层,而这个失效不报错。c36 肉眼已确认三对(会议推迟 6+3、El Gaia 4+3、Perim 岛 4+3)。**「该有而没抽到」的事件查不到**:EVENTS_PER_ARTICLE=2 是硬上限,漏抽的事件不在清单里,所有臂都不会因此扣分。",
  "invalidates_when": "某轮臂间排名翻转可归因到分层,或需要报覆盖率的绝对值而非臂间比较"
}
---

**它做的事**:把「多少篇文章报道了它」当成重要性的代理,据此决定哪些事件进入覆盖门的判定范围。
尾层 96/141(68%)大多是单篇报道的细节,要求简报覆盖每条单源细节是错的,所以分层本身有必要。

**各臂共用同一份清单**,所以分层的系统性偏差对臂间比较是对称的 —— 这是它在缺陷已知的情况下
仍然可用的唯一理由。绝对覆盖率不可信。

2026-09-19 对核心层 21 条做了双模型校核(opus + sonnet),改写 6 条、补 15 条口径分歧;
分层本身未校核,见 [[decision-hold-checklist-tiering]]。
