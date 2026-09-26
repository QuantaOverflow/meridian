"""
Golden-master（characterization）测试：POST /ai-worker/clustering。

这是 apps/backend/src/lib/services/ml-service.ts 调用的唯一聚类路由，实测
byte-deterministic（现生产算法 agglomerative_cosine：不降维、无随机种子依赖，
见 src/clustering.py 的 perform_agglomerative_clustering）。本测试不判"对不对"，
只判"相同输入是否还产出相同输出"——回归探测器，不是正确性证明。

刻意不用 `with TestClient(app) as client`：不触发 lifespan（后台预热模型 +
sklearn import）。/ai-worker/clustering 只吃请求里已经算好的
embedding，不需要模型，跳过预热能让测试秒起。

fixture：
  test/golden/request.json  —— backend 实际发送的请求体（items + config），
                                embedding 是 40-80 条合成标题过真实模型算出的
                                384 维向量，未做任何四舍五入，见
                                test/golden/generate_request.py。
  test/golden/response.json —— 对应的 golden 响应。

重新生成 golden 响应（不需要模型，纯调用现有 endpoint）：
    cd services/meridian-ml-service
    UPDATE_GOLDEN=1 .venv/bin/python -m pytest test/test_clustering_golden.py -q
重新生成 request.json（需要真实模型，见该脚本头部说明）：
    .venv/bin/python test/golden/generate_request.py
"""

import json
import os
from pathlib import Path

import pytest

# build_identity 顶层字段（main.py 的 get_build_identity）读构建戳路径的环境变量；
# 显式清空而不是假设本地/CI shell 没设置过它，否则 golden 响应会随跑测试的机器漂移。
os.environ.pop("MERIDIAN_ML_BUILD_STAMP_FILE", None)

from fastapi.testclient import TestClient  # noqa: E402

from src.main import app  # noqa: E402

GOLDEN_DIR = Path(__file__).resolve().parent / "golden"
REQUEST_PATH = GOLDEN_DIR / "request.json"
RESPONSE_PATH = GOLDEN_DIR / "response.json"


def _load_json(path: Path) -> dict:
    with open(path, "r", encoding="utf-8") as f:
        return json.load(f)


@pytest.fixture(scope="module")
def client():
    return TestClient(app)  # 无 `with`：不跑 lifespan，见模块 docstring


@pytest.fixture(scope="module")
def request_body() -> dict:
    return _load_json(REQUEST_PATH)


def _call_clustering(client: TestClient, request_body: dict) -> dict:
    """完全复现 apps/backend/src/lib/services/ml-service.ts 的
    analyzeClusters()（经 post('/ai-worker/clustering')）：同一路径、同一请求体形状。"""
    response = client.post("/ai-worker/clustering", json=request_body)
    assert response.status_code == 200, response.text
    return response.json()


def test_clustering_matches_golden_snapshot(client, request_body):
    actual = _call_clustering(client, request_body)

    if os.environ.get("UPDATE_GOLDEN") == "1":
        with open(RESPONSE_PATH, "w", encoding="utf-8") as f:
            json.dump(actual, f, ensure_ascii=False, indent=2, sort_keys=True)
            f.write("\n")
        pytest.skip("UPDATE_GOLDEN=1：已重写 golden 响应，本次运行不做比对")

    expected = _load_json(RESPONSE_PATH)
    assert actual == expected, (
        "聚类响应偏离 golden 快照——对同一份输入，产出变了。"
        "确认这是预期的算法/参数变更后，用 UPDATE_GOLDEN=1 重新生成再提交。"
    )


def test_clustering_is_deterministic_across_repeated_calls(client, request_body):
    """同一输入连续跑两次，输出必须逐字节相同——这是本测试要守住的不变量本体
    （byte-deterministic agglomerative clustering，见模块 docstring）。"""
    first = _call_clustering(client, request_body)
    second = _call_clustering(client, request_body)
    assert first == second
