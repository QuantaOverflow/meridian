---
{
  "id": "decision-eval-module-contracts",
  "type": "decision",
  "title": "eval 按 dataset/solver/scorer/judge 四层定契约,借 Inspect 的概念但不引入框架",
  "date": "2026-09-20",
  "status": "accepted",
  "tasks": ["设计验收门"],
  "scope": "scripts/eval/cluster-to-brief 整个模块;不含生产代码",
  "source": "scripts/eval/cluster-to-brief/CONTRACTS.md;docs/adr/0005-eval-bootstrap-and-ruler-recalibration.md",
  "conditions": [
    "判官是 Claude Code 的 subagent,零 API 费;引入 Inspect 会把它改成付费 API 调用",
    "生成侧全在 JS,Inspect 的 solver 需 shell 调 JS,多一层边界"
  ],
  "evidence_origin": "local_record",
  "relations": [
    {"type": "based_on", "to": "lesson-judge-needs-alignment"},
    {"type": "based_on", "to": "lesson-handpicked-fixtures-dont-extrapolate"},
    {"type": "based_on", "to": "lesson-coverage-metric-pushes-listing"},
    {"type": "based_on", "to": "lesson-run-variance-needs-epochs"}
  ],
  "action": "adopt",
  "invalidates_when": "判官需要无人值守跑(进 CI/定时),或有第三方要复现这套 eval——那时再评估引入 Inspect"
}
---

**定下的四条不变量**(全文见 `CONTRACTS.md`):

1. **dataset 定在最宽的稳定边界**:一天全量文章 + 聚类快照 + 选中列表,而不是当前架构的入口。
   架构往上游挪(比如把事件分离前移)时 dataset 不用重做。
2. **标注挂在输入上**:事件分组、杂质名单、事件清单都是输入的属性,换架构不失效。
3. **判据只描述输出性质,不得出现结构词**。`requireSplitOrReject(必须拆 ≥2 块)` 换成
   `noEventMixing(每个块引用的文章必须落在同一事件组内)`——一块、多块、判不可写都适用,
   实测 v1 的五块输出与 v6 的一块输出能用同一条判据比较。
4. **评分与生成分离**:scorer 只读已落盘的产物,任何时候可重跑,改判据不必重新生成。
   这条直接抄自 Inspect 的 offline scoring。

**从 Inspect 抄的**:solver 是任意代码、scorer 只看输出与 target、多 scorer 并列、
sample 带 metadata 供分层、epochs + 归约、样本级错误是一等状态、日志记全配置。

**没抄的**:框架本身。理由见 conditions。

**Inspect 也不负责的两件**(正是这一轮栽的地方):判官准不准、判据该定成什么。
