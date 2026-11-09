"""CSV validation, batch model comparison and SHAP-style explanations."""
from io import BytesIO
import math
from typing import Any
from fastapi import HTTPException, UploadFile
from .features import FEATURE_ORDER

MAX_BYTES = 5 * 1024 * 1024
LABELS = {"diagnosis", "label", "target"}

async def read_dataset(file: UploadFile) -> tuple[Any, list[str], Any | None]:
    if not file.filename or not file.filename.lower().endswith(".csv"):
        raise HTTPException(422, detail={"message": "Upload a CSV file."})
    raw = await file.read(MAX_BYTES + 1)
    if len(raw) > MAX_BYTES: raise HTTPException(413, detail={"message": "The CSV is larger than 5 MB."})
    try:
        import pandas as pd
        frame = pd.read_csv(BytesIO(raw))
    except Exception as error:
        raise HTTPException(422, detail={"message": "The CSV could not be read. Use a comma-separated file with one header row."}) from error
    normalized = {str(column).strip().lower().replace(" ", "_"): column for column in frame.columns}
    missing = [feature for feature in FEATURE_ORDER if feature not in normalized]
    if missing:
        raise HTTPException(422, detail={"message": "The dataset needs feature engineering before scoring.", "missing_features": missing, "guidance": "Provide all 30 training measurements with the exact names shown above. Do not fill missing columns with guessed values."})
    selected = frame[[normalized[feature] for feature in FEATURE_ORDER]].copy()
    selected.columns = list(FEATURE_ORDER)
    numeric = selected.apply(pd.to_numeric, errors="coerce")
    bad = numeric.columns[numeric.isna().any()].tolist()
    if bad: raise HTTPException(422, detail={"message": "Some required features are non-numeric or missing.", "invalid_features": bad, "guidance": "Convert these columns to finite, non-negative numbers in the same units used during model training."})
    if (numeric < 0).any().any(): raise HTTPException(422, detail={"message": "The model requires non-negative measurements.", "guidance": "Review units and negative values before uploading."})
    label = next((normalized[name] for name in LABELS if name in normalized), None)
    return numeric, ["Feature names and values match the model schema."], frame[label] if label else None

def metric(value, labels):
    if labels is None: return None, None
    import numpy as np
    from sklearn.metrics import accuracy_score, roc_auc_score
    encoded = labels.astype(str).str.strip().str.upper().map({"M": 1, "MALIGNANT": 1, "1": 1, "B": 0, "BENIGN": 0, "0": 0})
    if encoded.isna().any() or encoded.nunique() < 2: return None, None
    return float(accuracy_score(encoded, value >= .5)), float(roc_auc_score(encoded, value))

def analyze(bundle, frame, labels):
    models = []
    for name in bundle.order:
        if name == "ANN":
            probability = bundle.network(bundle.scaler.transform(frame), training=False).numpy().reshape(-1)
        else:
            estimator = bundle.models[name]; index = list(estimator.classes_).index(1); probability = estimator.predict_proba(frame)[:, index]
        accuracy, auc = metric(probability, labels); models.append({"name": name, "accuracy": accuracy, "auc": auc})
    return models

def explain(bundle, frame):
    """Mean absolute SHAP values from saved tree learners, averaged by feature."""
    import numpy as np
    import shap
    values = []
    for name in ("Random Forest", "Gradient Boosting", "LightGBM", "CatBoost"):
        model = bundle.models.get(name)
        if model is None:
            continue
        estimator = model.steps[-1][1] if hasattr(model, "steps") else model
        try:
            result = shap.TreeExplainer(estimator).shap_values(frame)
            if isinstance(result, list):
                result = result[1]
            values.append(np.abs(np.asarray(result)).reshape(len(frame), -1).mean(axis=0))
        except Exception:
            continue
    if not values:
        raise HTTPException(503, detail={"message": "SHAP could not explain the saved tree models. Check the model environment."})
    averaged = np.mean(np.vstack(values), axis=0)
    return [{"feature": feature, "value": float(value)} for feature, value in sorted(zip(frame.columns, averaged), key=lambda item: item[1], reverse=True)]
