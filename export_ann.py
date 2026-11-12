import joblib
from tensorflow import keras

DIR = "ml_model/model_exports"
model = keras.models.load_model(f"{DIR}/ann.keras", compile=False)

spec = []
for layer in model.layers:
    kind = type(layer).__name__
    if kind == "Dense":
        W, b = layer.get_weights()
        spec.append({"type": "dense", "W": W, "b": b, "act": layer.activation.__name__})
    elif kind == "BatchNormalization":
        gamma, beta, mean, var = layer.get_weights()
        spec.append({"type": "bn", "gamma": gamma, "beta": beta,
                     "mean": mean, "var": var, "eps": float(layer.epsilon)})
    elif kind in ("Dropout", "InputLayer"):
        continue  # no effect when predicting
    else:
        raise ValueError(f"Unsupported layer: {kind}")

joblib.dump(spec, f"{DIR}/ann_numpy.joblib")
print("Saved", len(spec), "layers:", [s["type"] for s in spec])