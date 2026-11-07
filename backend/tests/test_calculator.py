"""Public calculator contract and parity with the saved notebook ensemble."""
import csv
import json

import pytest
from fastapi.testclient import TestClient

from backend.app.features import FEATURE_ORDER
from backend.app.inference import EXPORT_DIRECTORY
from backend.app.main import create_app


def test_public_calculator_validates_input_and_requires_no_session(tmp_path):
    app = create_app(tmp_path / "auth.sqlite3", model_directory=tmp_path / "missing")
    features = dict.fromkeys(FEATURE_ORDER, 1.0)

    class TestBundle:
        threshold = 0.5

        def predict(self, measurements):
            assert measurements == features
            return "benign", 0.12

    with TestClient(app) as client:
        route = "/api/v1/calculator/predict"
        assert client.post(route, json={"features": features}).status_code == 503
        app.state.model_bundle = TestBundle()
        assert client.get("/api/v1/health").json()["prediction_available"]
        response = client.post(route, json={"features": features})
        assert response.status_code == 200
        assert response.json() == {"status": "completed", "sample_id": None, "prediction": "benign",
                                   "probability": 0.12, "threshold": 0.5}
        assert response.headers["cache-control"] == "no-store"
        assert not client.cookies
        assert client.post("/api/v1/predict", json={"features": features}).status_code == 401
        features.pop("area_mean")
        assert client.post(route, json={"features": features}).status_code == 422


def test_public_api_matches_notebook_inference_on_both_classes(tmp_path):
    pytest.importorskip("tensorflow", reason="Install requirements-model.txt to run saved-model parity.")
    pd = pytest.importorskip("pandas")
    import joblib
    from tensorflow import keras

    metadata = json.loads((EXPORT_DIRECTORY / "metadata.json").read_text())
    with (EXPORT_DIRECTORY.parent / "breast_cancer_data.csv").open(encoding="utf-8-sig", newline="") as file:
        records = list(csv.DictReader(file))
    rows = [next(row for row in records if row["diagnosis"] == label) for label in ("B", "M")]
    columns = metadata["feature_order"]
    frame = pd.DataFrame([[float(row[key]) for key in columns] for row in rows], columns=columns)
    base = joblib.load(EXPORT_DIRECTORY / "base_models.joblib")
    scaler = joblib.load(EXPORT_DIRECTORY / "ann_scaler.joblib")
    network = keras.models.load_model(EXPORT_DIRECTORY / "ann.keras", compile=False)
    meta = joblib.load(EXPORT_DIRECTORY / "lr_meta.joblib")
    probabilities = pd.DataFrame(index=frame.index)
    for name in metadata["model_order"]:
        probabilities[name] = (network(scaler.transform(frame), training=False).numpy().ravel()
                               if name == "ANN" else base[name].predict_proba(frame)[:, 1])
    expected = meta.predict_proba(probabilities)[:, 1]
    with TestClient(create_app(tmp_path / "auth.sqlite3")) as client:
        assert client.get("/api/v1/health").json()["prediction_available"]
        for row, score in zip(rows, expected):
            features = {key.replace(" ", "_"): float(row[key]) for key in reversed(columns)}
            reply = client.post("/api/v1/calculator/predict", json={"features": features})
            assert reply.status_code == 200
            assert reply.json()["probability"] == pytest.approx(score, abs=1e-6)
            assert reply.json()["prediction"] == ("malignant" if score >= metadata["threshold"] else "benign")

def test_adapter_aligns_shuffled_measurements_and_base_probabilities():
    """The API uses underscores, the export includes spaces, and class 1 may be column zero."""
    np = pytest.importorskip("numpy")
    pd = pytest.importorskip("pandas")
    from types import SimpleNamespace
    from backend.app.inference import ModelBundle

    metadata = json.loads((EXPORT_DIRECTORY / "metadata.json").read_text())
    bundle = ModelBundle.__new__(ModelBundle)
    bundle.dataframe = pd.DataFrame
    bundle.columns = metadata["feature_order"]
    bundle.keys = [key.replace(" ", "_") for key in bundle.columns]
    bundle.order = metadata["model_order"]
    bundle.threshold = 0.75
    measurements = {key: float(index + 1) for index, key in enumerate(FEATURE_ORDER)}

    def scale(frame):
        assert list(frame.columns) == bundle.columns
        assert frame.loc[0, "concave points_mean"] == measurements["concave_points_mean"]
        return np.array([[312.0]])

    def network(scaled, training):
        assert not training and scaled[0, 0] == 312.0
        return np.array([[0.7]])

    def base_model(positive):
        return SimpleNamespace(classes_=[1, 0], predict_proba=lambda _: np.array([[positive, 1 - positive]]))

    bundle.scaler = SimpleNamespace(transform=scale)
    bundle.network = network
    bundle.models = {name: base_model((i + 1) / 10) for i, name in reversed(list(enumerate(bundle.order))) if name != "ANN"}

    def combine(frame):
        assert list(frame.columns) == bundle.order
        assert frame.iloc[0].tolist() == pytest.approx([0.1, 0.2, 0.3, 0.4, 0.5, 0.6, 0.7, 0.8, 0.9])
        return np.array([[0.4, 0.6]])

    bundle.meta = SimpleNamespace(classes_=[0, 1], predict_proba=combine)
    assert bundle.predict(dict(reversed(list(measurements.items())))) == ("benign", 0.6)
