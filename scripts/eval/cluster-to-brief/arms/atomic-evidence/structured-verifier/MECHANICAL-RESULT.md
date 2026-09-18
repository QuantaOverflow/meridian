# mechanical-v0.5：代码接管受限字段

2026-09-17。根据最小字段真实实验：显式did not仍被LLM判positive，would undermine组合任务被判negative。本轮改变职责而非再改分类prompt：roles仍LLM转换，reportMode/eventState/polarity改由mechanical-fields.mjs生成，带rule/cue或unknown/reason。历史原文和模型答案不改。

## 接管及边界

- 显式报告动词有限词典，said/told→say，warn/warned→warn，confirmed→confirm等；只接收单动词或has/have/had+动词。动作谓语/整句/词典外返回unknown，并在机械角色接口列为不支持错误，不自动套近义词。
- 否定/时间仅处理限定单谓语模板：will/would/did/had already/had been/was/has与accelerate/undermine/worded/chosen/deployed有限搭配，并检查词形。没有not时只在这些受支持语法中判positive，不采用普遍“无not=肯定”。负面后果不等于语法否定。
- would的预测/假设不能靠词面区分，时间unknown。嵌套关系、条件、并列谓语、引号、其他模态、外部否定和未知语法返回unknown，不自动让LLM重新分类。Russia and China具名并列单独允许；不是通用句法规则。
- 代码校验唯一精确词边界span，he不能匹配the。全部检测到的角色span/动词/重复错误一次反馈，继续最多一次self-heal。未实现语义遗漏检测，空acts仍可能接口通过；严格唯一引用也会拒绝重复said，属于定位义务不是语义错误。

机械模式：split-heal.mjs --mechanical，out独立mechanical-v0.5，不发送状态分类请求；历史默认v0.3路径保留，未事后篡改已有实验。

## 已执行验证

本轮0远程调用，离线回放以前真实模型输出；不宣称新角色prompt或新错误反馈已经真实验证。mechanical-replay.mjs读取v0.4/v0.3 results和冻结plan，单独写mechanical-v0.5/replay.json。

4固定命题12字段：11个确定值与本地语义复核一致，1个would时间保留unknown。m1 warn/future/positive；m2 confirm/completed/positive；m3 say/unknown/positive；m4 say/completed/negative（m4明确合成对照）。这修复了旧v0.4三条明确polarity错误记录，不能当独立成功率或端到端成绩；同输入开发回归有选择偏差。

v0.3七目标：三个角色输出通过新机械校验，三个新增接口失败，一个原契约失败未恢复。source sentence3拦he词内匹配及两长verbQuote；p12-u拦had already accelerated伪报告；p11-u两个said因重复不能唯一定位，新接口拒绝，未把它计作语义检错。通过的三个角色输出共4报告字段，由代码修正told误判warn及would类否定错分，3个would时间未知。源p12转换失败仍在，不能完成警告→确认整句核验。

8新增测试（加历史共45）：固定原文、受限正常/否定配对、would未知、scope/模态/非法词形回退、词边界/重复引用、全部错误反馈，以及机械runner模拟7角色请求且无LLM状态请求。模拟empty acts只测传输路由，不证明语义覆盖。pnpm typecheck退出0，4缓存命中，不认证新mjs语义。完整测试实际结果见本轮命令；知识库另行生成校验。

无生产变更、部署、commit、heldout或自动对齐/整句接受。没有把未知重算通过，也不扩大融合。未解决：角色/共指/命题边界抽取、语义覆盖、重复span定位、复杂语法及整句对应关系。
