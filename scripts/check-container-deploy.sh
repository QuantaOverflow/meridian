#!/usr/bin/env bash
#
# 检查「线上容器镜像是不是比 git 里 ml-service 的最后改动还新」。
#
# 为什么需要这个脚本：
#   services/meridian-ml-service 是 CF Container 架构，一次部署实际是两件事——
#     1. cf-worker/src/index.ts（30 行 Durable Object 壳，只转发 container.fetch）
#     2. cf-worker/wrangler.jsonc 里 "image": "../Dockerfile" 构建出的容器镜像（算法全在这）
#   `wrangler deployments list` 只反映壳。壳部署成功而镜像没 build 时，
#   「部署成功」和「算法没上线」可以同时为真。2026-06 → 2026-09 的聚类算法
#   就这样三个半月没生效（commit 12a0f06 进了 git，镜像还停在 2026-06-25）。
#
# 只读：不改任何本地文件，不改任何线上状态。
#
# 退出码：
#   0  镜像不比代码旧 —— 部署已生效
#   1  镜像比代码旧 —— 部署没生效（壳可能已更新，镜像没 build/push）
#   2  环境或工具错误（找不到 wrangler、拿不到时间、解析失败）
#
# 用法：
#   scripts/check-container-deploy.sh
#   scripts/check-container-deploy.sh --ref=HEAD
#   scripts/check-container-deploy.sh --code-time=2026-01-01T00:00:00Z   # 测试注入
#   scripts/check-container-deploy.sh --image-time=2026-12-01T00:00:00Z  # 测试注入
#
# 环境变量：
#   WRANGLER_BIN   指定 wrangler 可执行文件（默认自动探测 4.x）

# pipefail：坑① 管道的退出码默认是最后一个命令的，`wrangler ... | grep ...`
# 会把 wrangler 的失败吞掉。这里全程开 pipefail，且下面所有 wrangler 输出
# 都先落临时文件再解析（坑② wrangler 接管道时是全缓冲，边读边解析不可靠）。
set -euo pipefail

# ml-service 的容器在 CF 上的名字（wrangler containers list 的 NAME 列）
CONTAINER_NAME_DEFAULT="meridian-ml-service"
# git 里 ml-service 的路径
ML_SERVICE_PATH="services/meridian-ml-service"
# 默认拿哪个 ref 的代码时间：meridian-dev 是本仓库主干（没有 main）。
# 线上跑的应该是主干代码，所以默认对主干比，不是对当前 HEAD
# （在 worktree / feature 分支上跑时，HEAD 可能落后于主干，比出来的结论没意义）。
CODE_REF_DEFAULT="meridian-dev"

CODE_TIME_OVERRIDE=""
IMAGE_TIME_OVERRIDE=""
CODE_REF="$CODE_REF_DEFAULT"
CONTAINER_NAME="$CONTAINER_NAME_DEFAULT"

for arg in "$@"; do
  case "$arg" in
    --code-time=*)  CODE_TIME_OVERRIDE="${arg#*=}" ;;
    --image-time=*) IMAGE_TIME_OVERRIDE="${arg#*=}" ;;
    --ref=*)        CODE_REF="${arg#*=}" ;;
    --container=*)  CONTAINER_NAME="${arg#*=}" ;;
    -h|--help)
      # 打印开头的注释块：从第 2 行起，遇到第一个非注释行就停
      awk 'NR==1{next} /^#/{sub(/^# ?/,""); print; next} {exit}' "$0"
      exit 0
      ;;
    *)
      # 注意：变量后面紧跟中文字符时必须写 ${VAR}——
      # macOS 自带的 bash 3.2 不认多字节，会把中文的字节当成变量名的一部分
      echo "未知参数：${arg}（用 --help 看用法）" >&2
      exit 2
      ;;
  esac
done

die() { echo "错误：$*" >&2; exit 2; }

# ISO-8601 → epoch 秒。
# 要能吃下两种格式：git 的 2026-09-05T23:40:56+08:00 和
# wrangler 的 2026-06-25T05:21:00.222000128Z（9 位纳秒，date 解析不了，必须先砍掉）。
iso_to_epoch() {
  local raw="$1" datepart offset normalized
  # 先按结尾形状拆出时区。日期本身带 '-'，所以只能看结尾，不能全局找符号。
  case "$raw" in
    *Z|*z)
      offset="+0000"; datepart="${raw%?}" ;;
    *[+-][0-9][0-9]:[0-9][0-9])          # +08:00
      offset="${raw: -6}"; offset="${offset/:/}"; datepart="${raw%??????}" ;;
    *[+-][0-9][0-9][0-9][0-9])           # +0800
      offset="${raw: -5}"; datepart="${raw%?????}" ;;
    *)
      offset="+0000"; datepart="$raw" ;;
  esac
  datepart="${datepart%%.*}"   # 砍掉小数秒（wrangler 给 9 位纳秒，date 解析不了）
  normalized="${datepart}${offset}"
  # BSD/macOS date 先试，GNU date 兜底
  date -j -f "%Y-%m-%dT%H:%M:%S%z" "$normalized" +%s 2>/dev/null \
    || date -d "$raw" +%s 2>/dev/null \
    || return 1
}

fmt_epoch() { date -r "$1" -u "+%Y-%m-%dT%H:%M:%SZ" 2>/dev/null || date -u -d "@$1" "+%Y-%m-%dT%H:%M:%SZ"; }

# ---------- 定位仓库与 wrangler ----------

REPO_ROOT="$(git rev-parse --show-toplevel)" || die "不在 git 仓库里"

find_wrangler() {
  if [ -n "${WRANGLER_BIN:-}" ]; then echo "$WRANGLER_BIN"; return; fi
  # 仓库自带的 4.93（自带的 3.x 不支持 remote binding，别用全局那个）
  local candidate="$REPO_ROOT/apps/backend/node_modules/.bin/wrangler"
  if [ -x "$candidate" ]; then echo "$candidate"; return; fi
  # 在 worktree 里跑时本地没装依赖，退回主 checkout（--git-common-dir 指向主仓库的 .git）
  local common_dir main_checkout
  common_dir="$(git rev-parse --git-common-dir)"
  case "$common_dir" in /*) ;; *) common_dir="$REPO_ROOT/$common_dir" ;; esac
  main_checkout="$(dirname "$common_dir")"
  candidate="$main_checkout/apps/backend/node_modules/.bin/wrangler"
  if [ -x "$candidate" ]; then echo "$candidate"; return; fi
  command -v wrangler 2>/dev/null || true
}

# ---------- 代码时间 ----------

if [ -n "$CODE_TIME_OVERRIDE" ]; then
  CODE_TIME="$CODE_TIME_OVERRIDE"
  CODE_SOURCE="--code-time 注入"
else
  if ! git rev-parse --verify --quiet "$CODE_REF" >/dev/null; then
    echo "提示：ref '$CODE_REF' 不存在，退回 HEAD" >&2
    CODE_REF="HEAD"
  fi
  CODE_TIME="$(git log -1 --format=%cI "$CODE_REF" -- "$ML_SERVICE_PATH")"
  [ -n "$CODE_TIME" ] || die "$CODE_REF 上没有 $ML_SERVICE_PATH 的提交记录"
  CODE_SOURCE="git log -1 $CODE_REF -- $ML_SERVICE_PATH"
fi

CODE_EPOCH="$(iso_to_epoch "$CODE_TIME")" || die "解析代码时间失败：$CODE_TIME"

# ---------- 镜像时间 ----------

if [ -n "$IMAGE_TIME_OVERRIDE" ]; then
  IMAGE_TIME="$IMAGE_TIME_OVERRIDE"
  IMAGE_SOURCE="--image-time 注入"
else
  WRANGLER="$(find_wrangler)"
  [ -n "$WRANGLER" ] && [ -x "$WRANGLER" ] \
    || die "找不到 wrangler（试过 apps/backend/node_modules/.bin/wrangler 和 PATH），可用 WRANGLER_BIN= 指定"

  # 坑②：wrangler 接管道是全缓冲，所以先整个落临时文件，再从文件解析
  TMP_OUT="$(mktemp -t container-deploy-check)"
  # EXIT trap 要自己把退出码传出去：bash 3.2 里 trap 内最后一条命令（rm）的
  # 状态会盖掉真正的退出码，之前就出现过脚本报错却 exit 0
  trap 'rc=$?; rm -f "$TMP_OUT"; exit $rc' EXIT
  # 这条链路会偶发 "fetch failed"（*.workers.dev / CF API 在国内被 RST），
  # 重试 3 次，免得网络抖一下就把结论变成「不确定」
  ATTEMPT=1
  until "$WRANGLER" containers list >"$TMP_OUT" 2>&1; do
    if [ "$ATTEMPT" -ge 3 ]; then
      echo "--- wrangler 输出（第 ${ATTEMPT} 次仍失败）---" >&2
      cat "$TMP_OUT" >&2
      die "wrangler containers list 失败（没登录？没网？需要代理？）"
    fi
    echo "wrangler containers list 第 ${ATTEMPT} 次失败，重试中…" >&2
    ATTEMPT=$(( ATTEMPT + 1 ))
    sleep 3
  done

  # 从名字匹配的那一行里直接抓 ISO 时间戳，比按 │ 切列稳
  ROW="$(grep -F "$CONTAINER_NAME" "$TMP_OUT" || true)"
  [ -n "$ROW" ] || { cat "$TMP_OUT" >&2; die "containers list 里没有名字含 '$CONTAINER_NAME' 的容器"; }
  IMAGE_TIME="$(printf '%s\n' "$ROW" | grep -Eo '[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}(\.[0-9]+)?Z' | head -1 || true)"
  [ -n "$IMAGE_TIME" ] || { printf '%s\n' "$ROW" >&2; die "没能从 containers list 里解析出 LAST MODIFIED"; }
  IMAGE_SOURCE="wrangler containers list（${CONTAINER_NAME}）"
fi

IMAGE_EPOCH="$(iso_to_epoch "$IMAGE_TIME")" || die "解析镜像时间失败：$IMAGE_TIME"

# ---------- 比对 ----------

DIFF=$(( IMAGE_EPOCH - CODE_EPOCH ))
ABS_DIFF=${DIFF#-}
DAYS=$(( ABS_DIFF / 86400 ))
HOURS=$(( (ABS_DIFF % 86400) / 3600 ))

echo "代码最后改动  $(fmt_epoch "$CODE_EPOCH")   ← $CODE_SOURCE"
echo "线上镜像构建  $(fmt_epoch "$IMAGE_EPOCH")   ← $IMAGE_SOURCE"

# ---------- Dockerfile syntax 指令提示（只提示，不改文件）----------

DOCKERFILE="$REPO_ROOT/$ML_SERVICE_PATH/Dockerfile"
if [ -f "$DOCKERFILE" ] && head -1 "$DOCKERFILE" | grep -q '^# *syntax='; then
  echo
  echo "提示：$ML_SERVICE_PATH/Dockerfile 第一行是 $(head -1 "$DOCKERFILE")"
  echo "      这行会让 BuildKit 先去 docker.io 拉前端镜像，网络不通时 build 会在读代码之前就死掉。"
  echo "      绕法：DOCKER_BUILDKIT=0 docker build ...（不要改 Dockerfile）"
fi

echo

if [ "$DIFF" -lt 0 ]; then
  echo "✗ 镜像比代码旧 ${DAYS} 天 ${HOURS} 小时 —— 部署没生效。"
  echo "  壳（Worker）可能已经更新了，但容器镜像没 build/push，线上跑的还是老算法。"
  echo "  核对：wrangler containers info <id> 看 version / image tag 有没有涨。"
  exit 1
fi

echo "✓ 镜像比代码新 ${DAYS} 天 ${HOURS} 小时 —— 部署已生效。"
exit 0
