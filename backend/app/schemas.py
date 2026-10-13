"""Pydantic HTTP request/response schemas, with no ML implementation."""

from typing import Annotated, Any, Literal

from pydantic import BaseModel, ConfigDict, Field, StrictStr, StringConstraints, field_validator

from .features import FEATURE_ORDER, FeatureGroup

Role = Literal["patient", "student", "researcher", "doctor"]
Username = Annotated[
    str,
    StringConstraints(strict=True, min_length=3, max_length=40, pattern=r"^[A-Za-z0-9_.-]+$"),
]
MeasurementValue = Annotated[float, Field(strict=True, ge=0, allow_inf_nan=False)]


class StrictRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")


class RegistrationRequest(StrictRequest):
    username: Username
    password: Annotated[str, StringConstraints(strict=True, min_length=12, max_length=128)]
    role: Role


class LoginRequest(StrictRequest):
    username: Username
    password: Annotated[str, StringConstraints(strict=True, min_length=1, max_length=128)]


class UserResponse(BaseModel):
    id: int
    username: str
    role: Role
    approved: bool


class RegistrationResponse(BaseModel):
    user: UserResponse
    message: str


class LoginResponse(BaseModel):
    user: UserResponse
    access_token: str


class CurrentUserResponse(BaseModel):
    user: UserResponse


class LogoutResponse(BaseModel):
    message: str


class MeasurementRequest(StrictRequest):
    """Exactly 30 finite, nonnegative measurements and an optional reference."""

    sample_id: Annotated[StrictStr, Field(max_length=80)] | None = Field(
        default=None,
        description="Optional case reference. Avoid patient-identifying information.",
    )
    features: dict[str, MeasurementValue] = Field(
        description="All 30 measurements, keyed by their feature names.",
        json_schema_extra={
            "required": list(FEATURE_ORDER),
            "properties": {name: {"type": "number", "minimum": 0} for name in FEATURE_ORDER},
            "additionalProperties": False,
        },
    )

    @field_validator("features", mode="before")
    @classmethod
    def require_exact_feature_names(cls, value: Any) -> Any:
        if not isinstance(value, dict):
            raise ValueError("Features must be an object containing all 30 measurements.")
        provided = set(value)
        missing = [name for name in FEATURE_ORDER if name not in provided]
        extra = sorted(str(name) for name in provided - set(FEATURE_ORDER))
        if missing or extra:
            issues = []
            if missing:
                issues.append(f"Missing measurements: {', '.join(missing)}")
            if extra:
                issues.append(f"Unknown measurements: {', '.join(extra)}")
            raise ValueError(". ".join(issues))
        return value


class HealthResponse(BaseModel):
    status: Literal["ok"] = "ok"
    service: Literal["Breast Cancer Prediction API"] = "Breast Cancer Prediction API"
    prediction_available: Literal[False] = False


class FeatureGroupDefinition(BaseModel):
    id: FeatureGroup
    label: str
    description: str


class FeatureDefinition(BaseModel):
    name: str
    label: str
    group: FeatureGroup
    description: str
    minimum: Literal[0] = 0
    unit: str | None = None


class FeaturesResponse(BaseModel):
    feature_order: list[str]
    groups: list[FeatureGroupDefinition]
    features: list[FeatureDefinition]
    disclaimer: str


class ValidationResponse(BaseModel):
    status: Literal["valid"] = "valid"
    sample_id: str | None
    feature_count: Literal[30] = 30
    features: dict[str, MeasurementValue]
    feature_order: list[str]


class PredictionUnavailableDetail(BaseModel):
    code: Literal["MODEL_NOT_CONFIGURED"] = "MODEL_NOT_CONFIGURED"
    message: Literal[
        "Prediction is unavailable. Connect your model to enable results."
    ] = "Prediction is unavailable. Connect your model to enable results."


class PredictionUnavailableResponse(BaseModel):
    detail: PredictionUnavailableDetail


class ResourceSource(BaseModel):
    label: str
    url: str


class ResourceResponse(BaseModel):
    id: str
    audience: list[Literal["public", "patient", "student", "researcher", "doctor"]]
    category: str
    title: str
    summary: str
    body: list[str]
    source: ResourceSource
    reading_minutes: int
    tags: list[str]


class LibraryResponse(BaseModel):
    resources: list[ResourceResponse]
