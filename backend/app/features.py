"""Shared input metadata. No trained model or dataset is included."""

from typing import Literal

FeatureGroup = Literal["mean", "se", "worst"]

BASE_FEATURES: tuple[tuple[str, str], ...] = (
    ("radius", "Radius"),
    ("texture", "Texture"),
    ("perimeter", "Perimeter"),
    ("area", "Area"),
    ("smoothness", "Smoothness"),
    ("compactness", "Compactness"),
    ("concavity", "Concavity"),
    ("concave_points", "Concave points"),
    ("symmetry", "Symmetry"),
    ("fractal_dimension", "Fractal dimension"),
)

GROUPS = (
    {
        "id": "mean",
        "label": "Mean measurements",
        "description": "Enter the mean value for each measurement.",
    },
    {
        "id": "se",
        "label": "Standard error",
        "description": "Enter the standard error for each measurement.",
    },
    {
        "id": "worst",
        "label": "Worst measurements",
        "description": "Enter the worst value for each measurement from your source.",
    },
)

FEATURE_ORDER: tuple[str, ...] = tuple(
    f"{name}_{group['id']}" for group in GROUPS for name, _ in BASE_FEATURES
)

FEATURE_DEFINITIONS = tuple(
    {
        "name": f"{name}_{group['id']}",
        "label": label,
        "group": group["id"],
        "description": f"{label} measurement: {group['label'].lower()}.",
        "minimum": 0,
        "unit": None,
    }
    for group in GROUPS
    for name, label in BASE_FEATURES
)

DISCLAIMER = (
    "For education and development use. This workspace does not provide a medical "
    "diagnosis. Prediction is unavailable until a model is connected and evaluated."
)
