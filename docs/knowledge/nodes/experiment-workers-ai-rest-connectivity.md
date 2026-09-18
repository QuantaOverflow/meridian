---
{
  "id": "experiment-workers-ai-rest-connectivity",
  "type": "experiment",
  "title": "开发binding替代REST：短6/6、长4/5成功，认证异常仍未消除",
  "date": "2026-09-17",
  "status": "recorded",
  "tasks": ["提高链路健壮性", "治事实关系错"],
  "scope": "本地开发Workers AI连接诊断，现有Wrangler OAuth+官方REST；非长期SLA或语义验收",
  "source": "scripts/eval/cluster-to-brief/arms/atomic-evidence/structured-verifier/CONNECTION-RESULT.md",
  "conditions": ["固定真实glm-4.7-flash/thinking off，官方REST指定Gateway/skip-cache，绕过wrangler remote binding", "现有凭证只进程内使用，不输出保存、不新登录修改权限；首失败停，有界组测试，保留401", "组间时间/认证会话存在变化，不能因果证明binding是唯一根因；Gateway观测日志未另查"],
  "evidence_origin": "local_record",
  "relations": [{"type":"yields","to":"measure-retry-signature-gap"}],
  "kind": "probe",
  "outcome": "mixed",
  "inputs": "项目token1请求；OAuth短5请求、代表长1、短长配对2、长确认3，共12HTTP；长输入同source-1007986-3冻结角色prompt/schema",
  "evaluation": "HTTP200且OK或可解析acts计连接成功，非语义成绩；固定预算/请求上限、首失败或usage未知停；原型adapter模拟测试另记",
  "result": "项目token401/10000；OAuth短6/6成功、长4/5成功（一次401），最后长3连续成功。提供REST可选transport并缓存route版本，避免依赖不稳开发binding；未重跑整个REST机械核验计划、未保证长期稳定，语义角色错误仍存在",
  "cost": "12HTTP，10成功4898input+495output=5393已知tokens；2次401无usage，未按0用量计；金额未知；无后台worker或部署",
  "record_completeness": "complete"
}
---

HTTP连接层、认证层、模型输出语义分开记。专用有效Workers AI权限token或用户控制有效OAuth会话是后续条件；重试不能替代正确凭证。新替代路径不消除历史binding故障，也不将成功JSON当核验正确。
