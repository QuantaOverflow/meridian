#!/usr/bin/env bash
#
# 部署一个 Worker，并把「部署的是哪个提交」带上去。包一层 `wrangler deploy`，其余不变。
#
# 在 service 目录里跑（和以前直接 `wrangler deploy` 的位置一样）：
#   cd services/meridian-ai-worker          && ../../scripts/deploy.sh
#   cd services/meridian-ml-service/cf-worker && ../../../scripts/deploy.sh
#   cd apps/backend                         && ../../scripts/deploy.sh
# 在仓库根跑会拒绝：根目录的 wrangler.toml 是前端 Pages 的配置，不是任何一个 Worker 的。
#
# 带上去的三样（取自 git 的 HEAD 与工作区）：
#   短哈希   git rev-parse --short HEAD
#   标题     git log -1 --format=%s
#   dirty    工作区有没有未提交的改动（git status --porcelain 非空，含未跟踪文件）
#
# 怎么带（依据 2026-10-05 的 Cloudflare 文档，wrangler 4.141）：
#   --var GIT_COMMIT:… --var GIT_TITLE:… --var GIT_DIRTY:true|false
#       部署时注入的变量，Worker 里读 env.GIT_*。文档：值总是字符串；wrangler 按第一个冒号拆 key 与 value，
#       标题里再有冒号不影响。标题只走这条路。
#   --tag <短哈希>[-dirty]
#       版本的 tag，`wrangler versions list` 与 dashboard 里能看到，version metadata binding 的 .tag 也是它。
#       文档没写 tag 的长度上限，这里只放短哈希。
#   不传 --message：文档没写它的长度上限，version metadata binding 也读不到它，标题放进去没有消费方。
#   部署时刻与版本 id 不用传：Worker 从 version metadata binding（wrangler 配置里的 version_metadata）读。
#   ml-service 的容器镜像：wrangler 没有部署时传 build arg 的参数，build arg 只能写在配置的 image_vars 里。
#       所以配置里有 image_vars 占位行时，这里生成一份临时配置 wrangler.deploy.jsonc（gitignored，跑完删），
#       把占位行换成真值，用 --config 指过去。
#
# 用法：
#   scripts/deploy.sh [--print] [传给 wrangler deploy 的其他参数…]
#   --print   只打印将要执行的命令（一行一个参数），不执行；有临时配置时再打印其中的 image_vars 行
#
# 退出码：--print 时 0；否则是 wrangler 的退出码；2 = 用法或环境错误（在仓库根、没有 wrangler 配置、找不到 wrangler）。
#
# 部署成没成功仍只看输出里的 Current Version ID 有没有变（见根 README 的 Deployment）。

set -euo pipefail

die() { echo "错误：$*" >&2; exit 2; }

PRINT_ONLY=0
if [ "${1:-}" = "--print" ]; then PRINT_ONLY=1; shift; fi

REPO_ROOT="$(git rev-parse --show-toplevel 2>/dev/null)" || die "不在 git 仓库里"
SERVICE_DIR="$(pwd -P)"

[ "$SERVICE_DIR" != "$(cd "$REPO_ROOT" && pwd -P)" ] \
  || die "不能在仓库根部署。进 service 目录再跑（apps/backend、services/meridian-ai-worker、services/meridian-ml-service/cf-worker）"

CONFIG=""
for name in wrangler.jsonc wrangler.json wrangler.toml; do
  if [ -f "$name" ]; then CONFIG="$name"; break; fi
done
[ -n "$CONFIG" ] || die "当前目录没有 wrangler 配置（wrangler.jsonc / wrangler.json / wrangler.toml），不是 service 目录"

WRANGLER="${WRANGLER_BIN:-./node_modules/.bin/wrangler}"
[ -x "$WRANGLER" ] || die "找不到 ${WRANGLER}（先在仓库根 pnpm install，或用 WRANGLER_BIN= 指定）"

COMMIT="$(git rev-parse --short HEAD)"
TITLE="$(git log -1 --format=%s)"
if [ -n "$(git status --porcelain)" ]; then DIRTY=true; else DIRTY=false; fi

TAG="$COMMIT"
if [ "$DIRTY" = true ]; then TAG="${COMMIT}-dirty"; fi

ARGS=(deploy --tag "$TAG" --var "GIT_COMMIT:${COMMIT}" --var "GIT_TITLE:${TITLE}" --var "GIT_DIRTY:${DIRTY}")

# ---------- 容器镜像的 build arg：占位行 → 临时配置 ----------

DEPLOY_CONFIG="wrangler.deploy.jsonc"
GENERATED=0
if grep -q '"image_vars"' "$CONFIG"; then
  # EXIT trap 自己把退出码传出去：bash 3.2 里 trap 内最后一条命令的状态会盖掉真正的退出码
  trap 'rc=$?; rm -f "$DEPLOY_CONFIG"; exit $rc' EXIT
  # 值经 JSON.stringify 转义（标题里可以有引号、反斜杠）；占位行必须恰好出现一次，否则报错而不是悄悄不注入
  GIT_COMMIT="$COMMIT" GIT_TITLE="$TITLE" GIT_DIRTY="$DIRTY" node -e '
    const fs = require("node:fs");
    const [from, to] = process.argv.slice(1);
    const placeholder = /"image_vars":\s*\{\s*"GIT_COMMIT":\s*"not-injected",\s*"GIT_TITLE":\s*"not-injected",\s*"GIT_DIRTY":\s*"not-injected"\s*\}/g;
    const text = fs.readFileSync(from, "utf8");
    const hits = text.match(placeholder) ?? [];
    if (hits.length !== 1) {
      console.error(`${from}: image_vars 的占位行应恰好出现 1 次，实际 ${hits.length} 次`);
      process.exit(1);
    }
    const { GIT_COMMIT, GIT_TITLE, GIT_DIRTY } = process.env;
    // 用函数做替换：字符串形式的替换串里 $ 有特殊含义，标题里可能有
    fs.writeFileSync(to, text.replace(placeholder, () => `"image_vars": ${JSON.stringify({ GIT_COMMIT, GIT_TITLE, GIT_DIRTY })}`));
  ' "$CONFIG" "$DEPLOY_CONFIG" || die "生成 ${DEPLOY_CONFIG} 失败"
  GENERATED=1
  ARGS+=(--config "$DEPLOY_CONFIG")
fi

ARGS+=("$@")

if [ "$PRINT_ONLY" = 1 ]; then
  printf '%s\n' "$WRANGLER" "${ARGS[@]}"
  if [ "$GENERATED" = 1 ]; then
    echo "# ${DEPLOY_CONFIG}:"
    grep '"image_vars"' "$DEPLOY_CONFIG"
  fi
  exit 0
fi

echo "部署 ${SERVICE_DIR#"$REPO_ROOT"/}：${TAG} ${TITLE}" >&2
"$WRANGLER" "${ARGS[@]}"
