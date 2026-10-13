# Breast Cancer Prediction

A breast cancer classification and education platform built with **React**, **FastAPI**, and **Streamlit**, with an **LRMeta Cross-Validation Stacking ensemble** research workflow combining traditional classifiers, an ANN, LightGBM, and CatBoost.

React is the main web interface. Streamlit provides a Python companion, and both use the same FastAPI permissions and measurement contract.

## Reported validation performance

| Stage | Author-reported validation accuracy |
| --- | ---: |
| Before stacking | **97%** |
| After LRMeta cross-validation stacking | **99%** |
| Reported improvement | **2 percentage points** |

These figures refer to validation accuracy, as confirmed by the project author, and represent a 2-percentage-point improvement after stacking. The notebook defines separate validation and test evaluations; this saved copy does not retain executed metric outputs.

## LRMeta ensemble architecture

Research reference: `Breast_Cancer_Prediction_Project_Final_Evaluated_ANN_LightGBM_CatBoost.ipynb`, supplied separately. This version contains the LRMeta stacking implementation, standalone model comparisons, an ANN baseline, and exploratory clustering.

### Base learners

The stacking model contains nine base estimators:

| Base learner | Configuration in the notebook |
| --- | --- |
| Logistic Regression | `max_iter=2000`, seed 42. |
| Random Forest | 250 trees, balanced class weights, seed 42. |
| Support Vector Classifier | RBF kernel, probability output enabled, balanced class weights, seed 42. |
| K-Nearest Neighbors | 7 neighbors. |
| Gradient Boosting | 120 estimators, seed 42. |
| AdaBoost | 120 estimators, seed 42. |
| ANN | Dense 64 ReLU → Dropout 0.25 → Dense 32 ReLU → Dropout 0.15 → Dense 1 sigmoid; hidden dense layers use L2 at `1e-4`. Trains for 30 epochs with batch size 32 and an internal validation fraction of 0.1. |
| LightGBM | 200 estimators, learning rate 0.05, seed 42. |
| CatBoost | 200 iterations, learning rate 0.05, depth 6, seed 42. |

### Logistic Regression meta-learner

`StackingClassifier` combines the base estimators using a Logistic Regression final estimator with `max_iter=2000`, balanced class weights, and seed 42.

| Stacking setting | Value |
| --- | --- |
| Internal cross-validation | `cv=5` |
| Base prediction method | `stack_method="predict_proba"` |
| Original-feature passthrough | `passthrough=False` |
| Parallel jobs | `n_jobs=1` |

Five-fold cross-validation generates out-of-fold base predictions for fitting the meta-learner. During inference, the fitted base estimators produce predictions in the same order, and the fitted Logistic Regression meta-learner combines them. The configured meta-learner receives the base prediction features without the original 30 measurements. See the [scikit-learn stacking documentation](https://scikit-learn.org/stable/modules/generated/sklearn.ensemble.StackingClassifier.html) for the underlying training and prediction behavior.

~~~text
Cell measurements
  → feature alignment and fitted scaling
  → nine fitted base learners
  → base prediction features
  → Logistic Regression meta-learner
  → malignant probability and predicted class
~~~

### Data preparation and evaluation

| Stage | Notebook implementation |
| --- | --- |
| Dataset input | Loads `breast_cancer_data.csv`; drops `id` and `Unnamed: 32`; inspects missing values and duplicate rows. |
| Target encoding | `B = 0` for benign and `M = 1` for malignant; `diagnosis` is excluded from predictors. |
| Data split | Two stratified splits produce approximately 64% training, 16% validation, and 20% test data, with seed 42. |
| Preprocessing | Fits `StandardScaler` on the outer training partition and transforms validation/test inputs with that fitted scaler. |
| Original ANN baseline | Dense 16 ReLU → Dense 8 ReLU → Dense 1 sigmoid; Adam at 0.001, binary cross-entropy, up to 80 epochs, batch size 32. |
| Baseline early stopping | Monitors validation loss with patience 10 and restores the best validation weights. |
| Standalone comparison | Evaluates Logistic Regression, Random Forest, AdaBoost, Gradient Boosting, SVM, ANN, LightGBM, and CatBoost on validation data. |
| Stacking training | Fits the nine-base LRMeta ensemble on the training partition using internal five-fold cross-validation. |
| Validation evaluation | Accuracy, precision, recall, F1, ROC-AUC, and a classification report. |
| Final test evaluation | Baseline ANN and LRMeta metrics, classification reports, and confusion matrices; standalone estimators' test metric table. |
| Positive class and threshold | Malignant is class 1; the test classification rule uses malignant probability `>= 0.5`. |
| Exploratory analysis | K-Means with two clusters, silhouette/ARI/NMI metrics, and a two-component PCA visualization. |

The original Dense 16/8 ANN baseline and the Dense 64/32 ANN used as a stacking base learner are separate implementations.

For strict internal cross-validation isolation, fitted preprocessing should be learned inside each fold. The current notebook fits scaling once on the outer training partition before internal stacking cross-validation; its outer validation and test partitions are excluded from that scaler fit.

### Export contract

The final notebook cell contains export commands for:

- `bcp_model.keras` — original ANN baseline.
- `lr_meta_stacking_model.joblib` — fitted LRMeta ensemble.
- `standalone_ensemble_models.joblib` — fitted standalone comparison estimators.
- `scaler.pkl` — fitted preprocessing scaler.

When packaging inference, preserve the exact training feature names/order, class mapping, threshold, dependency versions, and the custom `KerasANNClassifier` definition alongside the fitted ensemble. The final export cell does not separately persist feature-order metadata.


## Included workflows

- A responsive React interface with patient, student, researcher, and doctor paths.
- Curated educational summaries with links to their primary sources.
- Registration, login, logout, session expiry, and server-enforced permissions.
- Local account storage in SQLite with salted password hashes and opaque sessions.
- Administrator approval for doctor and researcher accounts.
- A 30-field measurement form grouped into mean, standard error, and worst measurements.
- Input validation, clearly labeled synthetic form examples, JSON import/export, and case reset.
- A Streamlit companion with the same account, library, and measurement workflows.
- API tests, React tests, and Streamlit AppTest checks.

Measurement validation confirms input structure and numeric constraints. It does not establish clinical plausibility or provide a diagnosis. Patient-facing content is educational.

## Access rules

| Account | Educational library | Measurement entry and validation | Prediction request |
| --- | --- | --- | --- |
| Visitor | Public and patient resources | Unavailable | Unavailable |
| Patient | Public and patient resources | Unavailable | Unavailable |
| Student | Public/patient and student resources | Available for practice | Unavailable |
| Researcher, awaiting approval | Public and patient resources | Unavailable | Unavailable |
| Doctor, awaiting approval | Public and patient resources | Unavailable | Unavailable |
| Approved researcher | Public/patient and research resources | Available | Role-authorized assessment workflow |
| Approved doctor | Public/patient and professional resources | Available | Role-authorized assessment workflow |

Role selection at signup does not grant professional access. A trusted local administrator must approve doctor and researcher accounts. Permission checks run in FastAPI as well as in the interfaces.

## Start on Windows

Use PowerShell from the project directory. Install Python 3.11 or newer and a Node.js LTS release that supports the frontend dependencies.

~~~powershell
Set-Location C:\Users\Sayak\Documents\ChatGPT\Breast_Cancer_Prediction
python -m venv .venv
.\.venv\Scripts\python.exe -m pip install --cache-dir .cache/pip -r requirements.txt
npm --prefix frontend install
~~~

These commands use the virtual environment's Python directly, so PowerShell script activation is optional.

Start FastAPI in the first terminal:

~~~powershell
.\.venv\Scripts\python.exe -m uvicorn backend.app.main:app --reload --host 127.0.0.1 --port 8000
~~~

Start React in a second terminal, also from the project directory:

~~~powershell
npm --prefix frontend run dev
~~~

Start Streamlit in a third terminal:

~~~powershell
.\.venv\Scripts\python.exe -m streamlit run streamlit_app/app.py --server.address 127.0.0.1 --browser.gatherUsageStats false --theme.base light --theme.primaryColor "#a74d6d"
~~~

Open:

- [React workspace](http://127.0.0.1:5173)
- [Streamlit companion](http://127.0.0.1:8501)
- [FastAPI interactive documentation](http://127.0.0.1:8000/docs)
- [API health](http://127.0.0.1:8000/api/v1/health)

The interfaces can run at the same time and use the same account database. Sign in separately in each: React uses an HTTP-only session cookie; Streamlit holds a bearer token in its own session memory.

Streamlit also includes a theme in streamlit_app/.streamlit/config.toml. Streamlit discovers that configuration when started from the streamlit_app directory:

~~~powershell
Set-Location streamlit_app
..\.venv\Scripts\python.exe -m streamlit run app.py
~~~

The app applies its rose styling when launched from the project root as well.

## Accounts and professional approval

Create an account in either interface. Usernames are 3–40 characters and may contain letters, numbers, underscores, periods, and hyphens. Passwords must contain 12–128 characters. Use a non-identifying username.

Patient and student accounts are active immediately. Doctor and researcher accounts can sign in while awaiting approval, but protected measurement tools stay unavailable.

Approve a registered professional account from a trusted local terminal in the project directory:

~~~powershell
.\.venv\Scripts\python.exe -m backend.app.manage_users approve research_user
~~~

Refresh the interface afterward. There is no default administrator account or public approval endpoint.

## Configuration

| Setting | Default | Purpose |
| --- | --- | --- |
| API_PROXY_TARGET | http://127.0.0.1:8000 | Vite's development proxy target; set before starting React. |
| VITE_API_BASE_URL | Empty / same origin | Direct API origin for a separately hosted React build. |
| API_BASE_URL | http://127.0.0.1:8000 | Streamlit's API root; also editable in its sidebar. |
| AUTH_DB_PATH | backend/data/auth.sqlite3 | Account/session database path; must remain inside this workspace. |
| SESSION_TTL_HOURS | 8 | Session lifetime, from 1 to 8760 hours. |
| SESSION_COOKIE_SECURE | false | Set true when serving React and the API over HTTPS. |
| CORS_ORIGINS | Localhost and 127.0.0.1 on ports 5173 and 5174 | Comma-separated explicit browser origins; an empty setting disables CORS. |

Streamlit accepts localhost, 127.0.0.1, and ::1 API addresses. Use a root URL without an /api/v1 suffix.

For example, to change the local backend port:

~~~powershell
$env:API_PROXY_TARGET = "http://127.0.0.1:8001"
$env:API_BASE_URL = "http://127.0.0.1:8001"
~~~

Start FastAPI with --port 8001 and restart the relevant interface processes. The frontend proxy avoids cross-origin cookie configuration during local development. Check the backend's allowed origins before configuring a separate frontend origin.

## API contract

All routes use the /api/v1 prefix.

| Method and path | Access | Behavior |
| --- | --- | --- |
| GET /health | Public | Service status and inference readiness. |
| GET /features | Public | Ordered feature names, groups, labels, and disclaimer. |
| GET /library | Public or signed in | Resources filtered by the authenticated account's access. |
| POST /auth/register | Public | Register an account; professional roles begin pending. |
| POST /auth/login | Public | Set React's session cookie and return a bearer token. |
| POST /auth/logout | Supplied session cookie/token | Revoke the current session and clear the cookie. |
| GET /auth/me | Signed in | Current account, role, and approval status. |
| POST /validate | Approved student, researcher, or doctor | Validate exactly 30 named numeric measurements. |
| POST /predict | Approved researcher or doctor | Role-protected inference entry point; binding details are below. |

Protected API clients send an Authorization header with Bearer followed by the access token. React sends its session cookie automatically.

Validation/prediction requests contain a features object keyed by all 30 names and an optional sample_id. Every feature must be a finite, nonnegative JSON number. Strings, booleans, missing/extra keys, negative values, NaN, and infinity are rejected. sample_id is optional, nullable, and at most 80 characters. Do not use patient identifiers.

Feature order is group-major: all ten _mean fields, then all ten _se fields, then all ten _worst fields. Within each group:

~~~text
radius, texture, perimeter, area, smoothness,
compactness, concavity, concave_points, symmetry, fractal_dimension
~~~

backend/app/features.py is the shared source for names, order, labels, groups, and descriptions. React reads /features; Streamlit imports the same metadata module. Align the LRMeta inference input with the ensemble's saved feature order. If its input schema differs, update metadata, validation, examples, and tests together.

Successful validation returns status: valid, the submitted sample_id and features, feature_count: 30, and feature_order containing the 30 ordered names.

Unauthenticated requests receive HTTP 401, restricted accounts receive HTTP 403, and invalid inputs receive HTTP 422. The interfaces display structured feedback for authentication, permissions, and input errors.

A PowerShell API session with a synthetic validation payload:

~~~powershell
$account = @{
    username = "student_example"
    password = "choose-a-long-password"
    role = "student"
} | ConvertTo-Json

Invoke-RestMethod -Method Post -Uri http://127.0.0.1:8000/api/v1/auth/register -ContentType "application/json" -Body $account

$credentials = @{
    username = "student_example"
    password = "choose-a-long-password"
} | ConvertTo-Json

$login = Invoke-RestMethod -Method Post -Uri http://127.0.0.1:8000/api/v1/auth/login -ContentType "application/json" -Body $credentials
$headers = @{ Authorization = "Bearer $($login.access_token)" }
Invoke-RestMethod -Uri http://127.0.0.1:8000/api/v1/auth/me -Headers $headers

# Made-up numbers to demonstrate the contract only.
$schema = Invoke-RestMethod -Uri http://127.0.0.1:8000/api/v1/features
$measurements = @{}
foreach ($name in $schema.feature_order) { $measurements[$name] = 1.0 }
$payload = @{ sample_id = "synthetic-example"; features = $measurements } | ConvertTo-Json -Depth 4
Invoke-RestMethod -Method Post -Uri http://127.0.0.1:8000/api/v1/validate -Headers $headers -ContentType "application/json" -Body $payload

Invoke-RestMethod -Method Post -Uri http://127.0.0.1:8000/api/v1/auth/logout -Headers $headers
~~~

Replace the example password before using the commands.

## LRMeta inference integration

The inference adapter belongs in `backend/app/main.py`. Preserve the existing authentication, professional approval, and `MeasurementRequest` checks. For the reviewed notebook, the adapter needs the fitted `lr_meta_stacking_model` and scaler; the original baseline ANN is a separate comparison model.

A deployable stacking bundle needs the fitted preprocessing, fitted base estimators, fitted meta-estimator, expected feature names/order, class mapping, decision threshold, and compatible dependency versions. Preserve the training-time base-learner order and any configuration that passes original features to the meta-learner.

The inference path is:

~~~text
React or Streamlit measurements
  → FastAPI authentication, role checks, and validation
  → feature alignment and fitted preprocessing
  → fitted base-learner predictions
  → fitted meta-learner input and prediction
  → class/probability mapping
  → structured API response
~~~

The reviewed notebook encodes malignant as class 1. Confirm the deployed ensemble's saved class metadata before serving its probability output. Define `probability` consistently in the API and interface—for example, the estimated probability of malignancy—and select that class's probability from the ensemble output. Use `null` if the deployed estimator does not provide the agreed probability.

The React client expects:

| Field | Successful response |
| --- | --- |
| `status` | `"completed"` |
| `prediction` | `"benign"` or `"malignant"` |
| `probability` | A finite number from 0 to 1, or `null` |
| `sample_id` | The submitted reference, or `null` |

**API binding status:** the web application's `/predict` route currently returns HTTP 503 with `MODEL_NOT_CONFIGURED`. Connecting the research implementation requires replacing that handler, adding the successful response schema/status, and updating health readiness to reflect a loaded inference bundle. Streamlit already accepts a successful response as JSON; its result presentation can be aligned with the final contract.

Verify parity between direct ensemble inference and API inference using the same cases. Check feature order, preprocessing, base-prediction column order, class mapping, decision threshold, loading failures, response serialization, and role restrictions. Keep ensemble evaluation separate from web application tests, and publish only results recorded by the evaluated implementation.

## Project layout

~~~text
Breast_Cancer_Prediction/
├── backend/
│   ├── app/
│   │   ├── main.py               # API routes and access checks
│   │   ├── auth.py               # Account/session persistence
│   │   ├── manage_users.py       # Trusted local approval command
│   │   ├── features.py           # Shared measurement metadata
│   │   ├── schemas.py            # Request/response validation
│   │   └── library.json          # Educational content and source links
│   ├── data/                    # Runtime account database, ignored by Git
│   └── tests/
├── frontend/                    # React, TypeScript, and Vite
│   ├── src/
│   └── package.json
├── streamlit_app/
│   ├── app.py                   # Python companion interface
│   ├── .streamlit/config.toml
│   └── tests/test_app.py
├── requirements.txt
├── requirements-dev.txt
└── README.md
~~~

## Checks

Install test dependencies:

~~~powershell
.\.venv\Scripts\python.exe -m pip install --cache-dir .cache/pip -r requirements-dev.txt
~~~

Run Python tests from the project root:

~~~powershell
.\.venv\Scripts\python.exe -m pytest backend/tests streamlit_app/tests
~~~

Run frontend checks:

~~~powershell
npm --prefix frontend test
npm --prefix frontend run build
~~~

Streamlit tests mock HTTP calls to check public/patient/pending restrictions, student validation, authorized unavailable predictions, import handling, export/reset, revoked approval, expired sessions during requests, navigation, and local sign-out while the API is offline. These commands require the runtime and test dependencies to be installed first.

## Local data and deployment

The API stores account records and session hashes in SQLite. Passwords are salted and hashed using PBKDF2; raw session tokens are not stored in the database. React uses an HTTP-only cookie, and Streamlit keeps its bearer token in session memory. Signing out revokes the active session.

Measurement submissions are processed in memory and are not persisted by this application. Streamlit clears case data on sign-out, detected session expiry, a change of API address, or a change of account/role that removes access. Protected tools are hidden while access cannot be verified, and local sign-out remains available during an API outage. Cases otherwise remain in interface session memory until cleared or the session ends. An explicit JSON download writes a file only where you choose to save it.

The application runs on local loopback addresses. Before making it available publicly, configure HTTPS, secure cookies, trusted frontend origins, production process supervision, account administration, and the requirements of your intended clinical or research environment. Model performance should be reported from the evaluated research implementation; clinical use requires validation appropriate to the intended setting.

