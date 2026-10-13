"""Meaningful API checks for account security, role boundaries, and measurements."""

import hashlib
import json
import math

import pytest
from fastapi.testclient import TestClient
from pydantic import ValidationError

from backend.app.auth import AuthStore, SESSION_COOKIE_NAME, WORKSPACE_ROOT, configured_database_path
from backend.app.features import FEATURE_ORDER
from backend.app.main import create_app
from backend.app.schemas import MeasurementRequest

TEST_PASSWORD = "test-account-password-2026"


@pytest.fixture
def application(monkeypatch, tmp_path):
    monkeypatch.delenv("CORS_ORIGINS", raising=False)
    monkeypatch.delenv("SESSION_TTL_HOURS", raising=False)
    monkeypatch.delenv("SESSION_COOKIE_SECURE", raising=False)
    return create_app(database_path=tmp_path / "auth.sqlite3")


@pytest.fixture
def client(application):
    with TestClient(application) as test_client:
        yield test_client


@pytest.fixture
def payload():
    # Synthetic transport values test the contract, not clinical or training data.
    return {"sample_id": "test-case", "features": {name: 0.25 for name in FEATURE_ORDER}}


def sign_in(client, role="student", username="tester"):
    registered = client.post(
        "/api/v1/auth/register",
        json={"username": username, "password": TEST_PASSWORD, "role": role},
    )
    assert registered.status_code == 201
    response = client.post(
        "/api/v1/auth/login", json={"username": username, "password": TEST_PASSWORD}
    )
    assert response.status_code == 200
    return response.json()


@pytest.fixture
def approved_client(client, application):
    sign_in(client, role="doctor")
    application.state.auth_store.approve("tester")
    return client


def test_public_health_is_honest_about_prediction(client):
    assert client.get("/api/v1/health").json() == {
        "status": "ok", "service": "Breast Cancer Prediction API", "prediction_available": False
    }


def test_feature_metadata_has_stable_group_major_order(client):
    response = client.get("/api/v1/features")
    assert response.status_code == 200
    metadata = response.json()
    assert metadata["feature_order"] == list(FEATURE_ORDER)
    assert len(metadata["features"]) == 30
    assert [group["id"] for group in metadata["groups"]] == ["mean", "se", "worst"]
    assert [feature["name"] for feature in metadata["features"]] == list(FEATURE_ORDER)
    assert [feature["group"] for feature in metadata["features"]] == (
        ["mean"] * 10 + ["se"] * 10 + ["worst"] * 10
    )
    assert all(feature["minimum"] == 0 and feature["unit"] is None for feature in metadata["features"])
    assert metadata["disclaimer"]


@pytest.mark.parametrize("role,approved", [("patient", True), ("student", True), ("researcher", False), ("doctor", False)])
def test_registration_approval_is_assigned_by_server(client, role, approved):
    response = client.post(
        "/api/v1/auth/register", json={"username": "new-account", "password": TEST_PASSWORD, "role": role}
    )
    assert response.status_code == 201
    assert response.json()["user"]["approved"] is approved
    assert response.json()["user"]["role"] == role
    assert "access_token" not in response.json()
    assert client.get("/api/v1/auth/me").status_code == 401


@pytest.mark.parametrize("changes", [
    {"password": "too-short"},
    {"password": True},
    {"username": "a"},
    {"username": "name with space"},
    {"username": "patient@example.com"},
    {"role": "admin"},
    {"approved": True},
])
def test_registration_rejects_invalid_fields_and_privilege_injection(client, changes):
    body = {"username": "new-account", "password": TEST_PASSWORD, "role": "doctor"}
    body.update(changes)
    response = client.post("/api/v1/auth/register", json=body)
    assert response.status_code == 422
    assert TEST_PASSWORD not in response.text
    assert all("input" not in detail for detail in response.json()["detail"])


def test_duplicate_account_names_are_case_insensitive(client):
    sign_in(client, username="SomeUser")
    response = client.post(
        "/api/v1/auth/register",
        json={"username": "someuser", "password": TEST_PASSWORD, "role": "doctor"},
    )
    assert response.status_code == 409


def test_login_sets_http_only_cookie_and_hashes_passwords_and_sessions(client, application):
    signed_in = sign_in(client)
    assert client.get("/api/v1/auth/me").json()["user"] == signed_in["user"]
    cookie = next(cookie for cookie in client.cookies.jar if cookie.name == SESSION_COOKIE_NAME)
    assert cookie.path == "/api/v1"
    assert "HttpOnly" in cookie._rest
    assert cookie._rest["SameSite"].lower() == "lax"
    token = signed_in["access_token"]
    assert len(token) >= 40
    with application.state.auth_store.connection() as database:
        user = database.execute("SELECT password_hash,password_salt FROM users").fetchone()
        session = database.execute("SELECT token_hash FROM sessions").fetchone()
    assert user["password_hash"] != TEST_PASSWORD
    assert len(user["password_salt"]) == 32
    assert session["token_hash"] == hashlib.sha256(token.encode()).hexdigest()
    assert session["token_hash"] != token


def test_passwords_with_same_text_receive_different_salts(client, application):
    sign_in(client, username="first")
    sign_in(client, username="second")
    with application.state.auth_store.connection() as database:
        rows = database.execute("SELECT password_hash,password_salt FROM users").fetchall()
    assert rows[0]["password_salt"] != rows[1]["password_salt"]
    assert rows[0]["password_hash"] != rows[1]["password_hash"]


def test_bearer_tokens_work_without_browser_cookies(client):
    token = sign_in(client)["access_token"]
    client.cookies.clear()
    response = client.get("/api/v1/auth/me", headers={"Authorization": f"Bearer {token}"})
    assert response.status_code == 200
    assert response.json()["user"]["username"] == "tester"


def test_invalid_credentials_do_not_disclose_account_existence(client):
    sign_in(client)
    wrong_password = client.post(
        "/api/v1/auth/login", json={"username": "tester", "password": "wrong-password"}
    )
    absent_account = client.post(
        "/api/v1/auth/login", json={"username": "not-registered", "password": "wrong-password"}
    )
    assert wrong_password.status_code == absent_account.status_code == 401
    assert wrong_password.json() == absent_account.json()


@pytest.mark.parametrize("authorization", ["Basic token", "Bearer", "Bearer invalid", "Bearer one two"])
def test_invalid_bearer_does_not_fall_back_to_a_valid_cookie(client, authorization):
    sign_in(client)
    assert client.get("/api/v1/auth/me", headers={"Authorization": authorization}).status_code == 401


def test_logout_revokes_session_and_clears_cookie(client, application):
    token = sign_in(client)["access_token"]
    response = client.post("/api/v1/auth/logout")
    assert response.status_code == 200
    assert "Max-Age=0" in response.headers["set-cookie"]
    assert application.state.auth_store.session_user(token) is None
    assert client.get("/api/v1/auth/me").status_code == 401
    assert client.get("/api/v1/auth/me", headers={"Authorization": f"Bearer {token}"}).status_code == 401


def test_expired_sessions_are_rejected(client, application):
    sign_in(client)
    with application.state.auth_store.connection() as database:
        database.execute("UPDATE sessions SET expires_at = 0")
    assert client.get("/api/v1/auth/me").status_code == 401


@pytest.mark.parametrize("endpoint", ["validate", "predict"])
def test_measurement_endpoints_require_authentication(client, payload, endpoint):
    response = client.post(f"/api/v1/{endpoint}", json=payload, headers={"X-Role": "doctor"})
    assert response.status_code == 401


@pytest.mark.parametrize("role,endpoint,expected", [
    ("patient", "validate", 403), ("patient", "predict", 403),
    ("student", "validate", 200), ("student", "predict", 403),
    ("researcher", "validate", 403), ("researcher", "predict", 403),
    ("doctor", "validate", 403), ("doctor", "predict", 403),
])
def test_role_boundaries_are_enforced_on_server(client, payload, role, endpoint, expected):
    sign_in(client, role=role)
    assert client.post(f"/api/v1/{endpoint}", json=payload).status_code == expected


@pytest.mark.parametrize("role", ["doctor", "researcher"])
def test_approval_unlocks_professional_permissions_without_fake_prediction(client, application, payload, role):
    signed_in = sign_in(client, role=role)
    assert signed_in["user"]["approved"] is False
    application.state.auth_store.approve("tester")
    assert client.get("/api/v1/auth/me").json()["user"]["approved"] is True
    assert client.post("/api/v1/validate", json=payload).status_code == 200
    response = client.post("/api/v1/predict", json=payload)
    assert response.status_code == 503
    assert response.json() == {
        "detail": {
            "code": "MODEL_NOT_CONFIGURED",
            "message": "Prediction is unavailable. Connect your model to enable results.",
        }
    }
    assert client.post("/api/v1/auth/approve", json={"username": "tester"}).status_code == 404


def test_validated_measurements_round_trip(approved_client, payload):
    payload["features"]["radius_mean"] = 0
    payload["features"]["radius_worst"] = 12
    response = approved_client.post("/api/v1/validate", json=payload)
    assert response.status_code == 200
    assert response.json() == {
        "status": "valid", "sample_id": "test-case", "feature_count": 30,
        "features": payload["features"], "feature_order": list(FEATURE_ORDER),
    }


def test_optional_reference_is_allowed(approved_client, payload):
    del payload["sample_id"]
    assert approved_client.post("/api/v1/validate", json=payload).json()["sample_id"] is None


@pytest.mark.parametrize("endpoint", ["validate", "predict"])
@pytest.mark.parametrize("mutation", ["missing", "extra", "extra_top_level", "wrong_reference", "long_reference"])
def test_rejects_measurement_contract_violations(approved_client, payload, endpoint, mutation):
    if mutation == "missing":
        del payload["features"]["radius_mean"]
    elif mutation == "extra":
        payload["features"]["unexpected"] = 1
    elif mutation == "extra_top_level":
        payload["patient_name"] = "unrecognized field"
    elif mutation == "long_reference":
        payload["sample_id"] = "x" * 81
    else:
        payload["sample_id"] = 42
    assert approved_client.post(f"/api/v1/{endpoint}", json=payload).status_code == 422


@pytest.mark.parametrize("endpoint", ["validate", "predict"])
@pytest.mark.parametrize("value", [-0.01, True, False, "1.2", None, [], {}])
def test_rejects_invalid_measurement_values(approved_client, payload, endpoint, value):
    payload["features"]["radius_mean"] = value
    assert approved_client.post(f"/api/v1/{endpoint}", json=payload).status_code == 422


@pytest.mark.parametrize("value", [math.nan, math.inf, -math.inf])
@pytest.mark.parametrize("endpoint", ["validate", "predict"])
def test_nonfinite_inputs_return_serializable_422(approved_client, payload, value, endpoint):
    # Python accepts these nonstandard JSON tokens; the API must still reject them.
    payload["features"]["radius_mean"] = value
    response = approved_client.post(
        f"/api/v1/{endpoint}", content=json.dumps(payload, allow_nan=True),
        headers={"Content-Type": "application/json"},
    )
    assert response.status_code == 422
    assert all("input" not in detail for detail in response.json()["detail"])


@pytest.mark.parametrize("value", [None, [], "measurements", 42])
def test_rejects_nonobject_features(approved_client, payload, value):
    payload["features"] = value
    assert approved_client.post("/api/v1/validate", json=payload).status_code == 422


def test_request_schema_rejects_boolean_without_http(payload):
    payload["features"]["radius_mean"] = True
    with pytest.raises(ValidationError):
        MeasurementRequest.model_validate(payload)


def test_openapi_documents_all_30_keys(client):
    schema = client.get("/openapi.json").json()["components"]["schemas"]["MeasurementRequest"]
    features = schema["properties"]["features"]
    assert features["required"] == list(FEATURE_ORDER)
    assert features["additionalProperties"] is False
    assert len(features["properties"]) == 30
    assert schema["additionalProperties"] is False


def test_guest_library_exposes_only_public_patient_foundation(client):
    response = client.get("/api/v1/library?role=doctor")
    assert response.status_code == 200
    resources = response.json()["resources"]
    assert len(resources) == 3
    assert all("public" in resource["audience"] or "patient" in resource["audience"] for resource in resources)
    assert response.headers["cache-control"] == "no-store"


@pytest.mark.parametrize("role,count", [("patient", 3), ("student", 7), ("researcher", 9), ("doctor", 8)])
def test_library_filters_on_authenticated_approved_role(client, application, role, count):
    sign_in(client, role=role)
    application.state.auth_store.approve("tester")
    resources = client.get("/api/v1/library?role=doctor").json()["resources"]
    assert len(resources) == count
    assert all("public" in resource["audience"] or role in resource["audience"] for resource in resources)


@pytest.mark.parametrize("role", ["doctor", "researcher"])
def test_pending_staff_do_not_access_restricted_library(client, role):
    sign_in(client, role=role)
    resources = client.get("/api/v1/library").json()["resources"]
    assert len(resources) == 3


@pytest.mark.parametrize("origin", [
    "http://localhost:5173", "http://127.0.0.1:5173", "http://localhost:5174", "http://127.0.0.1:5174"
])
def test_explicit_local_origins_allow_credentialed_cors(client, origin):
    response = client.options(
        "/api/v1/validate", headers={
            "Origin": origin, "Access-Control-Request-Method": "POST",
            "Access-Control-Request-Headers": "content-type,authorization",
        },
    )
    assert response.status_code == 200
    assert response.headers["access-control-allow-origin"] == origin
    assert response.headers["access-control-allow-credentials"] == "true"


def test_unknown_browser_origin_cannot_change_account_state(client):
    response = client.post(
        "/api/v1/auth/register", headers={"Origin": "https://unlisted.example"},
        json={"username": "new-account", "password": TEST_PASSWORD, "role": "patient"},
    )
    assert response.status_code == 403
    assert response.json()["detail"]["code"] == "ORIGIN_NOT_ALLOWED"


def test_cors_environment_allowlist_replaces_defaults(monkeypatch, tmp_path):
    monkeypatch.setenv("CORS_ORIGINS", " https://workspace.example,https://workspace.example ")
    with TestClient(create_app(tmp_path / "auth.sqlite3")) as client:
        allowed = client.get("/api/v1/health", headers={"Origin": "https://workspace.example"})
        denied = client.get("/api/v1/health", headers={"Origin": "http://localhost:5173"})
    assert allowed.headers["access-control-allow-origin"] == "https://workspace.example"
    assert "access-control-allow-origin" not in denied.headers


def test_secure_cookie_setting(monkeypatch, tmp_path):
    monkeypatch.setenv("SESSION_COOKIE_SECURE", "true")
    with TestClient(create_app(tmp_path / "secure.sqlite3"), base_url="https://testserver") as client:
        sign_in(client)
        cookie = next(cookie for cookie in client.cookies.jar if cookie.name == SESSION_COOKIE_NAME)
        assert cookie.secure is True
        assert client.get("/api/v1/auth/me").status_code == 200


def test_auth_database_environment_cannot_point_outside_workspace(monkeypatch):
    monkeypatch.setenv("AUTH_DB_PATH", str(WORKSPACE_ROOT.parent / "outside-auth.sqlite3"))
    with pytest.raises(ValueError, match="inside the project workspace"):
        configured_database_path()


def test_relative_auth_database_environment_resolves_from_project(monkeypatch):
    monkeypatch.setenv("AUTH_DB_PATH", ".cache/runtime-auth.sqlite3")
    assert configured_database_path() == (WORKSPACE_ROOT / ".cache/runtime-auth.sqlite3").resolve()


def test_direct_auth_store_cannot_write_outside_project():
    with pytest.raises(ValueError, match="inside the project workspace"):
        AuthStore(WORKSPACE_ROOT.parent / "outside-auth.sqlite3")


def test_wildcard_cors_is_rejected(monkeypatch, tmp_path):
    monkeypatch.setenv("CORS_ORIGINS", "*")
    with pytest.raises(ValueError, match="explicit HTTP"):
        create_app(tmp_path / "auth.sqlite3")
