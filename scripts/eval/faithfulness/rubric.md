# 忠实度 Judge 标注规范（金标 rubric）

人照此规范标注 `(claim, source) → verdict`，产出 `gold/judge-gold.jsonl`，用来验证 judge 这把尺（`meta-eval.ts`）。理论依据见 `docs/eval-playbook.md` §2–4。

> **核心原则**：标的是「claim 相对 SOURCE 是否成立」（summarization-faithfulness / 对源忠实），**不是**「claim 相对真实世界是否正确」。哪怕 claim 是真事，只要这份 source 里没有，也算 `unsupported`。

---

## 1. 谁来标 + 怎么标

- **一个领域专家定标准**（"仁慈独裁者"），不要委员会平均。
- 每条都写一句 `note` 说明判据——这句既是复核依据，也是未来 few-shot 素材。
- 先两人独立标一小片（~20 条）算 **inter-rater κ** 当上限；分歧开会对齐 rubric 再继续。
- **binary/categorical 判，不要打分**。

---

## 2. 判前必做：decontextualization（指代消解）

孤立的 claim 常无法判。标注（和喂 judge）前，把 claim 变**自包含**：

- 代词还原：「他否认了指控」→「<具名人物> 否认了 <具体指控>」。
- 省略补全：「该公司将裁员」→「<具名公司> 将裁员」。
- 若 claim 经消解后仍无法独立判定 → 标 `note: "underspecified"`，**不要**硬塞进金标（坏样本污染 κ）。

跳过这步是 spurious `unsupported` 的头号来源。

---

## 3. 三个 verdict（factual 通道）

| verdict | 定义 | 关键边界 |
|---|---|---|
| **supported** | source **直接陈述或清楚蕴含**该 claim | 允许改写/归纳/跨句聚合——**不要求逐字**。忠实的摘要句被 source *蕴含*即可。 |
| **unsupported** | source **既没说也没否定**——一个无源添加（可能是幻觉） | claim 多出 source 没有的具名细节（地点/数字/人名/时间）即属此类，**哪怕主句其余部分 supported**。 |
| **contradicted** | source 断言了与 claim **不相容**的内容 | source 说 A，claim 说非 A。 |

**`unsupported` vs `contradicted` 必须分清**（混了 κ 会崩）：
- source 没提 → `unsupported`
- source 说了相反 → `contradicted`

**复合 claim 拆开判**：「以色列空袭贝鲁特**南郊**，造成三人死亡」含两个可验证单元。理想情况上游已原子化；若一条 claim 里混了 supported 部分 + 无源细节，按**最严**判（有无源细节 → `unsupported`），并在 note 标明哪部分无源。

---

## 4. 两个 verdict（analytical 通道）

分析句（解读/推断/预测：「这暗示…」「或将重塑…」）允许超出字面事实，只判前提：

| verdict | 定义 |
|---|---|
| **consistent** | 对 source 中**确实存在**的事实的一个可辩护解读（即便推断本身超出了它们） |
| **contradicts_facts** | 推断依赖/断言了 source 否定的东西，**或**针对 source 中根本不存在的实体/事件（建立在虚构前提上的分析） |

---

## 5. 采样：别随机，要分层（见 playbook §1）

金标按下列维度**分层**，并**过采稀有类**（否则全是 supported，幻觉类召回算不出来）：

- **verdict 类**：刻意补足 `unsupported`、`contradicted` 各 ≥ 一定量（gate 算这俩的召回）。
- **claim 类型**：数值/数量、归属/引语、因果、时间——失败画像不同。
- **源结构**：单源 story vs 跨多份聚类报告合成（对应 per-story 归属 commit `8a5f0df`）。
- **难例**：重度改写句、跨远距源 claim（"Verify with Caution" 指出自动尺对这两类有偏，人工金标更要覆盖）。

**规模**：起步 ≥100 条落 held-out；judge prompt 的调参只在 dev 切片上做，最终 κ 只在 held-out 上报。

---

## 6. 金标格式（JSONL，一行一条）

```json
{"id":"b18-c3-claim2","type":"factual","claim":"<decontextualized claim>","source":"<该 claim 可用的 source 全文/片段>","gold":"unsupported","strata":{"claim_type":"location","source_span":"single"},"note":"source 只说空袭贝鲁特，南郊是多出的"}
```

字段：
- `type`: `factual` | `analytical`
- `gold`: factual → `supported`|`unsupported`|`contradicted`；analytical → `consistent`|`contradicts_facts`
- `strata`（可选但强烈建议）：用于分层统计与采样审计
- `note`（可选）：判据一句话
- `#` 开头行与空行被忽略，可写注释

---

## 7. 接受闸（meta-eval.ts）

held-out 上：
- **Cohen's κ ≥ 0.6**（目标 0.8）
- **幻觉类（unsupported + contradicted）召回 ≥ 0.7**

不过则 judge 不可信：先调 judge prompt（强制 CoT 取证），仍不过则**换非 Qwen 家族 judge**（兼缓解 self-preference 泄漏——brief 由 Qwen 生成，judge 又是 qwen-max）。

> 金标的真值地位不可动摇：judge 与金标冲突时，先怀疑 judge，不是改金标去迁就 judge。
