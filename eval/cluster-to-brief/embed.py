"""批量算 embedding —— 慢档的事件清单跨批归并用。

抄自 `apps/backend/prototypes/intel-pipeline/scratch/embed.py`。抄而不 import:原件在
prototypes 下,被根 .gitignore 整目录挡掉,入库的 harness 不能架在会丢的文件上。

两条与生产对齐的口径,**改任何一条都会让归并阈值失去意义**:
  · 不加 e5 的 query:/passage: 前缀 —— 生产 /embeddings 端点调 compute_embeddings 时
    也不传 e5_prefix(ml-service src/main.py),所以保持同一向量空间
  · normalize=True(走默认)—— 下游 cos 是裸点积,假定单位向量

用法: python embed.py <in.json> <out.json>
  in.json  : string[]
  out.json : number[][]  384 维单位向量,顺序与输入一致
"""
import json, sys, os

ML = '/Users/shiwenjie/Desktop/playground/projects/meridian/services/meridian-ml-service'
sys.path.insert(0, ML)
os.environ.setdefault('EMBEDDING_MODEL_NAME', f'{ML}/model-cache')

from src.embeddings import load_embedding_model, compute_embeddings

texts = json.load(open(sys.argv[1]))
mc = load_embedding_model()
emb = compute_embeddings(texts=texts, model_components=mc)

import numpy as np
n = np.linalg.norm(emb, axis=1)
# 卫生断言:下游的 cos 是裸点积,非单位向量会让阈值静默失效
assert abs(n.mean() - 1.0) < 1e-3, f'未归一化: {n.mean()}'
assert emb.shape[1] == 384, emb.shape

json.dump(emb.tolist(), open(sys.argv[2], 'w'))
print(f'OK {emb.shape}', file=sys.stderr)
