"""
生成 test/golden/request.json —— golden-master 测试的输入 fixture。

只在需要**换嵌入模型 / 改测试语料**时重跑一次；跑出来的向量是精确浮点值，
必须原样提交（不许四舍五入），否则 golden 响应对不上。

用法（必须用本 service 自己的 venv，模型已在 model-cache/ 本地缓存，不联网）：
    cd services/meridian-ml-service
    .venv/bin/python test/golden/generate_request.py

生成的 request.json 就是 backend（apps/backend/src/lib/services/clustering.ts）
对 POST /ai-worker/clustering 发送的请求体：
    { items: [{id, title, url, embedding, publishDate, summary}, ...], config: {...} }
config 的 11 个字段值取自 apps/backend/src/lib/core/constants.ts 的
BRIEF_CLUSTERING_OPTIONS，经 clustering.ts:322-358 的 `options?.x ?? default` 展开
后实际发送的值（不是 ml 侧 pydantic 的默认值）。

标题为短合成句，不是真实文章文本（本仓库公开）：6 个主题各 8 句同题改写 +
8 条不相关单例，共 56 条，覆盖率落在任务要求的 40-80 条区间。
"""

import json
import os
import sys
from pathlib import Path

SERVICE_ROOT = Path(__file__).resolve().parents[2]
MODEL_CACHE = SERVICE_ROOT / "model-cache"

# 必须在 import src.config（进而 src.embeddings）之前设置：Settings() 在模块级
# 用 os.getenv 读一次，之后就是单例，晚设置无效。
#
# model-cache/ 是 gitignored（470MB），worktree 里没有；在 worktree 跑本脚本时
# 需显式传 EMBEDDING_MODEL_NAME=<main-checkout>/services/meridian-ml-service/model-cache。
if "EMBEDDING_MODEL_NAME" not in os.environ:
    if not MODEL_CACHE.is_dir():
        raise SystemExit(
            f"未设置 EMBEDDING_MODEL_NAME，且默认路径不存在: {MODEL_CACHE}\n"
            "在 worktree 里跑时需显式传主 checkout 的 model-cache 路径，例如：\n"
            "  EMBEDDING_MODEL_NAME=/Users/shiwenjie/Desktop/playground/projects/meridian/"
            "services/meridian-ml-service/model-cache \\\n"
            "  <main-checkout venv>/bin/python test/golden/generate_request.py"
        )
    os.environ["EMBEDDING_MODEL_NAME"] = str(MODEL_CACHE)

sys.path.insert(0, str(SERVICE_ROOT))

from src.embeddings import compute_embeddings, load_embedding_model  # noqa: E402

# ============================================================================
# 合成语料：6 个主题 × 8 句同题改写 + 8 条不相关单例
# ============================================================================

TOPICS: list[list[str]] = [
    # 主题 1：电池材料
    [
        "Scientists unveil new solid-state battery material in lab trial",
        "Researchers announce breakthrough solid-state battery compound",
        "Lab team reports novel material for longer-lasting batteries",
        "New battery chemistry promises faster charging, study finds",
        "Solid-state battery material discovery could reshape EV industry",
        "Chemists develop experimental battery material with higher density",
        "Study details new compound for next-generation batteries",
        "Research lab confirms progress on solid-state battery material",
    ],
    # 主题 2：央行加息
    [
        "Central bank raises benchmark interest rate by quarter point",
        "Policymakers hike interest rates to curb inflation",
        "Central bank announces rate increase amid inflation concerns",
        "Monetary authority lifts key rate for third time this year",
        "Interest rate hike announced by central bank policy committee",
        "Central bank tightens policy with new rate increase",
        "Rate-setting committee votes to raise benchmark rate",
        "Central bank signals further rate hikes ahead",
    ],
    # 主题 3：城市马拉松
    [
        "Thousands of runners take part in annual city marathon",
        "City marathon draws record number of participants",
        "Runners flood downtown streets for annual marathon event",
        "Annual marathon race sees thousands cross finish line",
        "Local marathon attracts record crowd of runners",
        "City streets closed as marathon draws thousands",
        "Marathon event brings record turnout to city center",
        "Thousands join annual marathon race downtown",
    ],
    # 主题 4：新款手机发布
    [
        "Tech company unveils latest smartphone model",
        "New smartphone launch announced by tech firm",
        "Tech giant reveals newest flagship phone",
        "Company launches next-generation smartphone device",
        "Tech firm announces new phone with upgraded camera",
        "Latest smartphone model unveiled at company event",
        "New flagship phone announced by tech company",
        "Tech company debuts newest smartphone lineup",
    ],
    # 主题 5：山火疏散
    [
        "Wildfire forces evacuation of thousands in mountain region",
        "Mountain wildfire spreads, thousands evacuated",
        "Thousands flee homes as wildfire spreads in hills",
        "Wildfire prompts mass evacuation in mountain communities",
        "Fast-moving wildfire forces thousands from homes",
        "Mountain region wildfire triggers evacuation orders",
        "Wildfire spreads rapidly, evacuations ordered for thousands",
        "Thousands evacuated as wildfire burns through mountains",
    ],
    # 主题 6：篮球联赛总决赛
    [
        "Basketball league finals conclude with championship win",
        "Professional basketball finals wrap up season",
        "Championship basketball finals come to a close",
        "Basketball finals end with thrilling championship game",
        "League finals conclude as basketball season wraps up",
        "Basketball championship series concludes finals",
        "Professional league basketball finals reach conclusion",
        "Basketball finals close out championship season",
    ],
]

SINGLETONS: list[str] = [
    "Archaeologists uncover ancient pottery at dig site",
    "New species of frog discovered in rainforest",
    "City council approves plan for new public library",
    "Astronomers detect faint signal from distant galaxy",
    "Farmers report record harvest after favorable weather",
    "Museum opens new exhibit on ancient maritime trade",
    "Volunteers plant thousands of trees in reforestation drive",
    "Chess tournament crowns new regional champion",
]


def build_titles() -> list[str]:
    """按主题轮转交错排列（而不是按主题分组），更接近真实抓取顺序。"""
    titles: list[str] = []
    max_len = max(len(t) for t in TOPICS)
    for i in range(max_len):
        for topic in TOPICS:
            if i < len(topic):
                titles.append(topic[i])
    titles.extend(SINGLETONS)
    return titles


# ============================================================================
# config：与 apps/backend/src/lib/services/clustering.ts 里
# analyzeClusters() 对 BRIEF_CLUSTERING_OPTIONS 展开后实际发送的值逐字段对齐
# （见 apps/backend/src/lib/core/constants.ts 的 BRIEF_CLUSTERING_OPTIONS）。
# ============================================================================
CONFIG = {
    "agglomerative_threshold": 0.1,
    "agglomerative_linkage": "average",
    "agglomerative_min_cluster_size": 3,
}


def main() -> None:
    titles = build_titles()
    print(f"生成 {len(titles)} 条合成标题的真实嵌入（模型：{os.environ['EMBEDDING_MODEL_NAME']}）...")

    model_components = load_embedding_model()
    embeddings = compute_embeddings(texts=titles, model_components=model_components)
    assert embeddings.shape == (len(titles), 384), f"意外的嵌入形状: {embeddings.shape}"

    base_date = "2026-09-01T08:00:00.000Z"
    items = []
    for idx, title in enumerate(titles):
        article_id = idx + 1
        items.append(
            {
                "id": article_id,
                "title": title,
                "url": f"https://example.test/article/{article_id}",
                "embedding": embeddings[idx].tolist(),
                "publishDate": base_date,
                "summary": f"Synthetic test summary for: {title}",
            }
        )

    request_body = {"items": items, "config": CONFIG}

    out_path = Path(__file__).resolve().parent / "request.json"
    with open(out_path, "w", encoding="utf-8") as f:
        json.dump(request_body, f, ensure_ascii=False, indent=2)
        f.write("\n")

    print(f"写入 {out_path}（{len(items)} 条 item，嵌入未做任何四舍五入）")


if __name__ == "__main__":
    main()
