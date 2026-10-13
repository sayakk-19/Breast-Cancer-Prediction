"""AppTest checks for auth restrictions and honest prediction availability."""
import json
from pathlib import Path

import httpx
import pytest
from streamlit.testing.v1 import AppTest

from backend.app.features import FEATURE_ORDER

APP = Path(__file__).resolve().parents[1] / "app.py"


@pytest.fixture
def api(monkeypatch):
    state = {"user": None, "offline": False, "calls": [], "measurement_status": 200, "library_status": 200}

    class Client:
        def __init__(self, *args, **kwargs):
            pass

        def __enter__(self):
            return self

        def __exit__(self, *args):
            return False

        def request(self, method, url, json=None, headers=None):
            state["calls"].append((method, url, json, headers))
            request = httpx.Request(method, url)
            if state["offline"]:
                raise httpx.ConnectError("offline", request=request)
            if url.endswith("/health"):
                return httpx.Response(200, json={"status": "ok", "service": "Breast Cancer Prediction API", "prediction_available": False}, request=request)
            if url.endswith("/auth/me"):
                if state["user"]:
                    return httpx.Response(200, json={"user": state["user"]}, request=request)
                return httpx.Response(401, json={"detail": "Session expired."}, request=request)
            if url.endswith("/auth/logout"):
                return httpx.Response(200, json={"message": "Signed out."}, request=request)
            if url.endswith("/library"):
                if state["library_status"] != 200:
                    return httpx.Response(state["library_status"], json={"detail": "Your session has expired. Sign in again."}, request=request)
                return httpx.Response(200, json={"resources": []}, request=request)
            if url.endswith("/validate"):
                if state["measurement_status"] != 200:
                    return httpx.Response(state["measurement_status"], json={"detail": "Session expired or access changed."}, request=request)
                return httpx.Response(200, json={"status": "valid", "feature_count": 30}, request=request)
            if url.endswith("/predict"):
                return httpx.Response(503, json={"detail": {"code": "MODEL_NOT_CONFIGURED", "message": "Prediction is unavailable. Connect your model to enable results."}}, request=request)
            raise AssertionError(f"Unexpected API request: {method} {url}")

    monkeypatch.setattr(httpx, "Client", Client)
    return state


def workspace(api, role=None, approved=True):
    app = AppTest.from_file(APP, default_timeout=10)
    app.session_state["page"] = "Measurements"
    if role:
        api["user"] = {"id": 1, "username": "workspace-user", "role": role, "approved": approved}
        app.session_state["token"] = "test-session"
    return app.run()


@pytest.mark.parametrize("role,approved", [(None, True), ("patient", True), ("doctor", False), ("researcher", False)])
def test_protected_form_is_hidden(api, role, approved):
    app = workspace(api, role, approved)
    assert not app.exception
    assert len(app.number_input) == 0
    assert not any(call[1].endswith(("/validate", "/predict")) for call in api["calls"])


def test_student_can_validate_but_cannot_predict(api):
    app = workspace(api, "student")
    assert not app.exception
    assert len(app.number_input) == 30
    assert app.button("FormSubmitter:measurements_form-Request prediction").disabled
    app.button("load_example").click().run()
    assert app.number_input("measurement_radius_mean").value == 12.0
    app.button("FormSubmitter:measurements_form-Validate measurements").click().run()
    assert not app.exception
    assert any("passed input validation" in item.value for item in app.success)
    validations = [call for call in api["calls"] if call[1].endswith("/validate")]
    assert len(validations) == 1
    assert validations[0][3] == {"Authorization": "Bearer test-session"}
    assert list(validations[0][2]["features"]) == list(FEATURE_ORDER)
    assert not any(call[1].endswith("/predict") for call in api["calls"])


def test_doctor_prediction_shows_unavailable_message_without_result(api):
    app = workspace(api, "doctor")
    app.button("load_example").click().run()
    app.button("FormSubmitter:measurements_form-Request prediction").click().run()
    assert not app.exception
    assert any("Prediction is unavailable" in item.value for item in app.info)
    assert "response" not in app.session_state["feedback"]
    assert not any("returned a prediction" in item.value for item in app.success)


def test_invalid_import_preserves_measurements(api):
    app = workspace(api, "researcher")
    app.button("load_example").click().run()
    payload = {"features": {name: 1.0 for name in FEATURE_ORDER}}
    payload["features"]["radius_mean"] = True
    app.text_area("import_json").input(json.dumps(payload))
    app.button("import_case").click().run()
    assert not app.exception
    assert any("radius_mean must be a number" in item.value for item in app.error)
    assert app.number_input("measurement_radius_mean").value == 12.0


def test_export_snapshot_and_reset(api):
    app = workspace(api, "student")
    app.button("load_example").click().run()
    app.number_input("measurement_radius_mean").set_value(14.25)
    app.button("FormSubmitter:measurements_form-Prepare JSON export").click().run()
    assert not app.exception
    assert app.session_state["last_submitted"]["features"]["radius_mean"] == 14.25
    assert len(app.get("download_button")) == 1
    app.button("clear_case").click().run()
    assert not app.exception
    assert app.number_input("measurement_radius_mean").value == 0.0
    assert "last_submitted" not in app.session_state


def test_expired_session_clears_access(api):
    app = workspace(api, "doctor")
    app.button("load_example").click().run()
    api["user"] = None
    app.run()
    assert not app.exception
    assert "token" not in app.session_state
    assert len(app.number_input) == 0
    assert app.session_state["measurement_radius_mean"] == 0.0
    assert "last_submitted" not in app.session_state


def test_approval_revoked_clears_sensitive_case(api):
    app = workspace(api, "doctor")
    app.button("load_example").click().run()
    app.button("FormSubmitter:measurements_form-Prepare JSON export").click().run()
    assert app.session_state["last_submitted"]["sample_id"] == "example-only"
    api["user"]["approved"] = False
    app.run()
    assert not app.exception
    assert len(app.number_input) == 0
    assert app.session_state["measurement_radius_mean"] == 0.0
    assert "last_submitted" not in app.session_state
    assert "feedback" not in app.session_state


@pytest.mark.parametrize("status", [401, 403])
def test_access_rejected_during_submit_resets_before_next_render(api, status):
    app = workspace(api, "doctor")
    app.button("load_example").click().run()
    api["measurement_status"] = status
    app.button("FormSubmitter:measurements_form-Validate measurements").click().run()
    assert not app.exception
    assert "token" not in app.session_state
    assert "user" not in app.session_state
    assert len(app.number_input) == 0
    assert app.session_state["measurement_radius_mean"] == 0.0
    assert "last_submitted" not in app.session_state


def test_library_session_expiry_clears_authentication(api):
    app = workspace(api, "doctor")
    app.button("load_example").click().run()
    api["library_status"] = 401
    app.radio("page").set_value("Learning library").run()
    assert not app.exception
    assert "token" not in app.session_state
    assert "user" not in app.session_state
    assert app.session_state["measurement_radius_mean"] == 0.0


def test_signed_in_user_can_sign_out_when_api_is_offline(api):
    app = workspace(api, "doctor")
    app.button("load_example").click().run()
    api["offline"] = True
    app.run()
    assert not app.exception
    assert len(app.number_input) == 0
    app.button("logout").click().run()
    assert not app.exception
    assert "token" not in app.session_state
    assert "user" not in app.session_state
    assert app.session_state["measurement_radius_mean"] == 0.0
    assert any("Signed out locally" in item.value for item in app.info)


def test_overview_library_navigation_callback(api):
    app = AppTest.from_file(APP, default_timeout=10).run()
    app.button("explore_library").click().run()
    assert not app.exception
    assert app.radio("page").value == "Learning library"


def test_offline_api_is_shown_without_exceptions(api):
    api["offline"] = True
    app = AppTest.from_file(APP, default_timeout=10).run()
    assert not app.exception
    assert any("offline or unreachable" in item.value for item in app.warning)

