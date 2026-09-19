---
{
  "id": "experiment-scorer-evidence-width-c1",
  "type": "experiment",
  "title": "scorer 四变体对照：证据从单句放宽到 ±2 句，判官漂移 18%→0%；二元拆分反而升到 6%",
  "date": "2026-09-19",
  "status": "recorded",
  "tasks": ["设计验收门"],
  "scope": "只在 c1（sweden，49 句待判、18 条事件）上做；c1 此后即为调参过的样本，不能再用它验收新 scorer",
  "source": "scratchpad/scorer-proto/（session 级临时目录，新会话需按 handoff §6 重建）；变体构造脚本 build.mjs / build-v4.mjs",
  "conditions": [
    "四个变体判同一批 49 句（取自 crossover 那轮的合并判定包），事件清单与守则其余部分完全相同",
    "每个变体两个**独立** subagent 各判一次；同一 agent 判两次会照抄，量不到漂移",
    "V0 基线是 crossover 那轮 c1 的两轮读数，其中 33 句两轮都判过",
    "V4 的检索器是 IDF 加权词面重叠、取 top-8，不是 embedding；成稿自引的句子在 top-8 之外并集追加（97 条出处里 12 条没进 top-8）",
    "判官为 Claude subagent，继承主会话 opus，零远程 LLM 调用"
  ],
  "evidence_origin": "local_record",
  "relations": [
    {"type": "yields", "to": "lesson-scorer-steers-search"}
  ],
  "kind": "probe",
  "outcome": "observed",
  "inputs": "V0 四档+单句切片（基线，33 句可比）／V1 二元拆分+单句切片（第二个判官被连接错误中断，未补跑）／V2 四档+±2句窗口／V3 二元拆分+±2句窗口／V4 二元拆分+全簇 top-8 检索。V1–V4 各 49 句",
  "evaluation": "主读数=两次独立判定的不一致率；打架读数=判定率（非 ok / supported=false / misleading=true 的条数），防止「什么都判 ok」也拿 0% 漂移；附带读数=citedSentenceSuffices（只看被引那句够不够）",
  "result": "漂移：V0 18%（6/33，全部是 distortion↔ok 互换，hard 一条没动）／V2 **0%**（两判官 49 句判定完全相同，连唯一那条 distortion 与 9 条引用错位的 id 列表都一致）／V3 6%／V4 6%。判定率：V0 2 条、V2 1/1、V3 5/4、V4 2/1，未见塌陷。覆盖四个变体一致 15/18。citedSentenceSuffices=false：V2 9/9、V3 14/10、V4 8/9，四个判官高度一致。V4 另给出：**真没依据 0 条、引错句子 8–9 条**",
  "cost": "9 个判官 subagent（V1-b 失败未补），零远程 LLM 调用；c1 只有 20 篇文章、370 句，检索为纯本地词面计算",
  "record_completeness": "complete"
}
---

**跑前的预期写反了**：预期是 V1（改 rubric）降漂移、V2（加证据）不怎么降。实际 V2 只加证据、
rubric 一字未改，漂移就从 18% 归零。所以 V0 那些 `distortion ↔ ok` 的反复不是"偏差印象"这条线模糊，
是**判官手里证据不足、只能凭感觉选一边**。

**二元拆分在这里是负收益**：两个二元变体都是 6%，各多出一处可晃的地方。Hamel Husain 主张二元的
主要理由是「与人工金标对齐容易」，而本仓没有人工金标，那个好处兑现不了。两个 V3 判官还共同指出
守则里「下面给出的证据」没写清是本句窗口还是全文件——这部分漂移是 prompt 缺陷，不能全算在 rubric 上。

**V2 与 V4 是不同性质的方案，不是优劣关系**：V2 的窗口锚在成稿引的那句上，所以引用选择仍然决定
判官看到什么；V4 的证据与成稿引了谁无关，代价是检索噪声（判官报了跨主题污染、近似重复源吃名额、
页面导航文本占候选位、以及一处真实漏召——y5 的「Japan's」在 8 条候选里无任何一句提到 Japan）。

文献对照（未在本仓复现，仅作依据）：AlignScore 对源文切约 350 token 重叠块、每句对所有块取 max；
SummaC 算全文句对 NLI 矩阵；两者都由评分方在全文里找证据，不用生成方给的引用。而整簇一次直读在
本仓实测召回只有 26%（见 [[measure-detection-ceiling]]），所以不能简单换成全文塞进去。
