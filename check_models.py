import joblib
models = joblib.load("ml_model/model_exports/base_models.joblib")
print({k: type(v).__name__ for k, v in models.items()})