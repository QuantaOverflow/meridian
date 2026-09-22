---
name: record-knowledge
description: 在 Meridian 项目中，用户要求记录、保存、补充或整理探索知识、实验、经验或决定时使用，支持显式调用 $record-knowledge。将已有对话和真实证据写入项目知识图谱并重建校验；不用于一般解释、无记录意图的代码修改或全局个人记忆。
---

# Record Knowledge

将已有证据保存为可检索的项目知识，不生成看似完整但没有证据的经验。

## 入口与范围

- `$record-knowledge` 未指定主题时，记录当前会话最近一轮已完成或中断的探索；指定主题或证据路径时，以指定范围为准。多个主题无法判断时先问一个简短问题。
- 调用本 skill 或明确要求保存知识，授权本项目记录及生成文件更新，不包括提交、部署、外部服务写入、个人记忆更新或新实验。
- 只复用已有对话、日志、产物与文献；不得为补记录额外调用远程 LLM、重跑实验或读取未获授权的 heldout。

## 1. 规则与历史

1. 定位包含本 skill 的 Meridian 仓库根目录（本目录向上三级），后续路径与命令以该根目录为准，不依赖启动工作目录。
2. 完整读取 `AGENTS.md`、`docs/knowledge/README.md`、`scripts/knowledge/schema.json`，读取 `CLAUDE.md` 的知识蒸馏与文件归属部分；以当前规则为准，不维护重复 schema。
3. 检查 `git status --short`，保护用户及其他 agent 的未完成修改。
4. 用 `rg` 在 `docs/knowledge/INDEX.md` 按任务检索，只读相关节点和证据，不加载整个图谱。需要起始格式时读取 `docs/knowledge/templates.json`，不要保留占位内容。
5. 简短说明准备记录什么、相对历史新增什么。证据不清时收窄结论，不补造事实。

## 2. 最小、真实的记录

- 按需要选择 attempt / experiment / lesson / mechanism / decision，不凑齐六类。只有用户主动要求目标节点时才创建 goal，不建议把建 goal 当下一步。
- 新实验条件或结果追加 experiment，关联对应尝试；没有新认识复用已有 lesson，不制造新经验。一次模型调用不必单独入图。
- 未执行方案标 proposed；阶段未结束保留已有信号与未完成事项。采用决定、代码接入、部署、端到端达标分别描述。
- 保留失败、正常对照及不同条件的实验历史，不为消除矛盾或通过校验删除历史；收窄范围或用合法替代关系保留演进。

## 3. 证据与关系

只维护 `docs/knowledge/nodes/<id>.md`，使用 README 规定的 JSON frontmatter 与可读正文，用 `apply_patch` 局部编辑。

记录能够确认的内容：

- 实际假设、相对历史的变化、输入和正常对照、方法、结果、失败类型。
- 模型参数、代码/prompt/数据/评测版本、原始证据路径、成本及条件；未知写未知，历史摘要用 `record_completeness: summary_only`。
- 指标给分子和分母；开发集、提示构造样本、独立/盲评、heldout 分开，环境/契约失败与语义错误分开。
- 实测事实、解释性推断、文献依据和未验证方案分开。机械通过或模型自报通过不是独立语义验收；局部有效不等于组合有效。
- 机制的输入、输出、限制、适用前提与失效条件；中断时的未完成事项。

读取可访问来源后再归纳。来源不可访问时明确是会话摘要或未核实引用，不声称已读；正文保存关键结果，不只依赖易丢失的临时文件。不要复制凭证或敏感原始数据。

按当前 schema 检查关系方向、端点类型与必填 attributes，目标节点必须存在。不按文件名前缀猜类型，不造空壳节点消除悬空引用。本轮相互引用的节点一次写完后再生成。

## 4. 重建和只读校验

在仓库根目录执行：

```sh
pnpm -s knowledge
pnpm -s knowledge --check-generated
```

不要手改 `INDEX.md` 或 `graph.json`；无需修改节点时只执行只读检查。

若明确遇到 tsx IPC 的 `listen EPERM`，使用同一构建入口绕过启动器：

```sh
node --experimental-strip-types scripts/knowledge/build.ts
node --experimental-strip-types scripts/knowledge/build.ts --check-generated
```

准确报告 pnpm 失败与备用命令结果。结构错误仅做有证据、在本轮范围内的修复，不削弱 schema、删除历史或擅改其他会话正在写的节点；无法安全修复时报告具体阻碍。Stop hook 只负责只读校验，不替代主动记录和语义判断。

## 交付

简短列出新增/更新节点、新认识与边界、重建和校验结果。没有新记录价值时说明复用了什么及为何不新建。不把结构校验说成结论正确或方案达标。

示例：`$record-knowledge 记录本轮 harness 诊断，保留失败条件和未验证部分。`
