#!/bin/bash
# 从 R2 拉单篇正文到本地缓存（幂等：已有非空文件直接跳过）
cd /Users/shiwenjie/Desktop/playground/projects/meridian/apps/backend
f="prototypes/intel-latency/.cache/content/$1.txt"
[ -s "$f" ] && exit 0
./node_modules/.bin/wrangler r2 object get "meridian-articles-prod/$2" --remote --pipe > "$f" 2>/dev/null || : > "$f"
