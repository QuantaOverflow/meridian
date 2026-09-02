"""
【扔掉型原型】把一个大簇的切分交给 HDBSCAN 自己的层级（leaf），跟现行的
「complete-linkage 文章两两 cos ≥0.90」比，切成几块？

背景：HDBSCAN 内部本来就建了一棵密度树，最后只挑一层输出。生产用的是
cluster_selection_method='eom'（挑最稳定那层），官方文档确认 EOM 会丢弃
「本来存在但不够稳定」的子结构；'leaf' 直接取叶子。参数早就在
services/meridian-ml-service/src/clustering.py:101，只是从没换过值。

⚠️ 这个探针只回答「切成几块」，**不回答「切得对不对」**——没有金标。
读数只能当量级参考：leaf 若给出 2 块 vs 现行 11 块，说明值得继续；
若给出 30 块，这条路当场否掉。

跑法（用 ml-service 自己的 venv，hdbscan/umap 都在里面）：
  cd apps/backend/prototypes/leaf-split
  ../../../../services/meridian-ml-service/.venv/bin/python probe.py [workflow_id]
"""
import json, os, subprocess, sys
import numpy as np
import hdbscan, umap

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), '../../../..'))
DB = next(l for l in open(f'{ROOT}/apps/frontend/.env') if l.startswith('NUXT_DATABASE_URL=')
          ).split('=', 1)[1].strip().strip('"')
WF = sys.argv[1] if len(sys.argv) > 1 else 'cron-brief-1787749254358'

# 生产参数：apps/backend/src/lib/core/constants.ts 的 BRIEF_CLUSTERING_OPTIONS
UMAP = dict(n_components=5, n_neighbors=15, min_dist=0.1, metric='cosine', random_state=42)
HDB = dict(min_cluster_size=3, min_samples=1, metric='euclidean', cluster_selection_epsilon=0.35)


def psql(sql):
    for k in range(4):
        try:
            out = subprocess.run(['psql', DB, '-At', '-F', '\t', '-c', sql],
                                 capture_output=True, text=True, check=True, timeout=180).stdout
            return [l.split('\t') for l in out.strip().split('\n') if l]
        except Exception:
            if k == 3: raise
            subprocess.run(['sleep', '2'])


def complete_linkage(unit, thr):
    """照搬 candidate-grouping.ts：贪心凝聚，每次并「组间最小相似度」最大的一对。"""
    n = len(unit)
    sim = unit @ unit.T
    groups = [[i] for i in range(n)]
    while True:
        best, best_sim = None, -1e9
        for a in range(len(groups)):
            for b in range(a + 1, len(groups)):
                mn = min(sim[x][y] for x in groups[a] for y in groups[b])
                if mn >= thr and mn > best_sim:
                    best_sim, best = mn, (a, b)
        if best is None: break
        a, b = best
        groups[a] = groups[a] + groups[b]
        groups.pop(b)
    return groups


def run_hdbscan(vecs, method):
    """对一个簇的文章单独重跑一遍 UMAP+HDBSCAN。参数与生产一致，只换 selection method。
    n_neighbors/n_components 需按样本量夹取，否则小簇会报错——同 clustering.py 的 safe_* 逻辑。"""
    n = len(vecs)
    if n <= 5: return np.zeros(n, dtype=int)
    u = umap.UMAP(**{**UMAP,
                     'n_neighbors': min(UMAP['n_neighbors'], n - 1),
                     'n_components': min(UMAP['n_components'], n - 2)}).fit_transform(vecs)
    return hdbscan.HDBSCAN(**HDB, cluster_selection_method=method).fit_predict(u)


rows = psql(f"""SELECT cluster_id, count(*), jsonb_agg(article_ids)
  FROM brief_stories WHERE workflow_id='{WF}' AND article_ids IS NOT NULL
  GROUP BY 1 HAVING count(*)>=5 ORDER BY 2 DESC LIMIT 8""")

print(f'{WF}\n')
print('簇   文章  现行故事数  几何(全链0.90)  HDBSCAN-eom  HDBSCAN-leaf   leaf噪声  最大块')
for cid, n_stories, agg in rows:
    ids = sorted({a for arr in json.loads(agg) for a in arr})
    er = psql(f"SELECT id, embedding::text FROM articles WHERE id IN ({','.join(map(str, ids))}) AND embedding IS NOT NULL")
    if len(er) < len(ids) * 0.8:
        print(f'{cid} 缺向量，跳过'); continue
    vecs = np.array([json.loads(r[1]) for r in er], dtype=np.float64)
    unit = vecs / np.linalg.norm(vecs, axis=1, keepdims=True)

    cl = complete_linkage(unit, 0.90)
    cl_multi = [g for g in cl if len(g) >= 2]

    out = {}
    for m in ('eom', 'leaf'):
        lab = run_hdbscan(vecs, m)
        out[m] = lab
    leaf = out['leaf']
    n_leaf = len({x for x in leaf if x >= 0})
    n_eom = len({x for x in out['eom'] if x >= 0})
    noise = int((leaf < 0).sum())
    biggest = max([int((leaf == k).sum()) for k in set(leaf) if k >= 0], default=0)
    print(f'{str(cid):<4} {len(ids):>4} {n_stories:>11} {len(cl_multi):>15} '
          f'{n_eom:>12} {n_leaf:>13} {noise:>10} {biggest:>7}')
