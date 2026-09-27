# pre-commit / pre-push 共用。被 source，不单独执行。

# 列出路径里碰到的代码文件（apps/services/packages 下的源码与配置）
code_files() {
  grep -E '^(apps|services|packages)/.*\.(ts|tsx|vue|mjs|js|py|json|jsonc|toml)$' || true
}

# $code 里有没有以 $1 开头的路径
touched() { printf '%s\n' "$code" | grep -q "^$1"; }

# 通过只打一行，失败才给报错行（测试日志动辄几十 KB，会吃掉 agent 的上下文）
check() {
  label=$1; shift
  log=$(mktemp)
  if "$@" >"$log" 2>&1; then
    echo "✓ ${label}"
    # 调用方设了 KEEP_LOG 就留一份输出（eslint 通过时还要从里面挑警告）
    if [ -n "${KEEP_LOG:-}" ]; then mv "$log" "$KEEP_LOG"; else rm -f "$log"; fi
  else
    echo "✗ ${label}，报错行（全文 ${log}）："
    grep -E 'error|FAIL|✗|×|AssertionError|Expected|Received' "$log" | grep -vE '^[[:space:]]*(\{|stdout \||stderr \|)|DeprecationWarning' | head -30
    exit 1
  fi
}

# backend 的数据库测试要本机测试库；没设就用本机默认库（测试自己会拒绝非 localhost 地址）
: "${BACKEND_TEST_DATABASE_URL:=postgresql://$USER:x@localhost:5432/meridian_backend_test}"
export BACKEND_TEST_DATABASE_URL

