"""CSV validation, batch model comparison and SHAP-style explanations."""
from io import BytesIO
import math
from typing import Any
from fastapi import HTTPException, UploadFile
from .features import FEATURE_ORDER

MAX_BYTES = 5 * 1024 * 1024
LABELS = ("diagnosis", "label", "target")

async def read_dataset(file: UploadFile) -> tuple[Any, list[str], Any | None]:
    if not file.filename or not file.filename.lower().endswith(".csv"):
        raise HTTPException(422, detail={"message": "Upload a CSV file."})
    raw = await file.read(MAX_BYTES + 1)
    if len(raw) > MAX_BYTES: raise HTTPException(413, detail={"message": "The CSV is larger than 5 MB."})
    try:
        import pandas as pd
        frame = pd.read_csv(BytesIO(raw), nrows=2001)
    except Exception as error:
        raise HTTPException(422, detail={"message": "The CSV could not be read. Use a comma-separated file with one header row."}) from error
    normalized = {str(column).strip().lower().replace(" ", "_"): column for column in frame.columns}
    if frame.empty:
        raise HTTPException(422, detail={"message": "The CSV contains no data rows."})
    if len(frame) > 2000:
        raise HTTPException(422, detail={"message": "Upload at most 2,000 data rows per analysis (excluding the header)."})
    missing = [feature for feature in FEATURE_ORDER if feature not in normalized]
    if missing:
        raise HTTPException(422, detail={"message": "The dataset needs feature engineering before scoring.", "missing_features": missing, "guidance": "Provide all 30 training measurements with the exact names shown above. Do not fill missing columns with guessed values."})
    selected = frame[[normalized[feature] for feature in FEATURE_ORDER]].copy()
    selected.columns = list(FEATURE_ORDER)
    numeric = selected.apply(pd.to_numeric, errors="coerce")
    import numpy as np
    bad = numeric.columns[(~np.isfinite(numeric)).any()].tolist()
    if bad: raise HTTPException(422, detail={"message": "Some required features are non-numeric or missing.", "invalid_features": bad, "guidance": "Convert these columns to finite, non-negative numbers in the same units used during model training."})
    if (numeric < 0).any().any(): raise HTTPException(422, detail={"message": "The model requires non-negative measurements.", "guidance": "Review units and negative values before uploading."})
    label = next((normalized[name] for name in LABELS if name in normalized), None)
    if label is not None:
        encoded = frame[label].astype(str).str.strip().str.upper().map({'M': 1, 'MALIGNANT': 1, '1': 1, '1.0': 1, 'B': 0, 'BENIGN': 0, '0': 0, '0.0': 0})
        if encoded.isna().any():
            raise HTTPException(422, detail={'message': 'Diagnosis labels must be B/M, benign/malignant, or 0/1 (1 = malignant). Fix missing or invalid labels, or remove the label column for scoring only.'})
        frame[label] = encoded.astype(int)
    return numeric, ["Breast-mass measurement schema validated. Clinical origin and units cannot be verified automatically. Metrics apply only to this uploaded dataset and do not establish clinical performance."], frame[label] if label else None

def metric(value, labels):
    if labels is None: return None, None
    import numpy as np
    from sklearn.metrics import accuracy_score, roc_auc_score
    encoded = labels.astype(str).str.strip().str.upper().map({"M": 1, "MALIGNANT": 1, "1": 1, "B": 0, "BENIGN": 0, "0": 0})
    if encoded.isna().any(): return None, None
    return float(accuracy_score(encoded, value >= .5)), float(roc_auc_score(encoded, value)) if encoded.nunique() > 1 else None

def detailed_metrics(value, labels):
    if labels is None: return {}
    from sklearn.metrics import precision_score, recall_score, f1_score, confusion_matrix
    y = labels.astype(str).str.strip().str.upper().map({'M': 1, 'MALIGNANT': 1, '1': 1, 'B': 0, 'BENIGN': 0, '0': 0})
    if y.isna().any(): return {}
    predicted = value >= .5
    tn, fp, fn, tp = confusion_matrix(y, predicted, labels=[0, 1]).ravel()
    return {'precision': float(precision_score(y, predicted, zero_division=0)), 'recall': float(recall_score(y, predicted, zero_division=0)), 'f1': float(f1_score(y, predicted, zero_division=0)), 'specificity': float(tn / (tn + fp)) if tn + fp else None, 'false_negatives': int(fn), 'false_positives': int(fp)}

def analyze(bundle, frame, labels):
    import numpy as np
    frame = frame.loc[:, bundle.keys].copy()
    frame.columns = bundle.columns
    models = []
    probabilities = []
    for name in bundle.order:
        if name == "ANN":
            probability = np.asarray(bundle.network(bundle.scaler.transform(frame), training=False)).reshape(-1)
        else:
            estimator = bundle.models[name]; index = list(estimator.classes_).index(1); probability = estimator.predict_proba(frame)[:, index]
        if not np.isfinite(probability).all():
            raise HTTPException(422, detail={"message": "The models could not score these measurements. Check units and values."})
        probabilities.append(probability)
        accuracy, auc = metric(probability, labels)
        models.append({"name": name, "accuracy": accuracy, "auc": auc, "mean_probability": float(np.mean(probability)), **detailed_metrics(probability, labels)})
    meta_frame = bundle.dataframe(np.column_stack(probabilities), columns=bundle.order)
    ensemble = bundle.meta.predict_proba(meta_frame)[:, list(bundle.meta.classes_).index(1)]
    accuracy, auc = metric(ensemble, labels)
    models.append({"name": "Stacked ensemble", "accuracy": accuracy, "auc": auc, "mean_probability": float(np.mean(ensemble)), **detailed_metrics(ensemble, labels)})
    return models

def explain(bundle, frame):
    """Average normalized absolute SHAP importance, avoiding mixed raw units."""
    import numpy as np
    import shap
    frame = frame.loc[:, bundle.keys].copy()
    frame.columns = bundle.columns
    values = []
    for name in ("Random Forest", "Gradient Boosting", "LightGBM", "CatBoost"):
        model = bundle.models.get(name)
        if model is None:
            continue
        estimator = model.steps[-1][1] if hasattr(model, "steps") else model
        try:
            result = shap.TreeExplainer(estimator).shap_values(frame)
            if isinstance(result, list):
                result = result[list(estimator.classes_).index(1)]
            result = np.asarray(result)
            if result.ndim == 3:
                result = result[:, :, list(estimator.classes_).index(1)]
            if result.shape != frame.shape or not np.isfinite(result).all():
                raise ValueError('Unexpected SHAP output shape or non-finite values.')
            importance = np.abs(result).mean(axis=0)
            # Raw SHAP units differ between tree families; average relative importance.
            values.append(importance / importance.sum() if importance.sum() else importance)
        except Exception:
            continue
    if not values:
        raise HTTPException(503, detail={"message": "SHAP could not explain the saved tree models. Check the model environment."})
    averaged = np.mean(np.vstack(values), axis=0)
    return [{"feature": feature, "value": float(value)} for feature, value in sorted(zip(frame.columns, averaged), key=lambda item: item[1], reverse=True)]
