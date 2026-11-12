"""Role-restricted education and measurement API, with saved ensemble inference."""

import threading
import json
import logging
from contextlib import asynccontextmanager
import os
from pathlib import Path
from urllib.parse import urlsplit

from fastapi import Depends, FastAPI, HTTPException, Request, Response, UploadFile, status
from fastapi.exceptions import RequestValidationError
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse

from .auth import (
    InvalidCredentialsError,
    SESSION_COOKIE_NAME,
    UsernameTakenError,
    configured_secure_cookie,
)
from .database import AccountStore, DatabaseUnavailableError, create_auth_store, load_environment
from .features import DISCLAIMER, FEATURE_DEFINITIONS, FEATURE_ORDER, GROUPS
from .inference import EXPORT_DIRECTORY, ModelBundle
from .dataset_tools import analyze, explain, read_dataset
from .model_guide import model_guide
from .schemas import (
    PredictionResponse,
    CurrentUserResponse,
    FeaturesResponse,
    HealthResponse,
    LibraryResponse,
    LoginRequest,
    LoginResponse,
    LogoutResponse,
    MeasurementRequest,
    PredictionUnavailableDetail,
    PredictionUnavailableResponse,
    RegistrationRequest,
    RegistrationResponse,
    ResourceResponse,
    UserResponse,
    ValidationResponse,
)

DEFAULT_CORS_ORIGINS = (
    "http://localhost:5173",
    "http://127.0.0.1:5173",
    "http://localhost:5174",
    "http://127.0.0.1:5174",
)


def configured_cors_origins() -> list[str]:
    """Read an explicit comma-separated allowlist; an empty setting disables CORS."""
    configured = os.environ.get("CORS_ORIGINS")
    if configured is None:
        return list(DEFAULT_CORS_ORIGINS)
    origins = list(dict.fromkeys(item.strip() for item in configured.split(",") if item.strip()))
    for origin in origins:
        parsed = urlsplit(origin)
        if (
            parsed.scheme not in {"http", "https"}
            or not parsed.netloc
            or parsed.path
            or parsed.query
            or parsed.fragment
            or parsed.username is not None
            or "*" in origin
        ):
            raise ValueError("CORS_ORIGINS must contain explicit HTTP(S) origins without paths.")
    return origins


def auth_store(request: Request) -> AccountStore:
    return request.app.state.auth_store


def bearer_token(request: Request) -> str | None:
    header = request.headers.get("Authorization")
    if header is None:
        return None
    parts = header.split()
    if len(parts) != 2 or parts[0].lower() != "bearer":
        raise HTTPException(
            status_code=401,
            detail={"code": "AUTH_REQUIRED", "message": "Use a valid Bearer session token."},
            headers={"WWW-Authenticate": "Bearer"},
        )
    return parts[1]


def optional_user(request: Request) -> UserResponse | None:
    token = bearer_token(request) or request.cookies.get(SESSION_COOKIE_NAME)
    if token is None:
        return None
    user = auth_store(request).session_user(token)
    if user is None:
        raise HTTPException(
            status_code=401,
            detail={"code": "SESSION_INVALID", "message": "Your session has expired. Sign in again."},
            headers={"WWW-Authenticate": "Bearer"},
        )
    return user


def current_user(user: UserResponse | None = Depends(optional_user)) -> UserResponse:
    if user is None:
        raise HTTPException(
            status_code=401,
            detail={"code": "AUTH_REQUIRED", "message": "Sign in to access this workspace."},
            headers={"WWW-Authenticate": "Bearer"},
        )
    return user


def measurement_user(user: UserResponse = Depends(current_user)) -> UserResponse:
    if not user.approved:
        raise HTTPException(
            status_code=403,
            detail={
                "code": "APPROVAL_REQUIRED",
                "message": "Your professional account is awaiting local administrator approval.",
            },
        )
    if user.role not in {"student", "researcher", "doctor"}:
        raise HTTPException(
            status_code=403,
            detail={"code": "ROLE_NOT_ALLOWED", "message": "Your role does not allow measurement review."},
        )
    return user


def prediction_user(user: UserResponse = Depends(measurement_user)) -> UserResponse:
    if user.role not in {"researcher", "doctor"}:
        raise HTTPException(
            status_code=403,
            detail={
                "code": "ROLE_NOT_ALLOWED",
                "message": "Prediction access is reserved for approved researcher and doctor accounts.",
            },
        )
    return user


def model_reader(user: UserResponse = Depends(current_user)) -> UserResponse:
    if user.role not in {"student", "researcher"}:
        raise HTTPException(status_code=403, detail={"code": "ROLE_NOT_ALLOWED", "message": "The model walkthrough is for students and researchers only."})
    if not user.approved:
        raise HTTPException(status_code=403, detail={"code": "APPROVAL_REQUIRED", "message": "Your researcher account is awaiting administrator approval."})
    return user


def create_app(database_path: Path | None = None, *, model_directory: Path = EXPORT_DIRECTORY) -> FastAPI:
    """Build the app; an explicit database path supports isolated local tests."""
    if database_path is None:
        load_environment()
    origins = configured_cors_origins()
    secure_cookie = configured_secure_cookie()
    @asynccontextmanager
    async def lifespan(app: FastAPI):
        yield

    application = FastAPI(
        lifespan=lifespan,
        title="Breast Cancer Prediction API",
        version="0.1.0",
        description=(
            "Role-restricted educational resources and validated measurement intake. "
            "Local researcher and doctor accounts require administrator approval. "
            "A public calculator estimates malignancy for a measured breast mass."
        ),
    )
    application.state.model_bundle = None
    application.state.model_lock = threading.Lock()
    application.state.model_failed = False

    def get_model_bundle(app: FastAPI):
        """Load the model on first use so startup (and registration) stay light."""
        if app.state.model_bundle is None and not app.state.model_failed:
            with app.state.model_lock:
                if app.state.model_bundle is None and not app.state.model_failed:
                    try:
                        app.state.model_bundle = ModelBundle(model_directory)
                    except Exception as error:
                        logging.getLogger(__name__).warning("Prediction bundle unavailable: %s", error)
                        app.state.model_failed = True
        return app.state.model_bundle
    application.state.auth_store = create_auth_store(database_path)
    application.state.library = [
        ResourceResponse.model_validate(resource)
        for resource in json.loads(Path(__file__).with_name("library.json").read_text(encoding="utf-8-sig"))
    ]
    application.add_middleware(
        CORSMiddleware,
        allow_origins=origins,
        allow_credentials=True,
        allow_methods=["GET", "POST"],
        allow_headers=["Content-Type", "Authorization"],
    )

    @application.middleware("http")
    async def request_boundaries(request: Request, call_next):
        # Explicit browser origins protect cookie-authenticated state changes.
        # Native/server clients such as Streamlit send no Origin header.
        origin = request.headers.get("Origin")
        same_origin = str(request.base_url).rstrip("/")
        if request.method == "POST" and origin and origin not in origins and origin != same_origin:
            return JSONResponse(
                status_code=403,
                content={"detail": {"code": "ORIGIN_NOT_ALLOWED", "message": "This browser origin is not allowed."}},
            )
        response = await call_next(request)
        if request.url.path.startswith("/api/v1/auth") or request.url.path in {"/api/v1/library", "/api/v1/predict", "/api/v1/calculator/predict", "/api/v1/model-guide", "/api/v1/dataset/analyze", "/api/v1/dataset/shap"}:
            response.headers["Cache-Control"] = "no-store"
        return response

    @application.exception_handler(DatabaseUnavailableError)
    async def database_unavailable(_request: Request, _error: DatabaseUnavailableError) -> JSONResponse:
        return JSONResponse(status_code=503, content={"detail": {
            "code": "DATABASE_UNAVAILABLE",
            "message": "Account services are temporarily unavailable. Please try again later.",
        }})

    @application.exception_handler(RequestValidationError)
    async def validation_error_response(_request: Request, error: RequestValidationError) -> JSONResponse:
        # Do not reflect passwords, sample identifiers, or non-JSON NaN/Infinity inputs.
        details = [
            {"type": issue["type"], "loc": list(issue["loc"]), "msg": issue["msg"]}
            for issue in error.errors()
        ]
        return JSONResponse(status_code=422, content={"detail": details})

    @application.get("/api/v1/health", response_model=HealthResponse, tags=["Workspace"])
    async def health() -> HealthResponse:
          return HealthResponse(prediction_available=application.state.model_bundle is not None or model_directory.exists())

    @application.get("/api/v1/features", response_model=FeaturesResponse, tags=["Measurements"])
    async def features() -> FeaturesResponse:
        return FeaturesResponse(
            feature_order=list(FEATURE_ORDER),
            groups=list(GROUPS),
            features=list(FEATURE_DEFINITIONS),
            disclaimer=DISCLAIMER,
        )

    @application.get("/api/v1/model-guide", tags=["Education"])
    def read_model_guide(_user: UserResponse = Depends(model_reader)) -> dict:
        return model_guide(model_directory)

    @application.post(
        "/api/v1/auth/register",
        status_code=status.HTTP_201_CREATED,
        response_model=RegistrationResponse,
        tags=["Accounts"],
    )
    def register(credentials: RegistrationRequest, store: AccountStore = Depends(auth_store)) -> RegistrationResponse:
        try:
            user = store.register(credentials.username, credentials.password, credentials.role)
        except UsernameTakenError as error:
            raise HTTPException(status_code=409, detail=str(error)) from error
        return RegistrationResponse(
            user=user,
            message=(
                "Your account is ready. Sign in to continue."
                if user.approved else "Your professional account is pending local administrator approval."
            ),
        )

    @application.post("/api/v1/auth/login", response_model=LoginResponse, tags=["Accounts"])
    def login(
        credentials: LoginRequest, response: Response, store: AccountStore = Depends(auth_store)
    ) -> LoginResponse:
        try:
            user, token = store.login(credentials.username, credentials.password)
        except InvalidCredentialsError as error:
            raise HTTPException(
                status_code=401, detail=str(error), headers={"WWW-Authenticate": "Bearer"}
            ) from error
        response.set_cookie(
            key=SESSION_COOKIE_NAME,
            value=token,
            max_age=store.session_ttl_seconds,
            path="/api/v1",
            secure=secure_cookie,
            httponly=True,
            samesite="none" if secure_cookie else "lax",
        )
        return LoginResponse(user=user, access_token=token)

    @application.get("/api/v1/auth/me", response_model=CurrentUserResponse, tags=["Accounts"])
    def me(user: UserResponse = Depends(current_user)) -> CurrentUserResponse:
        return CurrentUserResponse(user=user)

    @application.post("/api/v1/auth/logout", response_model=LogoutResponse, tags=["Accounts"])
    def logout(request: Request, response: Response, store: AccountStore = Depends(auth_store)) -> LogoutResponse:
        tokens = {bearer_token(request), request.cookies.get(SESSION_COOKIE_NAME)} - {None}
        for token in tokens:
            store.revoke(token)
        response.delete_cookie(
            key=SESSION_COOKIE_NAME,
            path="/api/v1",
            secure=secure_cookie,
            httponly=True,
            samesite="none" if secure_cookie else "lax",
        )
        return LogoutResponse(message="Signed out.")

    @application.get("/api/v1/library", response_model=LibraryResponse, tags=["Education"])
    def library(
        request: Request, user: UserResponse | None = Depends(optional_user)
    ) -> LibraryResponse:
        role = user.role if user and user.approved else "patient"
        return LibraryResponse(
            resources=[
                resource for resource in request.app.state.library
                if "public" in resource.audience or role in resource.audience
            ]
        )

    @application.post("/api/v1/validate", response_model=ValidationResponse, tags=["Measurements"])
    def validate_measurements(
        sample: MeasurementRequest, _user: UserResponse = Depends(measurement_user)
    ) -> ValidationResponse:
        return ValidationResponse(
            sample_id=sample.sample_id, features=sample.features, feature_order=list(FEATURE_ORDER)
        )

    @application.post(
        "/api/v1/predict", response_model=PredictionResponse, tags=["Prediction"],
        dependencies=[Depends(prediction_user)], responses={503: {"model": PredictionUnavailableResponse}},
    )
    @application.post(
        "/api/v1/calculator/predict", response_model=PredictionResponse, tags=["Prediction"],
        summary="Calculate a specimen score without signing in",
        responses={503: {"model": PredictionUnavailableResponse}},
    )
    def predict(sample: MeasurementRequest, request: Request) -> PredictionResponse:
        bundle = get_model_bundle(request.app)
        if bundle is None:
            raise HTTPException(status_code=503, detail=PredictionUnavailableDetail().model_dump())
        try:
            prediction, probability = bundle.predict(sample.features)
        except (ValueError, OverflowError, FloatingPointError) as error:
            raise HTTPException(status_code=422, detail="Check the measurement values and units. The model could not score this input.") from error
        except Exception as error:
            logging.getLogger(__name__).exception("Prediction failed")
            raise HTTPException(status_code=503, detail=PredictionUnavailableDetail().model_dump()) from error
        return PredictionResponse(
            sample_id=sample.sample_id, prediction=prediction, probability=probability, threshold=bundle.threshold
        )

    def dataset_bundle(request: Request):
        bundle = request.app.state.model_bundle
        if bundle is None:
            raise HTTPException(status_code=503, detail=PredictionUnavailableDetail().model_dump())
        return bundle

    @application.post("/api/v1/dataset/analyze", tags=["Model workspace"])
    async def analyze_dataset(file: UploadFile, request: Request, _user: UserResponse = Depends(model_reader)) -> dict:
        frame, warnings, labels = await read_dataset(file)
        return {"rows": len(frame), "warnings": warnings + (["No diagnosis column found; predictions are available but evaluation metrics are omitted."] if labels is None else []), "models": analyze(dataset_bundle(request), frame, labels)}

    @application.post("/api/v1/dataset/shap", tags=["Model workspace"])
    async def explain_dataset(file: UploadFile, request: Request, _user: UserResponse = Depends(model_reader)) -> dict:
        frame, warnings, _labels = await read_dataset(file)
        contributions = explain(dataset_bundle(request), frame.head(100))
        return {"rows": len(frame), "warnings": warnings + ["SHAP uses up to the first 100 rows and the saved tree learners. Each value is mean absolute feature contribution, averaged across available tree models."], "models": [{"name": item["feature"], "accuracy": item["value"], "auc": None} for item in contributions]}

    return application


app = create_app()
