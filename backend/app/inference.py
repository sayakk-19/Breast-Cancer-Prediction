"""Inference with the trusted, project-owned export from the simplified notebook."""

import json
import math
from pathlib import Path

from .features import FEATURE_ORDER

import numpy as np
from scipy.special import expit  # installed with scikit-learn

EXPORT_DIRECTORY = Path(__file__).resolve().parents[2] / "ml_model" / "model_exports"

_ACTIVATIONS = {
    "relu": lambda x: np.maximum(x, 0),
    "sigmoid": expit,
    "tanh": np.tanh,
    "linear": lambda x: x,
    "softmax": lambda x: (lambda e: e / e.sum(axis=1, keepdims=True))(
        np.exp(x - x.max(axis=1, keepdims=True))
    ),
}


class NumpyMLP:
    """Runs the exported Keras network with NumPy only (no TensorFlow)."""

    def __init__(self, spec):
        self.spec = spec

    def predict(self, X):
        x = np.asarray(X, dtype=np.float32)
        for layer in self.spec:
            if layer["type"] == "dense":
                x = _ACTIVATIONS[layer["act"]](x @ layer["W"] + layer["b"])
            else:  # batch normalization
                x = (x - layer["mean"]) / np.sqrt(layer["var"] + layer["eps"])
                x = x * layer["gamma"] + layer["beta"]
        return x

    # Lets the existing code call self.network(scaled, training=False) unchanged.
    def __call__(self, X, training=False):
        return self.predict(X)

class ModelBundle:
    def __init__(self, directory: Path):
        # Keep the education and account endpoints available without ML dependencies.
        metadata = json.loads((directory / "metadata.json").read_text(encoding="utf-8-sig"))
        import joblib
        import pandas as pd

        self.dataframe = pd.DataFrame
        self.columns = metadata["feature_order"]
        self.keys = [column.replace(" ", "_") for column in self.columns]
        if len(self.keys) != len(FEATURE_ORDER) or set(self.keys) != set(FEATURE_ORDER):
            raise ValueError("Exported measurements differ from the API schema.")
        if metadata["class_mapping"] != {"benign": 0, "malignant": 1}:
            raise ValueError("Unsupported export class mapping.")
        self.threshold = float(metadata["threshold"])
        if not 0 < self.threshold < 1:
            raise ValueError("Invalid classification threshold.")

        self.models = joblib.load(directory / "base_models.joblib")
        self.scaler = joblib.load(directory / "ann_scaler.joblib")
        self.network = NumpyMLP(joblib.load(directory / "ann_numpy.joblib"))
        self.meta = joblib.load(directory / "lr_meta.joblib")
        self.order = metadata["model_order"]
        if (len(self.order) != 9 or len(set(self.order)) != 9
                or set(self.order) != set(self.models) | {"ANN"}
                or self.meta.n_features_in_ != len(self.order)):
            raise ValueError("Incomplete or incompatible stacking ensemble.")
        if list(getattr(self.meta, "feature_names_in_", self.order)) != self.order:
            raise ValueError("Exported model order differs from the meta-classifier.")
        if list(getattr(self.scaler, "feature_names_in_", self.columns)) != self.columns:
            raise ValueError("Exported feature order differs from the fitted scaler.")

    @staticmethod
    def malignant_probability(estimator, frame):
        class_index = list(estimator.classes_).index(1)
        return float(estimator.predict_proba(frame)[0, class_index])

    def predict(self, features: dict[str, float]) -> tuple[str, float]:
        row = self.dataframe([[features[key] for key in self.keys]], columns=self.columns)
        probabilities = []
        for name in self.order:
            if name == "ANN":
                scaled = self.scaler.transform(row)
                probability = float(self.network(scaled, training=False)[0, 0])
            else:
                probability = self.malignant_probability(self.models[name], row)
            if not math.isfinite(probability) or not 0 <= probability <= 1:
                raise ValueError("A base model could not score these measurements.")
            probabilities.append(probability)
        meta_input = self.dataframe([probabilities], columns=self.order)
        score = self.malignant_probability(self.meta, meta_input)
        if not math.isfinite(score) or not 0 <= score <= 1:
            raise ValueError("The ensemble could not score these measurements.")
        return ("malignant" if score >= self.threshold else "benign"), score

