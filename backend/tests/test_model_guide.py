"""The walkthrough must not leak through direct API requests or stale sessions."""
import json
import pytest
from fastapi.testclient import TestClient
from backend.app.main import create_app
from backend.app.model_guide import model_guide


@pytest.fixture
def app(tmp_path, monkeypatch):
    monkeypatch.delenv("CORS_ORIGINS", raising=False)
    monkeypatch.delenv("SESSION_COOKIE_SECURE", raising=False)
    return create_app(database_path=tmp_path / "auth.sqlite3", model_directory=tmp_path)


@pytest.mark.parametrize("role,approve,expected", [
    (None, False, 401), ("patient", False, 403), ("doctor", True, 403),
    ("researcher", False, 403), ("researcher", True, 200), ("student", False, 200),
])
def test_model_guide_role_boundary(app, role, approve, expected):
    with TestClient(app) as client:
        if role:
            credentials = {"username": "guide-reader", "password": "guide-test-password-2026"}
            assert client.post("/api/v1/auth/register", json={**credentials, "role": role}).status_code == 201
            if approve:
                app.state.auth_store.approve(credentials["username"])
            assert client.post("/api/v1/auth/login", json=credentials).status_code == 200
        response = client.get("/api/v1/model-guide")
        assert response.status_code == expected
        assert response.headers["cache-control"] == "no-store"
        if expected == 200:
            assert len(response.json()["steps"]) == 6
            assert response.json()["metrics"] is None
            client.post("/api/v1/auth/logout")
            assert client.get("/api/v1/model-guide").status_code == 401
        else:
            assert "steps" not in response.json()
            assert "metrics" not in response.json()


def test_recorded_metrics_and_invalid_export(tmp_path):
    path = tmp_path / "metadata.json"
    metrics = dict.fromkeys(["Accuracy", "Precision", "Recall", "F1", "ROC-AUC"], 0.75)
    path.write_text(json.dumps({"validation_metrics": metrics, "test_metrics": metrics}))
    assert model_guide(tmp_path)["metrics"]["test"]["Accuracy"] == 0.75
    path.write_text('{"validation_metrics": null}')
    assert model_guide(tmp_path)["metrics"] is None
