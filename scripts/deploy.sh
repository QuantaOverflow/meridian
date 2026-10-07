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
# 部署生产的 backend 或 ai-worker（参数里没有 --env / -e）时：
#   - 自动补 --env=（空串 = 显式指定顶层环境），消掉 wrangler 的 "Multiple environments are defined" warning；
#     dry-run 实测与不带参数的 binding 列表一致。已带 --env staging / --env=staging 的原样透传，不补；--env "" / --env= 仍按部署生产处理
#   - 非 --print 时查仓库根 .staging-verdicts.jsonl（环境变量 STAGING_VERDICTS_FILE 可改路径）：取 backend 与 ai-worker 的 commit
#     都等于当前短哈希（按前缀比）、dirty 都为 false 的最后一行，它的 verdict 不是 green / yellow（或没有这样的行），
#     或当前工作区 dirty，就往 stderr 打警告（提示 node scripts/staging-run.mjs），然后照常部署，退出码仍是 wrangler 的
#   ml-service 不查、不补 --env=。
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

# ---------- backend / ai-worker：环境参数与「部署生产」的判定 ----------
# 这两个 service 的配置里有 env.staging 段（ADR 0013）。参数里没有 --env 就是部署生产（顶层）。

REL_DIR="${SERVICE_DIR#"$REPO_ROOT"/}"
DEPLOYS_PRODUCTION=0
case "$REL_DIR" in
  apps/backend|services/meridian-ai-worker)
    # 只有给了非空的环境名才算「指定了环境」：--env "" / --env= 是 wrangler 里显式指定顶层的写法，仍是部署生产
    ENV_GIVEN=0
    PREV=""
    for a in "$@"; do
      case "$PREV" in --env|-e) [ -n "$a" ] && ENV_GIVEN=1 ;; esac
      case "$a" in --env=?*|-e=?*) ENV_GIVEN=1 ;; esac
      PREV="$a"
    done
    HAS_ENV_ARG=0
    for a in "$@"; do
      case "$a" in --env|--env=*|-e|-e=*) HAS_ENV_ARG=1 ;; esac
    done
    if [ "$ENV_GIVEN" = 0 ]; then
      DEPLOYS_PRODUCTION=1
      # 空字符串 = 显式指定顶层环境（wrangler 4.141 dry-run 实测：binding 列表与不带参数时完全一致，且没有多环境 warning）。
      # 调用方自己已经写了空的 --env 就不再补
      [ "$HAS_ENV_ARG" = 1 ] || ARGS+=(--env=)
    fi
    ;;
esac

ARGS+=("$@")

if [ "$PRINT_ONLY" = 1 ]; then
  printf '%s\n' "$WRANGLER" "${ARGS[@]}"
  if [ "$GENERATED" = 1 ]; then
    echo "# ${DEPLOY_CONFIG}:"
    grep '"image_vars"' "$DEPLOY_CONFIG"
  fi
  exit 0
fi

# 部署生产的 backend / ai-worker：当前提交没有通过的 Staging 运行就提醒，不拦。
# 判定记录由 scripts/staging-run.mjs 写入；文件不存在按「没有」。
if [ "$DEPLOYS_PRODUCTION" = 1 ]; then
  VERDICTS_FILE="${STAGING_VERDICTS_FILE:-$REPO_ROOT/.staging-verdicts.jsonl}"
  if ! COMMIT="$COMMIT" DIRTY="$DIRTY" VERDICTS_FILE="$VERDICTS_FILE" node -e '
    const fs = require("node:fs");
    if (process.env.DIRTY === "true") process.exit(1);
    let text = "";
    try { text = fs.readFileSync(process.env.VERDICTS_FILE, "utf8"); } catch { process.exit(1); }
    const head = process.env.COMMIT;
    const ok = (s) => s && s.dirty === false && typeof s.commit === "string" && s.commit !== ""
      && (s.commit.startsWith(head) || head.startsWith(s.commit));
    // 这个提交的最近一次 Staging 运行说了算：先绿后红的提交照样提醒
    let last = null;
    for (const l of text.split("\n")) {
      let r; try { r = JSON.parse(l); } catch { continue; }
      if (ok(r?.services?.backend) && ok(r?.services?.["ai-worker"])) last = r;
    }
    process.exit(last && (last.verdict === "green" || last.verdict === "yellow") ? 0 : 1);
  '; then
    {
      echo "警告：当前提交 ${COMMIT}$([ "$DIRTY" = true ] && echo "（工作区 dirty）") 没有通过的 Staging 运行记录（backend 与 ai-worker 都要是这个提交、不 dirty、判定绿或黄）。"
      echo "      先在仓库根跑：node scripts/staging-run.mjs"
      echo "      部署照常进行（紧急回滚不被挡）。"
    } >&2
  fi
fi

echo "部署 ${REL_DIR}：${TAG} ${TITLE}" >&2
"$WRANGLER" "${ARGS[@]}"
