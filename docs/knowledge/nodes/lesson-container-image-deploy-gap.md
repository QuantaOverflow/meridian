---
{
  "id": "lesson-container-image-deploy-gap",
  "type": "lesson",
  "title": "CF Container 部署的壳与镜像是两个产物：deployments list 只反映壳，判镜像要看 containers info 的 version 与 LAST MODIFIED",
  "date": "2026-09-20",
  "status": "recorded",
  "tasks": ["运维容器部署"],
  "scope": "meridian-ml-service（Python/FastAPI on CF Container）的一次真实部署故障复盘；仅本仓一例，未验证是否是 CF Container 平台的普遍行为",
  "source": "docs/adr/0003-cluster-as-brief-block.md「执行状态」一节；2026-09-20 本地重建 ml-service 镜像复跑聚类金标时发现",
  "conditions": [
    "部署命令从 services/meridian-ml-service 子目录执行（符合 CLAUDE.md「永不从 root 部署」的约束），排除了「部署路径错」这个可能性",
    "故障只在 docker.io 网络不通的环境触发；网络通畅的机器上同一份 Dockerfile 能正常 build，本条经验不代表 Dockerfile 本身有语法错误",
    "发现窗口长达三个多月（2026-06-25 镜像构建到 2026-09-20 才发现未生效），中间没有任何一次部署检查过镜像版本"
  ],
  "evidence_origin": "local_record",
  "relations": [],
  "kind": "failure_mechanism",
  "invalidates_when": "Dockerfile 改用不依赖拉取 docker.io 的 syntax 声明方式（例如固定本地已缓存的 buildkit 前端，或部署流程里加一道镜像版本核对步骤后仍观察到同类故障——若那时依旧只看 deployments list 就判断“已生效”，本条经验才算被推翻）"
}
---

## 故障

2026-09-05／06 的 ADR 0003 决定把聚类算法从 UMAP+HDBSCAN 换成阈值型凝聚。之后每次
`wrangler deploy` 都显示部署成功，`wrangler deployments list` 也能看到新的部署记录，看起来
像是已经生效。但直到 2026-09-20（三个多月后）用本地重建的镜像复跑两窗金标，才发现生产
从未真正跑过新算法——ml-service 的 container 镜像**停在 2026-06-25**，比 ADR 决定的日期更早。

## 根因

**CF Container 部署有两个独立产物：Worker 壳（Durable Object 转发层，约 30 行代码）与
container 镜像（真正跑业务代码的地方）。** `wrangler deploy` 默认会更新壳，但镜像只有
`docker build` 走通才会更新。

这次具体的失败点：`services/meridian-ml-service/Dockerfile` 第一行

```
# syntax=docker/dockerfile:1
```

这行语法声明需要联网拉取 `docker.io` 上的 buildkit 前端镜像。当时的构建环境网络不通，
`docker build` 就卡死在**读到聚类代码之前**——不是代码有 bug，是构建这一步从没跑到过
业务逻辑那一行。而 `wrangler deploy` 的壳更新不依赖这一步，照样"成功"，于是给出了
一切正常的假象。

## 怎么发现、怎么判断

`wrangler deployments list` 只反映 Worker 壳的部署历史，看不出镜像有没有真的换过。
要判断镜像是否生效，须看：

```
wrangler containers info <container-name>
```

对比其 `version` 与 `LAST MODIFIED` 时间戳——如果这个时间比预期的算法变更日期更早，
说明镜像还是旧的，不管壳部署了多少次都没用。

## 教训

- **「部署成功」这个信号本身不能证明代码生效**——它可能只证明了壳生效。凡是 CF Container
  架构（壳 + 镜像分离），验收「新代码是否在生产跑」都要单独查镜像版本，不能只看部署日志。
- 三个月的发现窗口说明：光靠人记得去核对是靠不住的，理想情况下部署脚本应该把镜像版本
  校验做成一步机械检查（如构建后打印镜像 digest 并与预期比对），而不是留给人在某次
  排查时偶然撞见。
- Dockerfile 里任何隐式拉取外部资源的步骤（`# syntax=`、`FROM` 基础镜像、`apt-get`/`pip`
  远程源）在网络受限环境都是构建期的单点故障，且失败位置可能早于业务代码，容易被误判为
  "构建通过、部署正常"。
