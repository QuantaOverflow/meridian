# mechanical-v0.5：真实调用因基础设施失败停止

2026-09-17。用户明确要求机械接管后继续真实LLM核验。真实 @cf/zai-org/glm-4.7-flash，provider workers-ai，角色抽取由模型完成，受限字段由代码生成，无远程judge。冻结7TARGET开发计划、不读heldout，无生产/部署/commit变化。

实际仅完成candidate:p11-s（正常候选句），source-1007986-3两次HTTP500，worker日志均为Workers AI binding Network connection lost。第一次故障保留记录、人工核对后只重启一次并恢复剩余第二尝试；第二次失败即停止、不再审计恢复或发其他请求，服务关闭。不是契约失败、不是语义拒绝，也不能归因模型能力。

3HTTP/2逻辑请求，唯一成功请求478input+74output=552已知tokens；2失败usage未知。第一次未知预留11292（保存请求UTF8 bytes5292+5000输出上限+1000额外）仅为预算估算，不是真实用量或可靠计费上界。第二次未知未登记恢复预留，运行停止，禁止再次发送。run-state预算账11844不代表本轮全部usage；总账单金额未知。累计请求14.399秒非墙钟。results.json成本快照未含第二次连接失败，最终尝试以calls.jsonl/run-state.json为准。

## 主Codex本地复核正常候选

模型抽取两个报告行为完整且忠实于此目标句：Meink→told→revealing more would undermine deterrence，reporters是recipient；Meink→said→announcement was worded to deter adversaries。没有把错误候选改正的观察，因为错误候选未运行。

代码输出told/said均say、两个命题均positive；would时间unknown，was worded状态completed，符合此受限字段定义。上轮LLM分类told→warn、would undermine→negative在本轮字段路径不再出现，但这是代码接管的组件效果，非独立端到端核验收益。没有源句对应或整句接受/拒绝模块，也没有错误题检测或正常整句保留成绩。

计划7TARGET，1完成、1源句仅基础设施失败、5未发送。失败源句位置在任一旧错误候选之前，无法评价self-heal完整错误列表效果、源p12警告与候选确认差异或说话人错误检测。当前新信号仅为实际请求与代码字段路径连通，不能称已解决旧问题，不扩大融合。

本地45测试通过；pnpm typecheck退出0、4缓存命中，不构成模型语义验收。产物out/atomic-evidence/mechanical-v0.5/：plan.json、calls.jsonl、cache请求/raw/attempt messages、results.json、run-state.json、recovery-audit.json。既有离线replay.json保持历史；本报告是本地主Codex语义复核，不修改被测模型答案。
