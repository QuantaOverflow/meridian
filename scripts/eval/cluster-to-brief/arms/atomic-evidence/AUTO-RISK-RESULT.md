# 自动风险问题规划：首次开发信号失败

2026-09-17。延续 RISK-RESULT.md 的人工单问题原型；仅四个 c36 开发样本，没有读 heldout。

## 最小实验

规划器只见候选文本，不见证据、样本标签或人工问题。输出每句 1–3 个带精确 claimSpan 的窄问题，要求命名对象与报道主体分开，保持归因作用域及时间方向。模型为 Workers AI glm-4.7-flash，是被测开发模块，不是 LLM judge。
程序只校验样本顺序、问题数量及 claimSpan 子串。Codex 在当前会话检查问题是否完整、独立、保留候选含义；规划失败后未调用下游 specialist。

## Codex 判定

| 候选                                    | 实际问题                                                                | 本地判定                                                                               |
| --------------------------------------- | ----------------------------------------------------------------------- | -------------------------------------------------------------------------------------- |
| t1：state media 报道 El Gaia 触雷并爆炸 | 三条均以整句作 span，反复询问媒体是否报道、船是否触雷、是否报道触雷爆炸 | 失败；未单独检查报道主体身份和船名是否由证据明确识别，窄任务边界没有形成               |
| t2：Iran 声称油轮触雷                   | 分别问是否提出声明、声明是否涉及触雷、声明地点                          | 归因作用域基本保持，但整句 span 无维度锚点；与其他样本一样总填满三个问题，成本收益不明 |
| t3：船遇袭晚于管道损坏                  | 问 after、precede、before 三种同义表达                                  | 失败；三个问题都检查同一时序，不是三个独立风险                                         |
| t4：价格上涨晚于船遇袭                  | 问 after、cause、following                                              | 失败；候选只断言时间顺序，cause 增加未声明因果，可能制造正常句误杀                     |

本轮只评规划质量，不能据此声称下游 gate 的漏判或误杀率。首次有效 HTTP 调用耗时 15.70 秒，336 input / 526 output tokens，看到信号即停，无远程 judge。
原始缓存：`out/atomic-evidence/auto-risk-plan.json`；调用记录：`auto-risk-calls.jsonl`。规划输出满足结构契约，但不满足语义接口要求。

## 决策

不把自由生成问题的 planner 与 specialist 融合：它可能把已证伪的通用 gate 包成三个重复问题，并引入额外判断标准。
保留 specialist 单问题接口。下一轮探索受约束的风险槽：speaker identity、named object identity、action strength、attributed proposition、temporal pair/direction 等；模型只能定位和填槽，代码用模板生成问题，不让模型自由把 after 改成 cause。
风险槽本身仍是待验证设计。需要特别测 absent dimension、复合句及 attributed proposition，避免重演全维度假检查；不能仅因模板化就声称完整安全。
