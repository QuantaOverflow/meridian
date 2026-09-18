# 探索历史图谱

记录之前做过什么、踩过什么坑、哪些局部机制有突破，以及下一轮为什么值得做。存在的理由仍是：同一条死路不要走第二遍，但旧失败不能变成禁止重试的教条。

## 开工前怎么查

从 [INDEX.md](INDEX.md) 的任务入口开始，沿尝试 → 实验 → 经验 → 可复用机制阅读。提出新方案前写清：

```text
要解决的目标与验收标准：
最相关的旧尝试、失败原因与适用范围：
可复用的机制及尚未验证的部分：
这次相对旧尝试改变什么，为什么可能有效：
本轮唯一未知、最小对照、成本上限与停止条件：
```

语义相似只用来找候选历史，不足以证明两次尝试等价。比较机制、材料、表示、职责边界、模型、反馈与验收条件；只改措辞也可复测，但注明是在测试敏感性或稳定性。没有新信息需求时优先复用原始缓存，不重新采样。

## 六类实体

| type         | 保存什么                                 | 注意                                                                                                   |
| ------------ | ---------------------------------------- | ------------------------------------------------------------------------------------------------------ |
| `goal`       | 目标、约束与验收标准                     | 旧 invariant 属于约束型 goal；不可为了新方案事后改尺                                                   |
| `attempt`    | 方案、假设、关键变化与下一步未知         | 一个尝试可有多次实验；尚未执行的方案不能写成已验证                                                     |
| `experiment` | 一次实验、分析或文献证据摘要的条件与结果 | `kind` 区分 probe、prototype_evaluation、retrospective_analysis、literature_review；文献不等于本仓复现 |
| `lesson`     | 观察、失败机制、权衡与适用范围           | 经验是对证据的解释；既可失败又可贡献突破                                                               |
| `mechanism`  | 可复用职责的输入、输出与限制             | 旧 method 作为方法型 mechanism；局部组件必须另验组合效果                                               |
| `decision`   | 采用、暂缓、淘汰或融合及其依据           | 决定采用、代码接入、部署与端到端达标分别记录                                                           |

```text
目标 <- addresses -- 尝试 -- varies_from --> 旧尝试
                       |
                       +-- evaluated_by --> 实验 -- yields --> 经验
                       |                                      |
                       +-- contains --> 机制                  +-- motivates --> 新尝试
                       |                  |
                       +-- incorporates --+-- justified_by --> 经验

决定 -- based_on --> 实验 / 经验
决定 -- selects --> 尝试 / 机制
新决定 -- supersedes --> 旧决定
```

所有关系的方向、合法端点和必填属性见 [schema.json](../../scripts/knowledge/schema.json)。核心关系与讨论中的设计一致；补充 `constrained_by`、`requires`、`supports`、`cautions`、`selects` 以保存原图谱约束、条件性证据与决定对象。`supersedes` 也允许同类经验与方案更新。

## 文件与字段

`nodes/<id>.md` 是唯一维护源。frontmatter 使用 **JSON 对象**（JSON 是 YAML 的子集），正文保存可读说明。这样关系可以携带属性，不依赖自制的逗号分割解析器。旧文件路径保留，文件名前缀不决定实体类型。

通用必填：`id`、`type`、`title`、`date`、`status`、`tasks`、`scope`、`source`、`conditions`、`evidence_origin`、`relations`。类型专属字段与端点约束由 schema 校验。

- `status` 描述该实体的生命周期，例如 proposed、candidate、accepted、historical、superseded；**live 不代表验证通过或部署**。
- 实验 `outcome` 单独记录 passed、failed、mixed、observed、not_evaluated。通过只限于 `scope` 与 `evaluation`，不是泛化证明。
- `record_completeness: summary_only` 明确表示历史摘要，缺失的模型配置、prompt/code/data/evaluator 版本、输入清单及成本写“未知”，不得补造。
- `source` 指向实际文档、产物或文献；本地文件可能未入 git，跨机器不保证可访问。关键结果与边界需蒸馏进节点正文。
- 实验正文尽可能记录模型及参数、代码/prompt/数据/评测版本、原始缓存位置、对照、失败类型和成本。结构校验与独立语义评价分开，评测来源与是否盲评也要注明。
- `conditions` 与 `invalidates_when` 保留适用前提和重新探索的触发条件；小样本通过、扩展失败分别建实验，不覆盖早期结果。

最小新方案示例：

```json
{
  "id": "attempt-example",
  "type": "attempt",
  "title": "本轮方案",
  "date": "2026-09-17",
  "status": "proposed",
  "tasks": ["治事实关系错"],
  "scope": "仅开发对照，不读 heldout",
  "source": "填写实际 GOAL 文档路径",
  "conditions": ["验收尺固定"],
  "evidence_origin": "proposal",
  "verification": "proposed",
  "hypothesis": "填写可检验假设",
  "changes": "填写机制或接口变化",
  "reason": "填写为什么这个变化可能绕过旧失败",
  "next_unknown": "填写本轮唯一未知",
  "relations": [
    { "type": "addresses", "to": "goal-cluster-to-brief" },
    {
      "type": "varies_from",
      "to": "attempt-auto-risk-question",
      "attributes": { "changed": "明确改变什么", "reason": "明确为什么" }
    }
  ]
}
```

六类 frontmatter 起始模板见 [templates.json](templates.json)。替换所有占位说明并添加真实关系，不将模板直接复制为实际证据。

## 按实际进展记录与融合

以下是按实际需要选择的动作，不是必须依次执行的流水线；没有新经验无需建 lesson，没有融合决定无需组合。

1. 追加 experiment，链接被测 attempt；写明实际条件、结果、证据与成本，环境失败不能算方案质量失败。
2. 新建或更新 lesson，以 experiment 的 `yields` 连接；成功经验与失败经验同等重要。
3. 值得保留的局部功能建 mechanism，写输入输出与限制，用 `justified_by` 连接经验。一个整体原型表现好不证明单组件效果。
4. 组合方案用 `incorporates`，必填 `adaptation`；实验对照与消融验证组合是否保留优势，而不是把局部指标相加。
5. 决定用 `based_on` 与 `selects`，保留后续取代历史。没有新信号时停止机械重跑。
6. 运行 `pnpm -s knowledge`，全部实体与关系通过校验后生成索引、反向链接与 `graph.json`；生成文件不手改。

```bash
pnpm -s knowledge          # 校验并生成
pnpm -s knowledge --check  # 只校验结构，不写文件
pnpm -s knowledge --check-generated # 同时检查生成文件一致性
node --experimental-strip-types scripts/knowledge/build.test.ts
```

## Codex 结束检查

使用与维护时机由根目录 `AGENTS.md` 指导。`.codex/hooks.json` 在回复结束时调用 `scripts/knowledge/stop-hook.ts`。首次运行完整校验；之后比较节点、生成文件、schema 和校验脚本的内容指纹，无变化就静默跳过完整校验。成功指纹保存在系统临时目录，缓存丢失后重新校验；不会修改知识库或调用 LLM。

校验失败要求 agent 修复一次；自动续跑后仍失败则提示未解决项，避免无限循环。hook 不能判断是否遗漏经验或证明结论正确。首次启用需在 Codex CLI `/hooks` 审查并信任配置；配置变更后需重新信任。本地命令测试不等于客户端已启用。

```bash
node --experimental-strip-types scripts/knowledge/stop-hook.test.ts
```

## 迁移边界

见 [MIGRATION.md](MIGRATION.md)。这是历史记录重构，未重跑 LLM，未证明组合架构达标，未读取 heldout。
