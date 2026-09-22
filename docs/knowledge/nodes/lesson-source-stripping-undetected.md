---
{
  "id": "lesson-source-stripping-undetected",
  "type": "lesson",
  "title": "剥掉消息源没有任何一档在扣分——补一条守则后硬错立刻从全 0 变成能分辨臂",
  "date": "2026-09-19",
  "status": "recorded",
  "tasks": ["设计验收门"],
  "scope": "cluster-to-brief 的 grading instructions；证据来自定向抽查（32 句逐句核）与补守则前后的 dev 读数对照",
  "source": "eval/cluster-to-brief/grading-instructions.mjs 与 out/frontier.json",
  "conditions": [
    "补守则同时改变了 packId，全部旧判定被指纹闸自动隔离、重判 —— 前后读数出自不同的两把 scorer，是设计如此，不是可比的 A/B"
  ],
  "evidence_origin": "local_record",
  "relations": [
    {"type": "cautions", "to": "mechanism-scorer-evidence-retrieval", "attributes": {"scope": "证据换成检索并不会自动让「剥掉消息源」被扣分，那要靠 grading instructions 里单独写一档"}}
  ],
  "kind": "diagnostic_observation",
  "invalidates_when": "在跨日期簇上重测，消息源剥离类的判定不再出现，或出现大量误判"
}
---

**怎么发现的**：定向抽查 direct-raw 的高危句时，c43 有一句把
`according to the Venice Film Festival's official synopsis` 去掉，把一方的说法写成了陈述。
判官标 `ok`——**而按当时的四档定义它没判错**：`ok` 档明写「正确的推断、**合理省略**、明示的判断语，
都不扣分」，四档里没有任何一档说剥掉消息源是缺陷。

**所以这不是检出能力问题，是守则的定义缺口。** 判官召回 80%（见
[[experiment-scorer-detection-recall-natural]]），它看得见，只是守则没让它扣分。

### 补的那一条

```
消息源剥离：原句写「X 说」「据 Y 简介」「据称」，成稿去掉归属、直接当事实陈述。
至少判 distortion；若该说法在证据里被另一方否认、无人证实、或同一消息源自相矛盾，
读者形成的假信念更强 → 判 hard。
这一类不算「合理省略」—— 省掉的恰恰是读者判断可信度的依据。
```

### 效果

补之前 fatal/hard 在所有测过的格子上**全是 0**，正确性那道门形同虚设，
实际在筛臂的只有覆盖率一条轴。补之后立刻抓到实质的东西：

- `direct-raw-routed` c7：「这一说法由美国太空军作出」——证据里是 `reports indicated` 这类无主来源，**凭空安上一个官方机构**
- `direct-raw-routed` c43：「被炸死的两人是哈马斯工程师」——这是**以色列方的单方指认**，独立记述只称「两名巴勒斯坦人」
- `direct-raw-routed-storyline` c36：把「伊朗单方面说」的推迟原因写成既定陈述（2 条）

**一条守则就把一条退化的轴救活了。** 它抓的正是「简报骗读者」的典型方式——
不是编造事实，是把一方的说法写成公认的事实。
