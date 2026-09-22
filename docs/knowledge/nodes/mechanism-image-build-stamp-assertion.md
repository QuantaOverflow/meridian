---
{
  "id": "mechanism-image-build-stamp-assertion",
  "type": "mechanism",
  "title": "镜像内构建戳做部署身份断言：RUN date 层排在 COPY ./src 之后，源码变它必变",
  "date": "2026-09-22",
  "status": "proposed",
  "tasks": ["运维容器部署"],
  "scope": "CF Container（壳 + 镜像分离）形状下的版本断言设计；**未接线、无运行数据**，只有推理与被它否掉的两个替代方案",
  "source": "2026-09-22 清理轮中对 2026-09-05 镜像未推成功故障的设计推理；相关故障记录见 lesson-container-image-deploy-gap",
  "conditions": [
    "要求容器镜像的构建过程可控（能在 Dockerfile 里加层）",
    "要求层顺序正确：构建戳层必须排在 COPY ./src 之后，否则被缓存复用、失去信号"
  ],
  "evidence_origin": "local_analysis",
  "relations": [
    {"type": "justified_by", "to": "lesson-echoed-field-cannot-assert-version"},
    {"type": "based_on", "to": "lesson-container-image-deploy-gap"}
  ],
  "input": "Dockerfile 里一层 `RUN date`（排在 `COPY ./src` 之后）写出的构建戳，随响应回传",
  "output": "调用侧可读的镜像身份：① 字段存在与否（零配置档，抓「跑的是加字段之前的镜像」）；② 构建戳值与期望比对（抓「镜像旧于某次源码变更」）",
  "limits": "只证明镜像何时构建，不证明构建的是哪个 commit；纯参数值变更（不新增字段）抓不到；构建戳层放错位置（在 COPY ./src 之前）会被缓存复用，信号失效；期望值那一档需要维护，维护错了就退化成常响的闸（见 lesson-always-firing-gate-is-ignored）",
  "invalidates_when": "wrangler 支持把真实 commit SHA 作为运行期可读的构建元数据注入镜像（届时直接用 SHA 更准），或部署链路改成调用侧与镜像原子发布"
}
---

## 为什么不是传 SHA

**构建参数不能靠配置文件里的静态字符串传。** wrangler 只能通过
`containers[].image_vars` 传 build arg，而那是**配置文件里的字面量**——
等于又回到人手维护，只会产生一个永远过期的假 SHA。

所以改用**镜像内构建戳**：Dockerfile 里一层 `RUN date`，**排在 `COPY ./src` 之后**。
这样：源码变 → 该层缓存失效 → 戳必重跑；源码新而镜像没重建 → 戳不变。
它不靠任何人记得更新，信号由构建过程本身产生。

## 两档断言

1. **字段缺失档**（零配置）：响应里没有构建戳字段 = 旧镜像。
2. **戳值档**（需维护期望值）：戳早于某次源码变更 = 镜像没跟上。
   期望值取「最近一次镜像构建的 SHA/时间」，**不是 repo HEAD**——理由见
   [[lesson-always-firing-gate-is-ignored]]。
