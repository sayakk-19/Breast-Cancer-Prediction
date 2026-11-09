"""Protected learning content, grounded in the project's simplified notebook."""

import json
import math
from pathlib import Path


def model_guide(directory: Path) -> dict:
    metrics = None
    try:
        metadata = json.loads((directory / "metadata.json").read_text(encoding="utf-8-sig"))
        names = ("Accuracy", "Precision", "Recall", "F1", "ROC-AUC")
        metrics = {split: {name: float(metadata[f"{split}_metrics"][name]) for name in names}
                   for split in ("validation", "test")}
        if not all(math.isfinite(v) and 0 <= v <= 1 for split in metrics.values() for v in split.values()):
            metrics = None
    except (OSError, ValueError, KeyError, TypeError):
        metrics = None
    return {
        "title": "From measurements to a model",
        "subtitle": "Follow the nine-model LRMeta ensemble, from the dataset to the prediction you see on screen.",
        "provenance": "Workflow: Breast_Cancer_Prediction_Simple.ipynb. Scores: ml_model/model_exports/metadata.json. These are recorded export results, not a new evaluation or clinical validation.",
        "dataset": {"total": 569, "features": 30, "benign": 357, "malignant": 212,
                    "splits": [{"name": "Training", "count": 364}, {"name": "Validation", "count": 91}, {"name": "Test", "count": 114}]},
        "steps": [
            {"title": "Understand & clean the data", "tag": "01 / DATA", "visual": "cells",
             "summary": "The Wisconsin Diagnostic Breast Cancer dataset describes measured cell nuclei, not symptoms or lifestyle.",
             "details": ["Drop id and the empty Unnamed: 32 column. Encode benign as 0 and malignant as 1; keep diagnosis out of the predictors.", "Use 10 characteristics, each described by mean, standard error and worst values: 30 numeric inputs in total.", "Check the 569 × 30 feature matrix for non-finite values and duplicates before modelling." ]},
            {"title": "Keep evaluation data separate", "tag": "02 / SPLIT", "visual": "split",
             "summary": "Two stratified splits preserve the diagnosis balance while holding back validation and test records.",
             "details": ["Use random_state=42. First hold out 20% for testing, then 20% of the remainder for validation.", "This produces 364 training, 91 validation and 114 test records. Fit the ensemble using the training partition.", "The notebook also contains an earlier 16 → 8 baseline ANN. The exported ensemble uses the separate 32 → 16 ANN described below."]},
            {"title": "Learn without seeing the holdout", "tag": "03 / CROSS-VALIDATION", "visual": "folds",
             "summary": "Five-fold stratified cross-validation creates out-of-fold probabilities for the meta-model.",
             "details": ["For each fold, train fresh base learners on four folds and predict the fifth. Repeat until every training record has nine held-out probabilities.", "Fit StandardScaler inside the Logistic Regression, SVM and KNN pipelines for each fold; tree-based models use raw features.", "For the ANN, reserve 15% of the current fitting data as an internal stopping set. Fit its scaler on the remaining ANN fitting data only. Outer validation and test data stay out of this process."]},
            {"title": "Combine nine different learners", "tag": "04 / ENSEMBLE", "visual": "ensemble",
             "summary": "A Logistic Regression meta-model learns from the nine probability columns, rather than from a simple vote.",
             "details": ["Fit the meta-model (max_iter=2000, seed=42) on the out-of-fold table: 364 rows × 9 model probabilities.", "Refit the base training routine on the full training partition, retaining the ANN's internal stopping split. Preserve the same model-column order for inference.", "The ANN is 30 → 32 ReLU → dropout 0.2 → 16 ReLU → dropout 0.1 → 1 sigmoid, with L2=0.0001, Adam and binary cross-entropy. Train up to 80 epochs, batch size 32; stop after 10 unimproved validation-loss epochs and restore the best weights."]},
            {"title": "Evaluate & investigate", "tag": "05 / RESULTS", "visual": "results",
             "summary": "Compare validation and held-out test performance, then inspect behaviour beyond a single accuracy number.",
             "details": ["Record accuracy, precision, recall, F1 and ROC-AUC. The test confusion matrix and ROC curve are produced by the notebook; the scores below come from the saved export.", "The notebook also explores two K-Means clusters with training-fitted scaling and PCA plots. These are exploratory analyses, not the deployed classifier.", "A separate validation experiment adds noise at 0%, 1% and 3% of training-feature standard deviations and counts changed predictions. No numerical robustness results were saved in the export, so none are claimed here.", "Training performance is in-sample. High held-out accuracy on this dataset does not establish performance on other populations or a calibrated personal cancer risk."]},
            {"title": "Export & serve the prediction", "tag": "06 / APPLICATION", "visual": "serve",
             "summary": "React collects the measurements; FastAPI validates them and applies the saved ensemble.",
             "details": ["Save base_models.joblib, ann_scaler.joblib, ann.keras, lr_meta.joblib and metadata.json together in ml_model/model_exports.", "The API aligns all 30 input names with the saved feature order, applies each fitted preprocessing step and produces nine base probabilities.", "The meta-model returns the malignant-class probability. The saved 0.5 threshold determines the benign/malignant label; it is not the model's accuracy.", "The public calculator requires no login. Accounts and role permissions use PostgreSQL when DATABASE_URL is set, otherwise local SQLite. Measurement submissions are processed in memory, not saved as patient records."]}
        ],
        "models": [
            {"name": "Logistic Regression", "detail": "Scaled inputs · max_iter 2000"},
            {"name": "Random Forest", "detail": "200 trees · minimum leaf size 2"},
            {"name": "SVM", "detail": "Scaled inputs · RBF kernel · probabilities enabled"},
            {"name": "KNN", "detail": "Scaled inputs · 7 neighbours"},
            {"name": "Gradient Boosting", "detail": "120 estimators · learning rate 0.05 · depth 2"},
            {"name": "AdaBoost", "detail": "120 estimators · learning rate 0.05"},
            {"name": "ANN", "detail": "32 → 16 hidden units · separate fitted scaler"},
            {"name": "LightGBM", "detail": "150 estimators · 15 leaves · learning rate 0.05"},
            {"name": "CatBoost", "detail": "150 iterations · depth 4 · learning rate 0.05"}
        ],
        "metrics": metrics,
        "sources": [{"label": "UCI dataset", "url": "https://archive.ics.uci.edu/dataset/17/breast+cancer+wisconsin+diagnostic"},
                    {"label": "scikit-learn: stacking", "url": "https://scikit-learn.org/stable/modules/ensemble.html#stacking"}]
    }
