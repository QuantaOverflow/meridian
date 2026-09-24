---
name: record-knowledge
description: 在 Meridian 项目中，用户要求记录、保存、补充或整理探索知识、实验、经验或决定时使用，支持显式调用 $record-knowledge。将已有对话和真实证据写入本地探索记录并重建校验；不用于一般解释、无记录意图的代码修改或全局个人记忆。
---

# Record Knowledge

将已有证据保存为可检索的项目知识，不生成看似完整但没有证据的经验。

## 入口与范围

- `$record-knowledge` 未指定主题时，记录当前会话最近一轮已完成或中断的探索；指定主题或证据路径时，以指定范围为准。多个主题无法判断时先问一个简短问题。
- 调用本 skill 或明确要求保存知识，授权更新本地知识库（`docs/knowledge/`，不入 git），不包括提交、部署、外部服务写入、个人记忆更新或新实验。
- 只复用已有对话、日志、产物与文献；不得为补记录额外调用远程 LLM、重跑实验或读取未获授权的 heldout。
- 本地没有 `docs/knowledge/` 时，说明这一点并停止，不新建知识库。

## 步骤

1. 定位包含本 skill 的 Meridian 仓库根目录（本目录向上三级），后续路径与命令以该根目录为准。
2. 完整读取 `docs/knowledge/README.md`。什么时候写、写什么、记录格式都以它为准，本 skill 不重复这些规则。
3. 用 `rg` 在 `docs/knowledge/INDEX.md` 与 `nodes/` 按任务检索，只读相关记录和证据；有旧记录可更新就不新建。
4. 简短说明准备记录什么、相对历史新增什么。证据不清时收窄结论，不补造事实；来源读不到时写明是会话摘要或未核实引用。
5. 编辑 `docs/knowledge/nodes/<id>.md`，本轮相互引用的记录一次写完再生成。
6. 在仓库根目录重建并只读校验：

   ```sh
   pnpm -s knowledge
   pnpm -s knowledge --check-generated
   ```

   遇到 tsx IPC 的 `listen EPERM` 时改用 `node --experimental-strip-types scripts/knowledge/build.ts`（校验加 `--check-generated`），并如实报告。
   结构错误只做有证据、本轮范围内的修复，不削弱校验、不删历史、不改其他会话正在写的记录。

## 交付

简短列出新增/更新的记录、新认识与边界、重建和校验结果。没有新记录价值时说明复用了什么及为何不新建。不把结构校验说成结论正确或方案达标。

示例：`$record-knowledge 记录本轮 harness 诊断，保留失败条件和未验证部分。`
