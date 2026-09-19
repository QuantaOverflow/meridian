---
{
  "id":"experiment-claude-knowledge-harness-compatibility",
  "type":"experiment",
  "title":"Claude Code知识库harness兼容性诊断：底座可共享，规则入口与Stop注册尚待适配",
  "date":"2026-09-18",
  "status":"recorded",
  "tasks":["维护探索知识库","提高链路健壮性"],
  "scope":"本地Claude Code 2.1.269配置静态检查、现有Stop脚本5项测试及官方协议核对；未修改客户端配置，未在Claude会话中验证真实触发",
  "source":"scripts/knowledge/stop-hook.ts + scripts/knowledge/stop-hook.test.ts + https://code.claude.com/docs/en/hooks + https://code.claude.com/docs/en/memory",
  "conditions":["主agent只读检查项目及用户Claude settings中的hook事件与knowledge匹配，不输出其他配置或secret；项目settings.json不存在，settings.local.json只有SessionStart/UserPromptSubmit，没有知识库Stop注册，已检查用户文件也无知识库Stop注册；运行时/plugin/managed配置未验", "Claude官方文档说明默认读取CLAUDE.md而非AGENTS.md，支持@AGENTS.md导入；本项目CLAUDE.md有知识库摘要，但无该导入，现有本地hook命令也没有显式引用AGENTS或knowledge，脚本间接行为未全面审计", "Claude官方Stop支持hook_event_name、stop_hook_active及decision:block/reason；现脚本相应协议匹配、有内容指纹成功缓存、只读检查和一次续跑上限。此为静态协议兼容判断，不是客户端触发证据"],
  "evidence_origin":"local_record",
  "relations":[],
  "kind":"retrospective_analysis",
  "outcome":"observed",
  "inputs":"现有AGENTS.md/CLAUDE.md/docs/knowledge、.codex/hooks.json、scripts/knowledge，以及项目与用户Claude设置；官方Claude memory/hooks文档",
  "evaluation":"node --experimental-strip-types --test scripts/knowledge/stop-hook.test.ts实际5/5通过，含有效配置命令从根/子目录输出JSON、损坏图拦截、不变缓存及stop_hook_active防无限续跑；没有运行claude -p或调用任何被测LLM，Claude实际加载/触发未验证",
  "result":"知识节点、schema、build及Stop核心不用复制迁移。需要入口适配：将共享完整维护规则明确接入CLAUDE.md（可@AGENTS.md导入，保留现有工程约定）；把Stop注册合并到.claude/settings.json或settings.local.json且保留已有hook。建议Claude命令以CLAUDE_PROJECT_DIR锚定同一脚本，不删除Codex入口；然后用Claude /hooks及实际合法/非法/续跑场景验收。多会话共享树会看到对方中途节点变更，不应把所有失败归于当前会话或为通过检查补造经验。所有适配仍proposed，用户本轮只请求诊断",
  "cost":"零远程LLM调用；本地5测试约0.76秒；官方文档两页面核对；未修改配置、hook逻辑、业务代码或迁移知识文件",
  "record_completeness":"complete"
}
---

结论是小范围客户端入口适配而非知识库迁移。支持同时使用Codex与Claude，维护同一份nodes/schema和校验程序。指纹缓存只证明当前结构/生成文件检查成功，不证明记录完备、语义正确或Claude规则已经执行。

本轮仅将兼容性诊断入库；未实施建议，未对Claude现有会话、插件或组织管理设置做写入。未来的客户端真实触发测试应与这次本地单元测试分开记录。
