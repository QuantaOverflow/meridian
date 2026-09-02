"""
【扔掉型原型】公平版：拿**候选分组之前**的原始簇成员喂两边。

上一版（sweep.py）喂的是 brief_stories.article_ids —— 那是全链已经筛过的幸存者，
等于让全链当自己的考官（读数：全链落单 8 篇 vs 生产实测 592 篇，对不上）。
本版从 R2 快照 observability/clustering/{wf}.json 取原始簇成员，两边同一输入。

⚠️ 仍然只回答量级问题（切几块、丢几篇、最大块多大），**不判对错**——没有金标。
diff.json 是给人判的差分清单。

跑法：
  cd apps/backend/prototypes/leaf-split
  ../../../../services/meridian-ml-service/.venv/bin/python sweep2.py
（快照先用 wrangler 拉到 .cache/，注意必须带 --remote，否则读的是本地模拟 R2）
"""
import glob, json, os, subprocess, warnings
import numpy as np
warnings.filterwarnings('ignore')
import hdbscan, umap

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), '../../../..'))
DB = next(l for l in open(f'{ROOT}/apps/frontend/.env') if l.startswith('NUXT_DATABASE_URL=')
          ).split('=', 1)[1].strip().strip('"')
UMAP = dict(min_dist=0.1, metric='cosine', random_state=42)
HDB = dict(min_samples=1, metric='euclidean', cluster_selection_epsilon=0.35)
MCS = 3
MAX_CL = 120  # complete_linkage 是 O(n^3) 朴素实现，超过就跳过并显式计数，不静默丢


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


def hdb(vecs, method):
    n = len(vecs)
    if n <= 5: return np.zeros(n, dtype=int)
    u = umap.UMAP(**UMAP, n_neighbors=min(15, n - 1), n_components=min(5, n - 2)).fit_transform(vecs)
    return hdbscan.HDBSCAN(**HDB, min_cluster_size=MCS, cluster_selection_method=method).fit_predict(u)


def parts(labels):
    g, noise = {}, []
    for i, k in enumerate(labels):
        (noise.append(i) if k < 0 else g.setdefault(int(k), []).append(i))
    return list(g.values()), noise


tot = dict(clusters=0, articles=0, cl_g=0, cl_s=0, eom_g=0, eom_n=0, leaf_g=0, leaf_n=0,
           cl_max=0, leaf_max=0, skipped=0, diff=0)
diffs = []
print('期                              簇  文章 | 全链   组  落单 |  eom  块 噪声 | leaf  块 噪声')

for f in sorted(glob.glob('.cache/clustering_*.json'), reverse=True):
    snap = json.load(open(f))
    wf = snap['workflowId']
    clusters = [c for c in snap['clusters'] if c['clusterId'] != -1 and len(c['articleIds']) >= 4]
    all_ids = sorted({a for c in clusters for a in c['articleIds']})
    cache = {}
    for i in range(0, len(all_ids), 400):
        ch = all_ids[i:i + 400]
        for r in psql(f"SELECT id, title, embedding::text FROM articles WHERE id IN ({','.join(map(str,ch))}) AND embedding IS NOT NULL"):
            cache[int(r[0])] = (r[1], r[2])

    per = dict(c=0, a=0, cl_g=0, cl_s=0, eom_g=0, eom_n=0, leaf_g=0, leaf_n=0)
    for c in clusters:
        got = [(i, *cache[i]) for i in c['articleIds'] if i in cache]
        if len(got) < 4: continue
        if len(got) > MAX_CL:
            tot['skipped'] += 1
            print(f'  ⚠️ {wf} 簇{c["clusterId"]} {len(got)} 篇 > {MAX_CL}，跳过（全链 O(n^3)）')
            continue
        titles = [g[1] for g in got]
        vecs = np.array([json.loads(g[2]) for g in got], dtype=np.float64)
        unit = vecs / np.linalg.norm(vecs, axis=1, keepdims=True)

        cl, cl_s = complete_linkage(unit)
        eg, en = parts(hdb(vecs, 'eom'))
        lg, ln = parts(hdb(vecs, 'leaf'))

        per['c'] += 1; per['a'] += len(got)
        per['cl_g'] += len(cl); per['cl_s'] += len(cl_s)
        per['eom_g'] += len(eg); per['eom_n'] += len(en)
        per['leaf_g'] += len(lg); per['leaf_n'] += len(ln)
        tot['cl_max'] = max(tot['cl_max'], max((len(g) for g in cl), default=0))
        tot['leaf_max'] = max(tot['leaf_max'], max((len(g) for g in lg), default=0))
        if len(cl) != len(lg):
            tot['diff'] += 1
            diffs.append(dict(wf=wf, cluster_id=c['clusterId'], articles=len(got),
                              cl_groups=len(cl), cl_singletons=len(cl_s),
                              leaf_blocks=len(lg), leaf_noise=len(ln),
                              complete_linkage=[[titles[i] for i in g] for g in cl],
                              cl_dropped=[titles[i] for i in cl_s],
                              leaf=[[titles[i] for i in g] for g in lg],
                              leaf_dropped=[titles[i] for i in ln]))
    for k in ('cl_g','cl_s','eom_g','eom_n','leaf_g','leaf_n'): tot[k] += per[k]
    tot['clusters'] += per['c']; tot['articles'] += per['a']
    print(f'{wf:<30} {per["c"]:>3} {per["a"]:>5} | {per["cl_g"]:>10} {per["cl_s"]:>5} | '
          f'{per["eom_g"]:>9} {per["eom_n"]:>4} | {per["leaf_g"]:>9} {per["leaf_n"]:>4}')

a = tot['articles']
print(f'\n合计：{tot["clusters"]} 簇 / {a} 篇（跳过超大簇 {tot["skipped"]} 个）')
for name, g, n, mx in (('全链0.90 ', tot['cl_g'], tot['cl_s'], tot['cl_max']),
                       ('HDBSCAN-eom ', tot['eom_g'], tot['eom_n'], None),
                       ('HDBSCAN-leaf', tot['leaf_g'], tot['leaf_n'], tot['leaf_max'])):
    mxs = f'  最大 {mx} 篇' if mx else ''
    print(f'  {name} {g:>4} 组/块 + {n:>4} 篇进不了任何组（{100*n/a:.1f}%）{mxs}')
print(f'\n块数不同的簇：{tot["diff"]} 个 → diff.json')
json.dump(diffs, open('diff.json', 'w'), ensure_ascii=False, indent=1)
