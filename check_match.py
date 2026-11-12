import joblib
import numpy as np
from tensorflow import keras
from backend.app.inference import NumpyMLP

d = "ml_model/model_exports"
net = keras.models.load_model(f"{d}/ann.keras", compile=False)
mlp = NumpyMLP(joblib.load(f"{d}/ann_numpy.joblib"))

X = np.random.randn(50, 30).astype("float32")
diff = np.abs(net(X, training=False).numpy() - mlp.predict(X)).max()
print("Max difference:", diff)