# 功能开发流程（mattpocock skills）

> 从 `CLAUDE.md` 按需指过来：开发功能、选流程时读。

- 分流：改动点已知 → 主会话直接做。路清楚的功能 → `/grill-with-docs`（需求不清时）→ `/to-spec`。**用户只在这里介入**：回答 grill、审 spec。审完后 agent 提议开跑，用户同意即走项目 skill `.claude/skills/spec-to-impl/SKILL.md`：按指针读 matt 的 `to-tickets` / `implement` 原文拆票、派 worktree subagent 用 TDD 实现，主会话合并、跑全量验收。路看不清（架构搜索、换链路、治一类 LLM 错）→ `/wayfinder`，终点定为一份能交给 `/to-spec` 的设计
- LLM 输出质量不写进票的验收条件，读真实输出判断；票里只放确定性部分（接口、守卫、重试），测试接缝优先用 replay
- 大的功能或架构变更，合并后、部署生产前先在 staging 上跑一次 Staging 运行并读成稿（命令与注意事项见 `.claude/rules/workers.md` 第 5 节，决定见 `docs/adr/0013-staging-environment.md`）；小改动直接部署，上线后读生产的真实输出
- 审 spec 额外看两件事（模板里没有）：接口约定写死没有；新链路替换了什么、旧的删不删
- wayfinder 按「波」推进，不按「一个会话一张票」：一个会话把当前所有未阻塞的票推进完——调研、杂务、原型派 subagent 并行做，要用户回答的问题排队逐个问；一波结束更新地图时，检查这一波的几个决定彼此有没有矛盾；某个决定要等真实数据（cron、多次跑）时停，下个会话接着走下一波
- 原型读数写进地图前，要来自不挑选的数据、同一配置跑多次（`docs/adr/0006-eval-bootstrap-and-ruler-recalibration.md`）
