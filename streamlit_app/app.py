"""Streamlit companion for the Breast Cancer Prediction FastAPI workspace."""
from __future__ import annotations

import json
import math
import os
from pathlib import Path
import sys
from typing import Any
from urllib.parse import urlparse

import httpx
import streamlit as st

ROOT = Path(__file__).resolve().parents[1]
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

# Reuse input metadata only. Importing this module does not start the API.
from backend.app.features import DISCLAIMER, FEATURE_DEFINITIONS, FEATURE_ORDER, GROUPS


def normalize_api_url(value: str) -> str:
    parsed = urlparse(value.strip())
    if (parsed.scheme not in {"http", "https"}
            or parsed.hostname not in {"localhost", "127.0.0.1", "::1"}
            or parsed.username or parsed.password or parsed.query or parsed.fragment
            or parsed.path not in {"", "/"}):
        raise ValueError("Use a local API root, such as http://127.0.0.1:8000.")
    try:
        _ = parsed.port
    except ValueError as exc:
        raise ValueError("Enter a valid API port.") from exc
    return value.strip().rstrip("/")


def decode_payload(raw: str) -> dict[str, Any]:
    if len(raw) > 100_000:
        raise ValueError("The JSON input is too large for one case.")
    try:
        data = json.loads(raw)
    except json.JSONDecodeError as exc:
        raise ValueError("Enter a valid JSON object.") from exc
    if not isinstance(data, dict) or set(data) - {"sample_id", "features"}:
        raise ValueError("Use an object with features and an optional sample_id.")
    features = data.get("features")
    if not isinstance(features, dict) or set(features) != set(FEATURE_ORDER):
        raise ValueError("Include exactly the 30 named measurements in features.")
    for name, value in features.items():
        if isinstance(value, bool) or not isinstance(value, (int, float)):
            raise ValueError(f"{name} must be a number.")
        try:
            number = float(value)
        except (OverflowError, ValueError) as exc:
            raise ValueError(f"{name} must be finite and nonnegative.") from exc
        if not math.isfinite(number) or number < 0:
            raise ValueError(f"{name} must be finite and nonnegative.")
    reference = data.get("sample_id")
    if reference is not None and (not isinstance(reference, str) or len(reference) > 80):
        raise ValueError("Case reference must be a string of at most 80 characters or null.")
    return {"sample_id": reference, "features": {name: float(features[name]) for name in FEATURE_ORDER}}


def request_api(api_url: str, method: str, path: str,
                payload: dict | None = None, token: str | None = None) -> httpx.Response:
    headers = {"Authorization": f"Bearer {token}"} if token else {}
    with httpx.Client(timeout=httpx.Timeout(6.0, connect=2.0), trust_env=False) as client:
        return client.request(method, f"{api_url}/api/v1{path}", json=payload, headers=headers)


def message_from_response(response: httpx.Response) -> str:
    try:
        detail = response.json().get("detail", "The API could not process this request.")
    except (ValueError, AttributeError):
        return f"The API returned HTTP {response.status_code}. Check the service and try again."
    if isinstance(detail, dict):
        return str(detail.get("message", "The API could not process this request."))
    if isinstance(detail, list):
        messages = []
        for issue in detail[:4]:
            location = ".".join(str(part) for part in issue.get("loc", [])[1:])
            messages.append(f"{location}: {issue.get('msg', 'Invalid value')}")
        return "Check your input. " + "; ".join(messages)
    return str(detail)


def can_assess(user: dict | None) -> bool:
    return bool(user and user.get("approved") and user.get("role") in {"student", "doctor", "researcher"})


def can_predict(user: dict | None) -> bool:
    return bool(user and user.get("approved") and user.get("role") in {"doctor", "researcher"})


def clear_session_case() -> None:
    for name in FEATURE_ORDER:
        st.session_state[f"measurement_{name}"] = 0.0
    st.session_state["case_reference"] = ""
    for key in ("feedback", "last_submitted", "import_error", "notice", "import_json"):
        st.session_state.pop(key, None)


def apply_payload(payload: dict[str, Any], notice: str) -> None:
    for name, value in payload["features"].items():
        st.session_state[f"measurement_{name}"] = float(value)
    st.session_state["case_reference"] = payload.get("sample_id") or ""
    st.session_state.pop("feedback", None)
    st.session_state.pop("last_submitted", None)
    st.session_state["notice"] = notice


def load_example() -> None:
    # Made-up form values only; no dataset or diagnostic result is included.
    bases = (12.0, 18.0, 78.0, 450.0, 0.09, 0.08, 0.04, 0.02, 0.18, 0.06)
    factors = {"mean": 1.0, "se": 0.08, "worst": 1.25}
    values = {name: round(bases[index % 10] * factors[name.rsplit("_", 1)[1]], 5)
              for index, name in enumerate(FEATURE_ORDER)}
    apply_payload({"sample_id": "example-only", "features": values},
                  "Synthetic example loaded. These values explore the form only and have no diagnostic meaning.")


def clear_case() -> None:
    clear_session_case()
    st.session_state["notice"] = "The measurement form and submitted case have been cleared."


def forget_account(message: str | None = None) -> None:
    """Clear authentication and case data before the next set of widgets renders."""
    st.session_state.pop("token", None)
    st.session_state.pop("user", None)
    clear_session_case()
    if message:
        st.session_state["auth_notice"] = message


def reject_access(response: httpx.Response) -> None:
    """Handle access lost while a request is in flight, before displaying a case."""
    if response.status_code not in {401, 403} or not st.session_state.get("token"):
        return
    # Measurements may already be rendered. Reset their widget state at the
    # beginning of the next run, when Streamlit permits changing widget values.
    st.session_state["access_reset"] = message_from_response(response)
    st.rerun()


def open_library() -> None:
    st.session_state["page"] = "Learning library"


def change_api() -> None:
    forget_account()


def import_case() -> None:
    try:
        payload = decode_payload(st.session_state.get("import_json", ""))
    except ValueError as exc:
        st.session_state["import_error"] = str(exc)
    else:
        apply_payload(payload, "JSON imported. Review the measurements, then validate them with the API.")
        st.session_state.pop("import_error", None)


def authenticate_sidebar(api_url: str, connected: bool, user: dict | None) -> None:
    if user:
        st.markdown(f"**{user['username']}**")
        st.caption(f"{user['role'].title()} · {'Approved' if user.get('approved') else 'Approval pending'}")
        if not user.get("approved"):
            st.info("Doctor and researcher accounts need local administrator approval before using measurements.")
        if st.button("Sign out", key="logout", use_container_width=True):
            notice = None
            try:
                response = request_api(api_url, "POST", "/auth/logout", token=st.session_state.get("token"))
                if not response.is_success:
                    notice = "Signed out locally. The API could not confirm session revocation."
            except httpx.HTTPError:
                notice = "Signed out locally. The API could not confirm session revocation."
            forget_account(notice)
            st.rerun()
        return

    mode = st.radio("Account", ["Sign in", "Create account"], horizontal=True, key="auth_mode")
    with st.form("account_form", clear_on_submit=True):
        username = st.text_input("Username", help="Choose a non-identifying username.", key="auth_username")
        password = st.text_input("Password", type="password", key="auth_password",
                                 help="New passwords must contain at least 12 characters.")
        role = st.selectbox("Your role", ["patient", "student", "researcher", "doctor"]) if mode == "Create account" else None
        submit = st.form_submit_button(mode, type="primary", use_container_width=True, disabled=not connected)
    if submit:
        if not username.strip() or not password:
            st.error("Enter a username and password.")
            return
        if mode == "Create account" and len(password) < 12:
            st.error("Choose a password with at least 12 characters.")
            return
        try:
            payload = {"username": username.strip(), "password": password}
            if mode == "Create account":
                payload["role"] = role
            response = request_api(api_url, "POST", "/auth/register" if role else "/auth/login", payload)
            if not response.is_success:
                st.error(message_from_response(response))
                return
            data = response.json()
            if role:
                st.success(data.get("message", "Account created. Sign in to continue."))
            else:
                st.session_state["token"] = data["access_token"]
                st.session_state["user"] = data["user"]
                clear_session_case()
                st.rerun()
        except (httpx.HTTPError, ValueError, KeyError):
            st.error("The account request could not be completed. Check the API connection.")
    st.caption("Patient and student accounts are active on registration. Doctor and researcher accounts require administrator approval.")


def show_library(api_url: str, connected: bool, user: dict | None) -> None:
    st.subheader("Reading for your next step")
    st.caption("Sources and educational summaries, selected for your access level.")
    if not connected:
        st.warning("Start the FastAPI service to load the educational library.")
        return
    try:
        response = request_api(api_url, "GET", "/library", token=st.session_state.get("token"))
        reject_access(response)
        if not response.is_success:
            st.error(message_from_response(response))
            return
        resources = response.json()["resources"]
    except (httpx.HTTPError, ValueError, KeyError):
        st.error("The educational library could not be loaded. Refresh the API connection.")
        return
    query = st.text_input("Search the library", placeholder="Try screening, measurements, or research", key="library_search").strip().lower()
    matches = [resource for resource in resources
               if not query or query in " ".join([resource["title"], resource["summary"], *resource.get("tags", [])]).lower()]
    if not matches:
        st.info("No resources match that search.")
    for resource in matches:
        with st.expander(resource["title"]):
            st.caption(f"{resource['category']} · {resource['reading_minutes']} minute read")
            st.markdown(resource["summary"])
            for paragraph in resource["body"]:
                st.write(paragraph)
            source = resource["source"]
            st.link_button(f"Read the source: {source['label']}", source["url"])
    st.caption("Educational content helps you prepare questions and understand terminology. It does not replace clinical care.")


def show_measurements(api_url: str, connected: bool, user: dict | None, prediction_available: bool) -> None:
    st.subheader("Measurement workspace")
    if not can_assess(user):
        if not user:
            st.info("Sign in with an approved student, researcher, or doctor account to open the measurement form.")
        elif user.get("role") == "patient":
            st.info("Patient accounts use the educational library. Measurement and prediction tools require a professional or student account.")
        else:
            st.info("Your account is awaiting administrator approval. Educational resources remain available.")
        return

    for name in FEATURE_ORDER:
        st.session_state.setdefault(f"measurement_{name}", 0.0)
    st.session_state.setdefault("case_reference", "")
    st.caption("Practice input validation" if user["role"] == "student" else "Prepare a measurement case")
    st.info(DISCLAIMER)
    columns = st.columns([3, 1, 1])
    columns[0].caption("Use a non-identifying case reference. Cases remain in the current session and are not stored by the API.")
    columns[1].button("Load example", key="load_example", on_click=load_example, use_container_width=True)
    columns[2].button("Clear case", key="clear_case", on_click=clear_case, use_container_width=True)
    if st.session_state.get("notice"):
        st.caption(st.session_state["notice"])

    with st.expander("Import measurement JSON"):
        st.caption("Include a features object and optional sample_id. All 30 named measurements are required.")
        st.text_area("Case JSON", key="import_json", height=160,
                     placeholder='{"sample_id": "case-001", "features": {"radius_mean": 12.0, ...}}')
        st.button("Import measurements", key="import_case", on_click=import_case)
        if st.session_state.get("import_error"):
            st.error(st.session_state["import_error"])

    with st.form("measurements_form", clear_on_submit=False):
        st.text_input("Case reference (optional)", key="case_reference", max_chars=80, placeholder="case-001")
        tabs = st.tabs([group["label"] for group in GROUPS])
        for tab, group in zip(tabs, GROUPS):
            with tab:
                st.caption(group["description"])
                fields = [field for field in FEATURE_DEFINITIONS if field["group"] == group["id"]]
                columns = st.columns(2)
                for index, field in enumerate(fields):
                    with columns[index % 2]:
                        st.number_input(field["label"], min_value=0.0, step=0.001, format="%.6f",
                                        key=f"measurement_{field['name']}",
                                        help=f"{field['description']} · API field: {field['name']}")
        st.caption("All values must be finite and nonnegative. Validation checks numeric structure, not clinical plausibility.")
        actions = st.columns(3)
        validate = actions[0].form_submit_button("Validate measurements", type="primary", use_container_width=True, disabled=not connected)
        predict = actions[1].form_submit_button("Request prediction", use_container_width=True, disabled=not connected or not can_predict(user))
        export = actions[2].form_submit_button("Prepare JSON export", use_container_width=True)

    if validate or predict or export:
        payload = {"sample_id": st.session_state["case_reference"].strip() or None,
                   "features": {name: st.session_state[f"measurement_{name}"] for name in FEATURE_ORDER}}
        try:
            payload = decode_payload(json.dumps(payload))
        except ValueError as exc:
            st.session_state["feedback"] = {"kind": "error", "message": str(exc)}
        else:
            st.session_state["last_submitted"] = payload
            if export:
                st.session_state["feedback"] = {"kind": "info", "message": "JSON is ready to download below. API validation was not requested."}
            elif predict and not can_predict(user):
                st.session_state["feedback"] = {"kind": "error", "message": "Prediction access requires an approved doctor or researcher account."}
            else:
                try:
                    with st.spinner("Checking the submitted case…"):
                        response = request_api(api_url, "POST", "/predict" if predict else "/validate",
                                               payload, st.session_state.get("token"))
                    reject_access(response)
                    if response.is_success:
                        result = response.json()
                        if predict:
                            st.session_state["feedback"] = {"kind": "success", "message": "The API returned a prediction response.", "response": result}
                        else:
                            st.session_state["feedback"] = {"kind": "success", "message": "All 30 measurements passed input validation. This confirms the input structure only; it is not a diagnosis."}
                    else:
                        st.session_state["feedback"] = {"kind": "info" if response.status_code == 503 else "error",
                                                       "message": message_from_response(response)}
                except (httpx.HTTPError, ValueError):
                    st.session_state["feedback"] = {"kind": "error", "message": "The request could not be completed. Check the API and try again."}

    if not can_predict(user):
        st.caption("Student accounts can practice measurement entry and validation. Prediction requests are restricted to approved doctors and researchers.")
    elif not prediction_available:
        st.info("Prediction is unavailable. Connect your model to enable results.")
    if st.session_state.get("feedback"):
        feedback = st.session_state["feedback"]
        getattr(st, feedback["kind"])(feedback["message"])
        st.caption("This message applies to the last submitted values. Submit again after changing the form.")
        if "response" in feedback:
            st.json(feedback["response"])
    if st.session_state.get("last_submitted"):
        snapshot = st.session_state["last_submitted"]
        st.download_button("Download submitted case JSON", data=json.dumps(snapshot, indent=2, allow_nan=False),
                           file_name="breast-cancer-case.json", mime="application/json", key="download_case")
        st.caption("The download contains the last submitted case. Prepare JSON export includes your latest form edits.")
        with st.expander("Review submitted JSON"):
            st.json(snapshot)


def main() -> None:
    st.set_page_config(page_title="Breast Cancer Prediction", page_icon="🌸", layout="wide")
    if st.session_state.get("access_reset"):
        forget_account(st.session_state.pop("access_reset"))
    st.markdown("""
        <style>
        .stApp { background: #fbf7f6; color: #302a2d; }
        [data-testid="stSidebar"] { background: #f4ecec; }
        h1, h2, h3 { letter-spacing: -0.035em; }
        [data-testid="stForm"] { background: #fffdfc; border: 1px solid #e6d9dc; border-radius: 16px; }
        [data-testid="stMetric"] { background: #fffdfc; border: 1px solid #e6d9dc; padding: 16px; border-radius: 12px; }
        .stButton button[kind="primary"], .stFormSubmitButton button[kind="primary"] { background: #a74d6d; border-color: #a74d6d; color: white; }
        </style>
        """, unsafe_allow_html=True)

    with st.sidebar:
        st.markdown("### 🌸 Breast Cancer Prediction")
        st.caption("LEARN · PREPARE · UNDERSTAND")
        page = st.radio("Workspace", ["Overview", "Learning library", "Measurements", "Access & setup"], key="page")
        st.divider()
        api_input = st.text_input("FastAPI base URL", value=os.getenv("API_BASE_URL", "http://127.0.0.1:8000"),
                                 key="api_url", help="Use a local API root on this computer.", on_change=change_api)
        st.button("Refresh connection", key="refresh_api")

    api_url = ""
    connected = False
    prediction_available = False
    connection_error = ""
    user = None
    try:
        api_url = normalize_api_url(api_input)
        health = request_api(api_url, "GET", "/health")
        health.raise_for_status()
        body = health.json()
        connected = body.get("status") == "ok"
        prediction_available = body.get("prediction_available") is True
        if connected and st.session_state.get("token"):
            me = request_api(api_url, "GET", "/auth/me", token=st.session_state["token"])
            if me.status_code in {401, 403}:
                forget_account("Your session expired or access changed. Sign in again.")
            elif me.is_success:
                user = me.json()["user"]
                previous_user = st.session_state.get("user")
                if previous_user and (
                        previous_user.get("id") != user.get("id")
                        or previous_user.get("role") != user.get("role")
                        or (can_assess(previous_user) and not can_assess(user))):
                    clear_session_case()
                st.session_state["user"] = user
            else:
                connection_error = message_from_response(me)
    except (httpx.HTTPError, ValueError, AttributeError, KeyError) as exc:
        connection_error = str(exc) if isinstance(exc, ValueError) else "The API is offline or unreachable."

    with st.sidebar:
        if connected:
            st.success("API connected")
            if connection_error:
                st.warning(connection_error)
        else:
            st.warning(connection_error or "The API is unavailable.")
        st.caption("Prediction: available" if prediction_available else "Prediction: awaiting integration")
        st.divider()
        if st.session_state.get("auth_notice"):
            st.info(st.session_state.pop("auth_notice"))
        sidebar_user = user or st.session_state.get("user")
        if sidebar_user and not user:
            st.caption("Access could not be verified. Protected tools are unavailable until the connection returns.")
        authenticate_sidebar(api_url, connected, sidebar_user)
        st.divider()
        st.caption("Do not enter personal identifiers. Measurement data stays in session memory; accounts are stored by the local API.")

    st.caption("BREAST CANCER PREDICTION / WORKSPACE")
    st.title("Clarity at every step.")
    st.markdown("A shared place for patients, students, researchers, and doctors to learn and prepare.")
    if page == "Overview":
        st.subheader(f"Welcome, {user['role']}" if user else "Choose the path that fits you")
        cards = [
            ("Patients", "Understand terminology, explore reliable resources, and prepare questions for your care team."),
            ("Students", "Build foundational knowledge and practice structured measurement entry with input validation."),
            ("Researchers", "Review technical resources and prepare consistent measurement cases after account approval."),
            ("Doctors", "Access professional resources and the measurement workflow after account approval."),
        ]
        for column, (title, description) in zip(st.columns(4), cards):
            with column:
                st.markdown(f"### {title}")
                st.write(description)
        if not prediction_available:
            st.info("Prediction is unavailable. Connect your model to enable results.")
        st.caption(DISCLAIMER)
        st.button("Explore the learning library", key="explore_library", on_click=open_library)
    elif page == "Learning library":
        show_library(api_url, connected, user)
    elif page == "Measurements":
        show_measurements(api_url, connected, user, prediction_available)
    else:
        st.subheader("Access and local setup")
        st.table([
            {"Role": "Patient", "Library": "Patient resources", "Input validation": "Unavailable", "Prediction": "Unavailable"},
            {"Role": "Student", "Library": "Student + patient resources", "Input validation": "Practice", "Prediction": "Unavailable"},
            {"Role": "Researcher", "Library": "Research + patient resources", "Input validation": "After approval", "Prediction": "After approval and integration"},
            {"Role": "Doctor", "Library": "Professional + patient resources", "Input validation": "After approval", "Prediction": "After approval and integration"},
        ])
        st.write("Create an account in the sidebar. Doctor and researcher accounts need administrator approval; selecting a role does not grant professional access.")
        st.code("python -m backend.app.manage_users approve <username>", language="powershell")
        st.caption("Run approval from the project directory with its virtual environment active. This local command is for the workspace administrator.")
        st.write("The React interface and this companion share the same API and permissions. There is no model or training pipeline in this project.")
    st.divider()
    st.caption("Breast Cancer Prediction · A local development workspace. Educational content and measurement validation do not provide a diagnosis.")


if __name__ == "__main__":
    main()

