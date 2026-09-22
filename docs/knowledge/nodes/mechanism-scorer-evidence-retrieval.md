---
{
  "id": "mechanism-scorer-evidence-retrieval",
  "type": "mechanism",
  "title": "评分方自己检索证据：判官看到的材料与成稿引了谁无关",
  "date": "2026-09-19",
  "status": "candidate",
  "tasks": ["设计验收门"],
  "scope": "cluster-to-brief 慢档；dev 五簇上用过，heldout 未验，跨日期语料未验",
  "source": "eval/cluster-to-brief/retrieval.mjs（buildIndex/topK）与 build-judge-pack.mjs",
  "conditions": [
    "簇内句向量按簇缓存，缓存键带句子条数与首末句 —— 静默用旧向量是最危险的失效方式（检索照样出结果，全是错的）",
    "不能换成整簇一次直读：[[measure-detection-ceiling]] 实测整簇判官召回只有 26%"
  ],
  "evidence_origin": "local_record",
  "relations": [
    {"type": "justified_by", "to": "lesson-scorer-steers-search"}
  ],
  "kind": "component",
  "input": "一句成稿 + 该簇全部文章的逐句语料（本地 e5-small，384 维已归一化，cos 即裸点积）",
  "output": "与该句最相关的 top-k 原句（k=8），带 (articleId, 句号) 坐标",
  "limits": "检索会漏：实测成稿声称的出处未进 top-8 的比例，direct-raw c43 4/50 = 8%、grounded 1/34 = 3%、dev 五簇合计 direct-raw 30/241。漏的时候判官按守则标 ok，所以**正确率读数偏高**——必须连着看 citedNotInEvidence 这个机械读数。另有两个判官独立报告：固定 k=8 会拿不相干句子填满证据位（跨国新闻、无关时间点），容易被读成「查过了没有支持」。抓取噪声（导航栏、图片版权行）会被切进原句，干扰「被引那句够不够」的判定。",
  "invalidates_when": "citedNotInEvidence 超过 15%，或在跨日期簇上判官普遍报「检索缺口」"
}
---

**它解决的是效度不是信度。** 旧做法把证据窗口锚在成稿引的那一句上，于是引得越宽的臂拿到越多证据
——各臂每句出处实测 1.03~1.73 不等，这个差距会原样搬进正确性读数，scorer 量的成了引用行为。
检索取值与成稿引了谁完全无关，各臂拿到同一把尺。

代价是信度：首测 6% 不一致（窗口取值 0%）。但**信度可以压，效度改措辞改不动**——
把守则里「下面给出的证据」的范围写死之后，实测降到 0/36 与 0/27。

**必须配一维 `citedSentenceSuffices`**：成稿声称的出处另行呈现，只回答「被引那句本身够不够」。
不拆开的话，引用质量会重新混进事实正确性，(a) 那个缺陷就回来了。两维在判定包里分开摆、守则写明互不回改。

文献同向：AlignScore 切块逐句取最高、SummaC 全句对 NLI、MiniCheck 句级分类器，
共同点都是证据由评分方在全文里找。
