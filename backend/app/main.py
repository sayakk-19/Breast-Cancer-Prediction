"""Role-restricted education and measurement API, with prediction unconfigured."""

import json
import os
from pathlib import Path
from urllib.parse import urlsplit

from fastapi import Depends, FastAPI, HTTPException, Request, Response, status
from fastapi.exceptions import RequestValidationError
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse

from .auth import (
    AuthStore,
    InvalidCredentialsError,
    SESSION_COOKIE_NAME,
    UsernameTakenError,
    configured_database_path,
    configured_secure_cookie,
    configured_session_ttl,
)
from .features import DISCLAIMER, FEATURE_DEFINITIONS, FEATURE_ORDER, GROUPS
from .schemas import (
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


def auth_store(request: Request) -> AuthStore:
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


def create_app(database_path: Path | None = None) -> FastAPI:
    """Build the app; an explicit database path supports isolated local tests."""
    origins = configured_cors_origins()
    secure_cookie = configured_secure_cookie()
    application = FastAPI(
        title="Breast Cancer Prediction API",
        version="0.1.0",
        description=(
            "Role-restricted educational resources and validated measurement intake. "
            "Local researcher and doctor accounts require administrator approval. "
            "Prediction is unavailable until you integrate your own model."
        ),
    )
    application.state.auth_store = AuthStore(
        database_path if database_path is not None else configured_database_path(),
        configured_session_ttl(),
    )
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
        if request.url.path.startswith("/api/v1/auth") or request.url.path == "/api/v1/library":
            response.headers["Cache-Control"] = "no-store"
        return response

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
        return HealthResponse()

    @application.get("/api/v1/features", response_model=FeaturesResponse, tags=["Measurements"])
    async def features() -> FeaturesResponse:
        return FeaturesResponse(
            feature_order=list(FEATURE_ORDER),
            groups=list(GROUPS),
            features=list(FEATURE_DEFINITIONS),
            disclaimer=DISCLAIMER,
        )

    @application.post(
        "/api/v1/auth/register",
        status_code=status.HTTP_201_CREATED,
        response_model=RegistrationResponse,
        tags=["Accounts"],
    )
    def register(credentials: RegistrationRequest, store: AuthStore = Depends(auth_store)) -> RegistrationResponse:
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
        credentials: LoginRequest, response: Response, store: AuthStore = Depends(auth_store)
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
            samesite="lax",
        )
        return LoginResponse(user=user, access_token=token)

    @application.get("/api/v1/auth/me", response_model=CurrentUserResponse, tags=["Accounts"])
    def me(user: UserResponse = Depends(current_user)) -> CurrentUserResponse:
        return CurrentUserResponse(user=user)

    @application.post("/api/v1/auth/logout", response_model=LogoutResponse, tags=["Accounts"])
    def logout(request: Request, response: Response, store: AuthStore = Depends(auth_store)) -> LogoutResponse:
        tokens = {bearer_token(request), request.cookies.get(SESSION_COOKIE_NAME)} - {None}
        for token in tokens:
            store.revoke(token)
        response.delete_cookie(
            key=SESSION_COOKIE_NAME,
            path="/api/v1",
            secure=secure_cookie,
            httponly=True,
            samesite="lax",
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
        "/api/v1/predict",
        tags=["Prediction"],
        status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
        response_model=PredictionUnavailableResponse,
        summary="Prediction unavailable until integration",
        description=(
            "Approved researchers and doctors can submit validated measurements. "
            "This endpoint then returns MODEL_NOT_CONFIGURED. No predictions or "
            "probabilities are generated."
        ),
    )
    def predict(
        _sample: MeasurementRequest, _user: UserResponse = Depends(prediction_user)
    ) -> PredictionUnavailableResponse:
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail=PredictionUnavailableDetail().model_dump(),
        )

    return application


app = create_app()
