# 功能开发流程（mattpocock skills）

> 从 `CLAUDE.md` 按需指过来：开发功能、选流程时读。

- 分流：改动点已知 → 主会话直接做。路清楚的功能 → `/grill-with-docs`（需求不清时）→ `/to-spec` → `/to-tickets` → 每张票派 worktree subagent 按 matt 的 `implement` + `tdd` 做，主会话合并、跑全量验收。路看不清（架构搜索、换链路、治一类 LLM 错）→ `/wayfinder`，终点定为一份能交给 `/to-spec` 的设计
- LLM 输出质量不写进票的验收条件，上线后读真实输出判断；票里只放确定性部分（接口、守卫、重试），测试接缝优先用 replay
- 审 spec 额外看两件事（模板里没有）：接口约定写死没有；新链路替换了什么、旧的删不删
- wayfinder 按「波」推进，不按「一个会话一张票」：一个会话把当前所有未阻塞的票推进完——调研、杂务、原型派 subagent 并行做，要用户回答的问题排队逐个问；一波结束更新地图时，检查这一波的几个决定彼此有没有矛盾；某个决定要等真实数据（cron、多次跑）时停，下个会话接着走下一波
- 原型读数写进地图前，要来自不挑选的数据、同一配置跑多次（`docs/adr/0006-eval-bootstrap-and-ruler-recalibration.md`）
