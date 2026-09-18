# Workers AI连接诊断：REST替代开发binding

2026-09-17。此前wrangler dev远程binding多次Network connection lost，两次重启恢复实验均部分失败。旧知识measure-retry-signature-gap记录连接故障不同于模型容量/超时，增加重试不保证恢复。本轮不改生产或部署，比较替代调用路径与凭证条件，所有模型仍@cf/zai-org/glm-4.7-flash、thinking off，不调用远程judge。

官方REST文档：https://developers.cloudflare.com/ai-gateway/usage/rest-api/ 。使用api.cloudflare.com /accounts/{account}/ai/run/{model}，指定cf-aig-gateway-id与skip-cache；REST需要Workers AI权限，AI Gateway权限不等于推理权限。只是请求指定Gateway，本轮没有额外读Gateway日志来证明观测完整。

## 真实探测，失败全部保留

- .dev.vars项目API token：1请求401/10000，未推理成功。认证失败不能证明网络不通，不能仅凭码区分无效token/权限等具体根因。
- 现有Wrangler OAuth登录会话，token在子进程pipe内捕获解析，绝不打印或保存：5次64token短OK串行探针5/5成功。
- 同会话方式长schema负载（此前binding失败的source-1007986-3冻结prompt/schema）单请求401/10000。没有改权限或新登录，不能把该异常删掉或称永久稳定。
- 新进程取现有会话，同一固定token先短再长配对：2/2成功。
- 最后固定3次长schema请求：3/3成功，随后停止本轮探测。

总12HTTP：现有OAuth短6/6，长4/5；项目token0/1。10成功共4898input+495output=5393已知tokens，2次401无usage，未知用量不计零；金额未知。每个探测组首失败/未知usage即停、最多5请求，长组已知8000tokens停止线、45秒请求超时，未无限重试。最后3个长请求分别2880/3023/1703ms。样本小、组间可能有刷新/时间窗口差异，不能因果证明binding代理是唯一根因，也不能证明长期SLA。

## 实现与接入

connection-probe.mjs提供可复现有界短/代表负载探测，记录HTTP、数值错误码、usage与返回输出，不记录headers/token。rest-transport.mjs提供固定官方host、固定Workers AI模型的transport，保留schema/参数/thinking-off，归一化响应至原runner envelope；只输出数值错误码，401不自动刷新/重试。BoundedClient新增可选transport，split-heal runSplit新增transport并在请求缓存键写transportVersion，使用独立mechanical-rest-v0.5输出目录，默认历史binding模式保留。

接入API（本轮适配层模拟测试通过，尚未重跑整个REST机械核验计划）：

```js
import { createRESTTransport } from './rest-transport.mjs';
import { runSplit } from './split-heal.mjs';
await runSplit({ remote: true, mechanical: true, transport: createRESTTransport() });
```

仍需授权env标志、有效现有Wrangler登录、Node网络权限。不新登录、不修改用户网络/权限配置。建议下一轮先短探针，再走REST计划；401或未知usage停并保留证据，登录失效需要用户控制重新登录或提供具备正确权限的专用凭证，不能通过无限重试掩盖。

51本地测试通过，包含凭证不入产物、401只发一次、未知usage停止、adapter固定host/model/schema/usage与错误脱敏。pnpm typecheck退出0缓存结果不认证mjs语义。HTTP200/JSON acts只算连接与可解析响应，不是角色转换正确；代表负载输出仍有send/declined伪报告等问题，未将其计作核验语义达标。

产物out/atomic-evidence/connection-rest-{v1,session-v1,representative-v1,paired-v1,confirm-v1}/各组calls.jsonl及result.json。无生产写入、部署或heldout。结论：替代通路可用，最后三次长负载连通；认证有异常历史，不能保证永不掉线。
