#!/bin/bash
# 上游聚类对照实验的 fixture 构建：逐字复现 auto-brief-generation.ts「准备文章数据集」step 的 SQL。
# 两个窗口：F1 = 09-03 那次 workflow 的真实窗口（生产 total_articles=1029）；F2 = 紧邻的下一个 48h，做 holdout。
# 生产在 SQL 之后还有一道 R2 正文质量过滤（EMPTY_CONTENT / INSUFFICIENT_LENGTH），
# 本 fixture 不含该过滤，所以是生产输入的**超集**（F1 预期 1031 vs 生产 1029，差 2 篇）。
set -euo pipefail
: "${PGURL_BRANCH:?缺 PGURL_BRANCH}"
q() { for i in 1 2 3 4; do psql "$PGURL_BRANCH" -At -F $'\t' -c "$1" 2>/dev/null && return 0; sleep 4; done; return 1; }

for spec in "F1|2026-08-28T00:00:00Z|2026-08-30T02:00:00Z" "F2|2026-08-30T02:00:00Z|2026-09-01T02:00:00Z"; do
  name="${spec%%|*}"; rest="${spec#*|}"; from="${rest%%|*}"; to="${rest##*|}"
  # 逐行 JSONL：COPY 的文本转义会打坏 JSON，标题里的制表/换行先清掉
  q "select row_to_json(t) from (
      select a.id,
             regexp_replace(a.title, '[\t\r\n]+', ' ', 'g') as title,
             a.publish_date, a.source_id, a.embedding::text as emb
      from articles a join sources s on s.id = a.source_id
      where a.embedding is not null
        and a.status = 'PROCESSED'
        and a.content_file_key is not null
        and s.category = 'news'
        and a.publish_date >= '${from}'::timestamptz
        and a.publish_date <= '${to}'::timestamptz
      order by a.publish_date desc
      limit 1500
    ) t" > "fixture-${name}.jsonl"
  echo "${name} [${from} → ${to}] $(python3 -c "
import json
rows=[json.loads(l) for l in open('fixture-${name}.jsonl') if l.strip()]
d=[len(json.loads(r['emb'])) for r in rows]
assert set(d)=={384}, f'维度异常 {set(d)}'
assert len({r['id'] for r in rows})==len(rows), 'id 有重复'
print(len(rows),'篇，384 维，id 无重复')")"
done

# 生产那次的聚类结果，仅作对照基线（不是金标）：只有进了 story 的文章有 cluster_id
q "copy (
  select json_agg(row_to_json(t)) from (
    select distinct (e.value)::int as id, b.cluster_id
    from brief_stories b, jsonb_array_elements(b.article_ids::jsonb) e
    where b.workflow_id = 'admin-brief-1788431559004'
  ) t
) to stdout" > fixture-F1-prod-clusters.json
echo "生产对照基线 $(python3 -c "import json;print(len(json.load(open('fixture-F1-prod-clusters.json'))),'篇有 cluster_id')")"
