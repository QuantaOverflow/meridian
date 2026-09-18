---
{
  "id": "experiment-natural-error-rate-v3",
  "type": "experiment",
  "title": "自然简报候选句实测：事实错 18.3%，8 个多句 block 全含错，15/15 错在写作层",
  "date": "2026-09-18",
  "status": "recorded",
  "tasks": ["治事实关系错", "设计验收门"],
  "scope": "四个簇、83 句，来自 brief-v3-prod 的 M2 run（跑的是产品代码路径）；非盲单人判定，不是独立金标",
  "source": "scripts/eval/cluster-to-brief/out/natural-error-rate/NATURAL-ERROR-RATE-RESULT.md",
  "conditions": [
    "候选取自 apps/backend/prototypes/brief-v3-prod/out/runs/M2-1789179743813/c{0,3,13,18}-{lead,more,brief}.json 的 text；切句数与流水线 trace.marks.sentences 一致",
    "原文来自同 run 的 out/raw/<c>/A/batch*.json；scripts/eval/cluster-to-brief/fixtures/content/ 的文章 id 区间 986133–1009708 与本 run 的 912508–918595 完全不重叠，是不同日期快照",
    "判官为本地读原文的 agent，零远程 LLM 调用；判定逐条带候选句、对照原文句与 articleId:句号",
    "有效样本单位是 4 个簇，不是 82 句；按句当独立样本算出的窄区间不可引用"
  ],
  "evidence_origin": "local_record",
  "relations": [
    {"type": "yields", "to": "lesson-acceptance-unit-block-not-sentence"}
  ],
  "kind": "retrospective_analysis",
  "outcome": "observed",
  "inputs": "83 句自然候选，剔除 1 句非命题填充后分母 82；12 个 block（8 个多句 lead/more + 4 个单句 brief）",
  "evaluation": "非盲单人语义判定，逐条留依据；临界档（去消息源、丢情态、范围窄化）不计入分子，单列供上界估计",
  "result": "自然事实错误率 18.3%（15/82），簇级 95% CI [7.8%, 29.0%]；临界 10 条全算则上界 30.5%。8 个多句 block 全部含错（8/8），每个 lead 平均 2.5 个错，4 个单句 brief 干净。形状：actor 60%、time 20%、quantity 6.7%、state 6.7%、epistemic 6.7%、polarity 0%、scope 0%。层归因 15/15 全在写作层，抽取层零贡献；其中 3 条源自 relations 步伪造的关系。可回溯率：判官能定位 82/83，系统在写作时 0/83。现行 marks check 精确率 33%、召回 20%、groundingFixes 全空",
  "cost": "零远程调用",
  "record_completeness": "complete"
}
---

**自然错的主导机制是句内融合，不是单点替换。** actor 错 6/9 是两条各自正确的 fact 被揉成一句、
谓语挂错主语。一例：material 的 `<quotes>` 正确标着 Daniel Béland（McGill 政治学者），`<people>`
两人都在，写作层仍把那句挂到 Robert Bothwell 名下。这与 `utils/brief-writer-v3.ts` 里 one-source
变体注释引的 Lebanoff 2019（两句融合成一句 38% 含事实错）独立收敛。

**relations 步伪造关系，且伪造结果被贴上原始报道的标签。** 实测伪造 4 条（「84 人阵亡被 7 人取代」、
「拆除令在倒塌前下达」、「my feed my way 取代了 digital duty of care」等），其中 3 条写进了正文；
`prompts/briefWriterV3.ts` 把它们放在 `Notes on how events relate, taken from the original reporting:`
之下送进写作层。c13 的伪时序在两次独立 relations 调用里都出现，可复现。反方向也塌：真实 update
（监狱死亡 7→11）与全部跨源冲突一条都没识别。

**可回溯 0/83 是可逆的。** 坐标不是中途丢的——报告 fact 带 `sources: [{articleId, sentence}]`，
relations 的 prompt 还在用 `[aid:sent]`，只有 `renderReportForWriter` 的行渲染没把它写进
`<key_points>`；同文件的 `numberedPoints` 已经带 sources。真正不可逆的是 40% 的错来自句内融合，
两半各有出处。

60% 的自然错（3 条 relations 伪造 + 6 条融合）对报告而言是忠实的，锚报告的核验层在结构上看不见
它们——同 [[rarr-verification-overdeletion]] 那条死路的病根一致。

### 关联维护状态

首次结构检查时 `lesson-acceptance-unit-block-not-sentence` 尚未落盘；后续会话补齐该节点后恢复原有 `yields` 关联。本次结构修复没有生成新经验或改变实验读数。

对 `measure-writer-input-anatomy` 与 `measure-pipeline-cascade-loss` 的补充证据关联，按 schema 改为相应经验节点的 `based_on → experiment-natural-error-rate-v3`，范围仅限此四簇回顾分析，不能把局部观察扩成通用因果验收。
