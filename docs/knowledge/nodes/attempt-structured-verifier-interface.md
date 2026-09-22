---
{
  "id": "attempt-structured-verifier-interface",
  "type": "attempt",
  "title": "独立业务结构转换作为确定性核验接口",
  "date": "2026-09-17",
  "status": "tested",
  "tasks": ["治事实关系错", "演化组合架构"],
  "scope": "structured-v0.2部分真实glm烟测，1题完整/1题转换部分；另有本地人工结构测试，不读heldout，无整体效果结论",
  "source": "eval/cluster-to-brief/arms/atomic-evidence/structured-verifier/REAL-RESULT.md",
  "conditions": ["候选/证据独立转换；代码仅在可审计对齐前提下比较；扩展上下文另版本重审标签", "用户要求跑真实LLM，审批通过；人工参考图不进入模型，judge为本地Codex"],
  "evidence_origin": "local_record",
  "relations": [
    {"type": "addresses", "to": "goal-cluster-to-brief"},
    {"type": "varies_from", "to": "attempt-practice-risk-slots", "attributes": {"changed": "从词锚点问题与LLM支持判断改成独立业务图转换、显式对齐接口及代码比较", "reason": "词命中未保证断言覆盖和数量/状态/归因绑定；需分开转换与判断以定位错误"}},
    {"type": "based_on", "to": "lesson-relation-factor-observability"},
    {"type": "based_on", "to": "lesson-practice-typed-anchors"},
    {"type": "requires", "to": "method-two-fighting-readings"},
    {"type": "evaluated_by", "to": "experiment-structured-verifier-local"},
    {"type": "evaluated_by", "to": "experiment-structured-verifier-real-partial"},
    {"type": "evaluated_by", "to": "experiment-structured-split-heal"},
    {"type": "evaluated_by", "to": "experiment-minimal-fields"},
    {"type": "evaluated_by", "to": "experiment-mechanical-fields-replay"},
    {"type": "evaluated_by", "to": "experiment-mechanical-real-partial"},
    {"type": "evaluated_by", "to": "experiment-mechanical-rest-scheme"},
    {"type": "evaluated_by", "to": "experiment-isolated-role-repair"},
    {"type": "evaluated_by", "to": "experiment-target-only-role-repair"},
    {"type": "evaluated_by", "to": "experiment-relation-chain-dev"},
    {"type": "evaluated_by", "to": "experiment-event-kernel-split"},
    {"type": "evaluated_by", "to": "experiment-argument-router-replay"},
    {"type": "evaluated_by", "to": "experiment-full-practice-leak-replay"},
    {"type": "evaluated_by", "to": "experiment-fresh-dev-frozen-probe"},
    {"type": "evaluated_by", "to": "experiment-expanded-dev-quote-gate"},
    {"type": "evaluated_by", "to": "experiment-factor-choice-dev"},
    {"type": "evaluated_by", "to": "experiment-relation-confirm-dev"},
    {"type": "evaluated_by", "to": "experiment-binding-repair-regression"},
    {"type": "evaluated_by", "to": "experiment-heldout-binding-verifier"}
  ],
  "hypothesis": "充足上下文及忠实独立结构转换能使代码比较减少已有关系漏判，同时保留正常内容",
  "changes": "按speech和scoped quantity拆窄转换器，证据看不到候选，LLM不输出支持判决；代码取文、校验、比较和聚合，残留/歧义返回pending",
  "reason": "避免把复杂任务集成到同一prompt，并避免候选诱导证据转换和独立字段错拼",
  "next_unknown": "拆小角色/命题/状态转换及由代码分配图ID是否改善；真实输出遗漏报告关系并错对齐，尚无正常/数量成绩",
  "verification": "failed_partial_development_signal"
}
---

阶段：代码参考图测试→14题本地适用性盘点→6题两族烟测，最多21个逻辑调用/42 HTTP尝试和30000已知tokens，达到方向条件才考虑扩大。原整句对照单题调用，不含兄弟变体。参考结构不能进入被测模型；语义对应仍由模型转换提出并需独立审查，不能伪装成字符串匹配的确定性保证。上下文扩展另建协议、参考判断与对照，不能照搬旧成绩。未支持细节预注册out_of_scope，正常关系保留与正常整句pending分别报告。

设计阶段spawn一个只读审查subagent；随后用户明确要求实现，该subagent落初稿后因用量限制中断，主agent接手完成。29新测试通过、dry-run和6题人工结构oracle实际运行；未运行真实模型，没有独立验证或生产变更。unit/state窄枚举由代码比较，不让对齐模型判断字段等价；尚未支持类型及语义覆盖遗漏边界见结果文档。

后续真实运行：用户明确要求跑LLM后执行8次HTTP。p12-u整句baseline误放行，结构路线因证据遗漏报告关系及错误对齐返回未知，不是正确诊断；p11-u图指针/引文/覆盖契约失败。一次Network connection lost审计重启并预留未知用量，达到预算后停止；没有正常题或数量族模型成绩，本版不扩大、不融合。新增审计测试后30新测试通过。

后续split-heal-v0.3转换组件：不建全图，按TARGET句抽角色再逐报告抽状态，代码分配ID；原文/上次输出/实际校验错误最多回传一次。7TARGET真实执行、23HTTP/17071tokens，5自然反馈2接口修复3失败，另1注入引用修复。p11角色差异改善，但状态/否定错分、伪报告、上下文污染和裸substring误通过仍在；没有自动对齐及整句核验结果。详见SPLIT-HEAL-RESULT.md，不融合扩大。

后续minimal-fields-v0.4人类固定verb/命题诊断：18真实请求/10055tokens；单字段did not仍误判positive，would undermine单字段正确而组合误判negative。预注册参考单/组合均10/12，其中would时间分类有边界，不证明单字段总体优势。warn/future和confirm/completed在固定输入正确，旧失败仍含上游抽取负担；最小分类错误与混合干扰并存。窄代码对照仅在4固定输入成立，不能当一般核验器。

mechanical-v0.5接管受限报告动词/否定/辅助时态，roles仍模型；unknown不自动回退LLM。0远程调用离线回放固定12字段11确定正确/1would时间未知；新增词边界及完整错误列表，拦伪报告和坏锚点，但重复said引用定位会失败。新角色prompt/反馈未真实复测，上游抽取及整句能力仍未解决，不扩大融合。详见MECHANICAL-RESULT.md。

随后机械模式真实重跑：3HTTP，仅p11正常候选完成并正确连通角色→代码字段；源句两次连接丢失（审计重启一次后再次失败）立即停，552已知tokens+2未知usage。旧错误题未运行，没有self-heal或端到端效果结论；基础设施失败不是方案语义失败。见MECHANICAL-REAL-RESULT.md。

2026-09-18最终来源heldout验收更新：用户授权后首次打开c28/c51，核验组件与v0.19.1回归逐hash相同、先冻结再揭示。30文章60自编控制真Workers AI运行，漏放3/30=10%、忠实诊断未识别4/30=13.3%、正常误拦1/30；无规则增量，严格<10%目标失败。主Codex自编非盲、底层事件可能相关，不宣称完全独立验收。c28/c51已消耗，不得继续称未读/未接触heldout；后续调优需要另预留新验收材料。旧节点中的未读状态只描述当时历史，详见experiment-heldout-binding-verifier及其报告。

随后REST机械前置方案测试7TARGET全部执行，10HTTP/9265tokens无连接失败，4接口通过3失败。三次反馈未完整修复；p11-u合法两said因schema缺occurrence且要求唯一导致不可表示，是明确设计缺陷。source3不支持declined拖垮整体，p12源句上下文污染未修好。代码5报告12确定值正确/3时间未知，但两旧错误无完整自动检错结果，自动对应/整句聚合未实现，方案验收未通过；不扩大融合。详见REST-SCHEME-RESULT.md。
