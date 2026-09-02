"""扫 epsilon / min_cluster_size：验证「epsilon 压住了 eom 与 leaf 的差别」这个假设。"""
import json, os, subprocess
import numpy as np, hdbscan, umap

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), '../../../..'))
DB = next(l for l in open(f'{ROOT}/apps/frontend/.env') if l.startswith('NUXT_DATABASE_URL=')
          ).split('=', 1)[1].strip().strip('"')
WF, CID = 'cron-brief-1787749254358', '62'

def psql(sql):
    for k in range(4):
        try:
            out = subprocess.run(['psql', DB, '-At', '-F', '\t', '-c', sql],
                                 capture_output=True, text=True, check=True, timeout=180).stdout
            return [l.split('\t') for l in out.strip().split('\n') if l]
        except Exception:
            if k == 3: raise
            subprocess.run(['sleep', '2'])

agg = psql(f"SELECT jsonb_agg(article_ids) FROM brief_stories WHERE workflow_id='{WF}' AND cluster_id={CID}")[0][0]
ids = sorted({a for arr in json.loads(agg) for a in arr})
er = psql(f"SELECT id, embedding::text FROM articles WHERE id IN ({','.join(map(str,ids))}) AND embedding IS NOT NULL")
vecs = np.array([json.loads(r[1]) for r in er], dtype=np.float64)
n = len(vecs)
u = umap.UMAP(n_components=min(5, n-2), n_neighbors=min(15, n-1), min_dist=0.1,
              metric='cosine', random_state=42).fit_transform(vecs)

print(f'簇 {CID}（{n} 篇）· 现行故事数 16 · 全链0.90 切 11 组\n')
print('eps    mcs   eom块  eom噪声   leaf块  leaf噪声   eom最大  leaf最大')
for eps in (0.0, 0.1, 0.2, 0.35, 0.5):
    for mcs in (3, 5):
        r = {}
        for m in ('eom', 'leaf'):
            lab = hdbscan.HDBSCAN(min_cluster_size=mcs, min_samples=1, metric='euclidean',
                                  cluster_selection_epsilon=eps, cluster_selection_method=m).fit_predict(u)
            ks = [k for k in set(lab) if k >= 0]
            r[m] = (len(ks), int((lab < 0).sum()), max([int((lab == k).sum()) for k in ks], default=0))
        print(f'{eps:<6} {mcs:<5} {r["eom"][0]:>5} {r["eom"][1]:>8} {r["leaf"][0]:>8} '
              f'{r["leaf"][1]:>9} {r["eom"][2]:>9} {r["leaf"][2]:>9}')
