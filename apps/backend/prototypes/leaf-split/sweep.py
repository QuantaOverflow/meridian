"""
【扔掉型原型】全量扫：现行「全链 cos≥0.90」 vs 「HDBSCAN eom/leaf」，7 期所有簇。

只回答量级问题（切成几块、丢几篇、最大块多大），**不判对错**——没有金标。
产出的 diff.json 是给人判的差分清单。

跑法：
  cd apps/backend/prototypes/leaf-split
  ../../../../services/meridian-ml-service/.venv/bin/python sweep.py
"""
import json, os, subprocess, sys, warnings
import numpy as np
warnings.filterwarnings('ignore')
import hdbscan, umap

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), '../../../..'))
DB = next(l for l in open(f'{ROOT}/apps/frontend/.env') if l.startswith('NUXT_DATABASE_URL=')
          ).split('=', 1)[1].strip().strip('"')
UMAP = dict(min_dist=0.1, metric='cosine', random_state=42)
HDB = dict(min_samples=1, metric='euclidean', cluster_selection_epsilon=0.35)
MCS = 3


def psql(sql):
    for k in range(4):
        try:
            out = subprocess.run(['psql', DB, '-At', '-F', '\t', '-c', sql],
                                 capture_output=True, text=True, check=True, timeout=300).stdout
            return [l.split('\t') for l in out.strip().split('\n') if l]
        except Exception:
            if k == 3: raise
            subprocess.run(['sleep', '3'])


def complete_linkage(unit, thr=0.90):
    """照搬 candidate-grouping.ts。只返回 ≥2 篇的组（生产同门槛），落单的另计。
    注意是 O(n^3) 的朴素实现（生产同款），n>80 会很慢——本探针里没有那么大的簇，
    真撞上了会在下面显式打印，不静默跳过。"""
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
        groups[a] += groups[b]
        groups.pop(b)
    return [g for g in groups if len(g) >= 2], [g[0] for g in groups if len(g) == 1]


def run_hdbscan(vecs, method):
    n = len(vecs)
    if n <= 5: return np.zeros(n, dtype=int)
    u = umap.UMAP(**UMAP, n_neighbors=min(15, n - 1), n_components=min(5, n - 2)).fit_transform(vecs)
    return hdbscan.HDBSCAN(**HDB, min_cluster_size=MCS, cluster_selection_method=method).fit_predict(u)


def parts(labels):
    """labels → [[idx,...], ...]，噪声单列"""
    g = {}
    noise = []
    for i, k in enumerate(labels):
        if k < 0: noise.append(i)
        else: g.setdefault(int(k), []).append(i)
    return list(g.values()), noise


wfs = [r[0] for r in psql("""SELECT workflow_id FROM brief_stories
  GROUP BY 1 HAVING count(centroid)>0 ORDER BY 1 DESC LIMIT 7""")]
print(f'扫 {len(wfs)} 期\n')

tot = {'clusters': 0, 'articles': 0, 'cl_groups': 0, 'cl_single': 0,
       'eom': 0, 'eom_noise': 0, 'leaf': 0, 'leaf_noise': 0,
       'cl_max': 0, 'leaf_max': 0, 'diff': 0}
diffs = []

for wf in wfs:
    rows = psql(f"""SELECT cluster_id, count(*), jsonb_agg(article_ids)
      FROM brief_stories WHERE workflow_id='{wf}' AND article_ids IS NOT NULL
        AND cluster_id <> -1 GROUP BY 1 ORDER BY 2 DESC""")
    per = {'c': 0, 'a': 0, 'cl': 0, 'sg': 0, 'eom': 0, 'leaf': 0, 'ln': 0}
    # 一次把本期全部文章的向量取回来：每簇一次 psql 的话网络往返就是瓶颈（实测跑不完）
    all_ids = sorted({a for _, _, agg in rows for arr in json.loads(agg) for a in arr})
    cache = {}
    for i in range(0, len(all_ids), 400):
        chunk = all_ids[i:i+400]
        for r in psql(f"SELECT id, title, embedding::text FROM articles WHERE id IN ({','.join(map(str,chunk))}) AND embedding IS NOT NULL"):
            cache[int(r[0])] = (r[1], r[2])
    for cid, nst, agg in rows:
        ids = sorted({a for arr in json.loads(agg) for a in arr})
        if len(ids) < 4: continue
        got = [(i, *cache[i]) for i in ids if i in cache]
        if len(got) < len(ids) * 0.8: continue
        aid = [g[0] for g in got]
        titles = [g[1] for g in got]
        vecs = np.array([json.loads(g[2]) for g in got], dtype=np.float64)
        unit = vecs / np.linalg.norm(vecs, axis=1, keepdims=True)

        cl, cl_single = complete_linkage(unit)
        eom_g, eom_n = parts(run_hdbscan(vecs, 'eom'))
        leaf_g, leaf_n = parts(run_hdbscan(vecs, 'leaf'))

        per['c'] += 1; per['a'] += len(aid)
        per['cl'] += len(cl); per['sg'] += len(cl_single)
        per['eom'] += len(eom_g); per['leaf'] += len(leaf_g); per['ln'] += len(leaf_n)
        tot['cl_max'] = max(tot['cl_max'], max((len(g) for g in cl), default=0))
        tot['leaf_max'] = max(tot['leaf_max'], max((len(g) for g in leaf_g), default=0))
        tot['eom_noise'] += len(eom_n)

        # 差分：块数不同就记下来给人判
        if len(cl) != len(leaf_g):
            tot['diff'] += 1
            diffs.append({
                'wf': wf, 'cluster_id': int(cid), 'articles': len(aid),
                'stories_now': int(nst), 'cl_groups': len(cl), 'cl_singletons': len(cl_single),
                'leaf_blocks': len(leaf_g), 'leaf_noise': len(leaf_n),
                'complete_linkage': [[titles[i] for i in g] for g in cl],
                'leaf': [[titles[i] for i in g] for g in leaf_g],
                'leaf_dropped': [titles[i] for i in leaf_n],
            })
    for k, v in (('clusters','c'),('articles','a'),('cl_groups','cl'),('cl_single','sg'),
                 ('eom','eom'),('leaf','leaf'),('leaf_noise','ln')):
        tot[k] += per[v]
    print(f'{wf}  簇{per["c"]:>3} 文章{per["a"]:>5} | 全链{per["cl"]:>4}组+{per["sg"]:>3}落单 | '
          f'eom{per["eom"]:>4} | leaf{per["leaf"]:>4}块+{per["ln"]:>3}噪声')

print(f'\n合计：{tot["clusters"]} 簇 / {tot["articles"]} 篇')
print(f'  全链0.90   {tot["cl_groups"]:>4} 组 + {tot["cl_single"]:>3} 篇落单   最大组 {tot["cl_max"]} 篇')
print(f'  HDBSCAN-eom  {tot["eom"]:>4} 块 + {tot["eom_noise"]:>3} 篇噪声')
print(f'  HDBSCAN-leaf {tot["leaf"]:>4} 块 + {tot["leaf_noise"]:>3} 篇噪声   最大块 {tot["leaf_max"]} 篇')
print(f'\n块数不同的簇：{tot["diff"]} 个 → diff.json（给人判的差分清单）')
json.dump(diffs, open('diff.json', 'w'), ensure_ascii=False, indent=1)
