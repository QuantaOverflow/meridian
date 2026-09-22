---
{
  "id":"experiment-expanded-dev-quote-gate",
  "type":"experiment",
  "title":"引用harness修复后40新开发对照真实运行：漏放5/20，语义未识别6/20，复核7/40",
  "date":"2026-09-18",
  "status":"recorded",
  "tasks":["治事实关系错", "提高链路健壮性"],
  "scope":"新20事件/文章40正常错误对照，整句模型语义门+机械引用接口+不变数量窄规则；非完整分解核验链路、非独立可靠性或生产验收",
  "source":"eval/cluster-to-brief/arms/atomic-evidence/structured-verifier/EXPANDED-DEV-RESULT.md",
  "conditions":["模型只输出slot/status/errorSpan/quote字符串/reason，代码分配ID/claim/来源编号/偏移，exact quote唯一来源文档，不猜未知歧义；逐条隔离故障，具体字段错误单条有限self-heal", "引用150字符硬限制；sourceIndex不再由模型生成。先保存v0.15真实raw离线绑定回归8/8，旧合同未强制150字符事实保留，无新增调用及语义修正", "开发20新文章均未在旧60或v0.15八题使用，每事件保留正常/一错误短语成组；主Codex自编非盲，半径2未截断上下文本地读原文确认足够，标签不进入请求或影响路由，运行中不修改冻结组件材料", "glm-4.7-flash Workers AI REST及Gateway，thinking关闭，max_tokens5000，温度0/修复0.1；10初始batch/最多10单条修复，20逻辑/40HTTP/60000已知token停止阈值/每请求60秒；远程只被测模型无judge，最终heldout c28/c51未读"],
  "evidence_origin":"local_record",
  "relations":[{"type":"yields","to":"lesson-relation-factor-observability"}],
  "kind":"prototype_evaluation",
  "outcome":"failed",
  "inputs":"40题/20事件，各20正常及20错误短语，范围含时序、数量及界限、施事归因、身份、否定、排他、计划完成态、无依据因果；含固定开发池离题文章，不是自然错误分布或独立试验",
  "evaluation":"主Codex本地逐条原文/最终保留raw非盲审计，对完整results及逐条raw hash绑定，参考整句状态与注入错误理由分开；95机械回归通过、项目typecheck exit0且4任务缓存命中，无远程judge",
  "result":"40完整分母保留接口失败：实际错误漏放5/20=25%，注入错误未识别6/20=30%（含一错误因引用失败转复核，不能算语义检出），错误未明确拦截7/20=35%；正常误拦0/20但5正常复核；总7/40=17.5%复核，20allow=15正常+5错误/13block/7review。五漏点为白俄罗斯报告将提交已提交、约旦至少恰好11、圭亚那不想想、印尼总统议会施事、Saab计划已出现；Jenius offshoot standalone语义漏点因接口失败未放行。Myanmar only理由忠实但坏引用复核，Singapore完成态错误锚点不精确，Holocaust施事理由忠实但引用缺关键细节。10单条修复3成功7失败，失败不再拖垮batch；原数量规则40全部not_covered，未扩大语法修补题词",
  "cost":"20逻辑/28HTTP，31180已知tokens，183.134累计请求秒；全部HTTP200及usage已知，无基础设施故障/远程judge；美元费未查询；全部调用结束，无heldout/生产修改/部署/提交",
  "record_completeness":"complete"
}
---

旧0/4原始父句状态及旧60缓存零漏放不能代表新材料可靠性；新接口与材料同时变化，不做纯材料/纯提示因果归因。冻结plan hash d30f135f7fa33b1bdd71592b5f0aa5b2000838c9725f4d6f14a050f115db6d9a；results hash 710987358b3e52f4a803a2aeba09953c392d988a9df6eebdbfa586e25e6c418d，完整产物在out/atomic-evidence/expanded-dev-v0.16.1。

来源绑定/故障扩散已修，但原文引用忠实转换7最终失败和整句语义错放并存。只精确引用并不证明蕴含：同一个错误句可以引用正确的not/to be/at least/president内容却被模型标supported。下一步应对语义维度做忠实独立字段转换、代码比较及覆盖门，再另验组合，而非补漏点词规则刷到零。尚不采用该工作点，也不扩实验直到预算耗完。
