"""
GET /health 的镜像身份：构建戳旁边带部署时的提交（短哈希、标题、工作区是否有未提交改动）。

三个值由 scripts/deploy.sh 经 wrangler 的 image_vars 作为 Docker build arg 传入，Dockerfile 落成环境变量。
backend 的运维台经 ML_SERVICE binding 读这个响应（apps/backend/src/lib/ops/services.ts）。

不用 `with TestClient(app)`：不触发 lifespan 的模型预热（同 test_clustering_golden.py）。
"""

import pytest
from fastapi.testclient import TestClient

from src.main import app

client = TestClient(app)

GIT_ENV = ("MERIDIAN_ML_GIT_COMMIT", "MERIDIAN_ML_GIT_TITLE", "MERIDIAN_ML_GIT_DIRTY")


@pytest.fixture(autouse=True)
def clean_env(monkeypatch):
    for name in (*GIT_ENV, "MERIDIAN_ML_BUILD_STAMP_FILE"):
        monkeypatch.delenv(name, raising=False)


def health():
    resp = client.get("/health")
    assert resp.status_code == 200
    return resp.json()


def test_health_reports_commit_next_to_build_stamp(monkeypatch, tmp_path):
    stamp = tmp_path / ".build_stamp"
    stamp.write_text("2026-10-05T12:00:00Z\n", encoding="utf-8")
    monkeypatch.setenv("MERIDIAN_ML_BUILD_STAMP_FILE", str(stamp))
    monkeypatch.setenv("MERIDIAN_ML_GIT_COMMIT", "13db6c7")
    monkeypatch.setenv("MERIDIAN_ML_GIT_TITLE", 'feat(ops): 运维台 "骨架": a, b')
    monkeypatch.setenv("MERIDIAN_ML_GIT_DIRTY", "true")

    assert health() == {
        "status": "healthy",
        "build_identity": {
            "build_time": "2026-10-05T12:00:00Z",
            "injected": True,
            "git_commit": "13db6c7",
            "git_title": 'feat(ops): 运维台 "骨架": a, b',
            "git_dirty": True,
        },
    }


def test_clean_tree_reports_dirty_false(monkeypatch):
    monkeypatch.setenv("MERIDIAN_ML_GIT_COMMIT", "13db6c7")
    monkeypatch.setenv("MERIDIAN_ML_GIT_DIRTY", "false")

    identity = health()["build_identity"]
    assert identity["git_commit"] == "13db6c7"
    assert identity["git_dirty"] is False


@pytest.mark.parametrize("value", [None, "", "not-injected"])
def test_commit_not_passed_is_null_not_a_placeholder(monkeypatch, value):
    # 没经 scripts/deploy.sh 部署（wrangler.jsonc 里的占位值原样进镜像）或本地直起服务
    if value is not None:
        for name in GIT_ENV:
            monkeypatch.setenv(name, value)

    assert health()["build_identity"] == {
        "build_time": "not-injected",
        "injected": False,
        "git_commit": None,
        "git_title": None,
        "git_dirty": None,
    }
