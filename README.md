# Breast Cancer Prediction

A breast cancer classification and education platform built with **React**, **FastAPI**, and **Streamlit**, with an **LRMeta Cross-Validation Stacking ensemble** research workflow combining traditional classifiers, an ANN, LightGBM, and CatBoost.

React is the main web interface. Streamlit provides a Python companion, and both use the same FastAPI permissions and measurement contract.

## Saved ensemble metrics

The supplied export records 97.80% validation accuracy and 99.12% test accuracy. These figures are from separate dataset partitions. They are distinct from the probability calculated for an individual specimen. The web application uses the simplified notebook's five-file export described in the inference section below.

## Earlier research notebook

The following architecture and training settings describe the earlier `Breast_Cancer_Prediction_Project_Final_Evaluated_ANN_LightGBM_CatBoost.ipynb` reference.

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

Open **Prediction calculator** in the main navigation or visit `/#prediction`. Visitors can enter all 30 measurements and request a specimen estimate without an account.

- A responsive React interface with a forest-green and ivory landing page, four role paths, and role-specific signed-in workspaces.
- Curated educational summaries with links to their primary sources. Three public articles are bundled with the frontend so basic reading works while the backend is unavailable; protected resources still come from the authenticated API.
- Dedicated account dialogs with password visibility, password confirmation at registration, and professional approval guidance.
- A site footer with useful resources, privacy information, and configurable social icons. Social icons remain inactive until profile URLs are supplied.
- Registration, login, logout, session expiry, and server-enforced permissions.
- PostgreSQL account/session storage through Neon, with SQLite retained for local development. Passwords are salted and hashed; sessions use opaque tokens.
- Administrator approval for doctor and researcher accounts.
- A 30-field measurement form grouped into mean, standard error, and worst measurements.
- Input validation, clearly labeled synthetic form examples, JSON import/export, and case reset.
- A Streamlit companion with the same account, library, and measurement workflows.
- API tests, React tests, and Streamlit AppTest checks.

Measurement validation confirms input structure and numeric constraints. It does not establish clinical plausibility or provide a diagnosis. Patient-facing content is educational.

## Access rules

The table describes the signed-in assessment workspace. The separate public calculator is open to every visitor.

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

Use PowerShell from the project directory. Install Python 3.11 or newer (use Python 3.12 for the supplied ensemble) and a Node.js LTS release that supports the frontend dependencies.

~~~powershell
python -m venv .venv
.\.venv\Scripts\python.exe -m pip install --cache-dir .cache/pip -r requirements-model.txt
npm --prefix frontend install
~~~

These commands use the virtual environment's Python directly, so PowerShell script activation is optional.

If you already created `.venv`, keep it and skip the creation command. After updating dependencies, follow the PostgreSQL setup below before starting the API with `DATABASE_URL` set.

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
.\.venv\Scripts\python.exe -m streamlit run streamlit_app/app.py --server.address 127.0.0.1 --browser.gatherUsageStats false --theme.base light --theme.primaryColor "#173f35"
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

The app applies its forest-green and ivory styling when launched from the project root as well.

The public frontend is [cellscope-nu.vercel.app](https://cellscope-nu.vercel.app/). Local source changes become visible there only after a new frontend deployment. Account registration, sign-in, and protected tools require a reachable FastAPI backend; the public reading collection works independently. The backend has not yet been deployed.

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
| VITE_GITHUB_URL, VITE_LINKEDIN_URL, VITE_INSTAGRAM_URL, VITE_X_URL | Empty | Optional HTTPS social profile links. Blank values leave the footer icons inactive. Rebuild the frontend after changing these values. |
| API_BASE_URL | http://127.0.0.1:8000 | Streamlit's API root; also editable in its sidebar. |
| DATABASE_URL | Empty | PostgreSQL connection URL. Set this to use Neon; it is a backend-only secret. |
| AUTH_DB_PATH | backend/data/auth.sqlite3 | SQLite fallback when DATABASE_URL is empty; must remain inside this workspace. |
| SESSION_TTL_HOURS | 8 | Session lifetime, from 1 to 8760 hours. |
| SESSION_COOKIE_SECURE | false | Set true when serving React and the API over HTTPS. |
| CORS_ORIGINS | Localhost and 127.0.0.1 on ports 5173 and 5174 | Comma-separated explicit browser origins; an empty setting disables CORS. |

Streamlit accepts localhost, 127.0.0.1, and ::1 API addresses. Use a root URL without an /api/v1 suffix.

FastAPI and both administration commands load `.env` from the project root. Environment variables already set by the terminal or hosting platform take precedence.

## PostgreSQL on Neon

The backend supports PostgreSQL through Psycopg 3. The database is hosted by Neon; React and FastAPI can be hosted separately on Vercel. React and Streamlit communicate with FastAPI, and only FastAPI connects to the account database.

### Create the hosted database

1. Open the [Neon console](https://console.neon.tech/) and sign in.
2. Create or select the project for this application. Use a region close to the eventual FastAPI deployment and stay on the Free plan if you want a free deployment.
3. In the project's database controls, create a PostgreSQL database named `breast_cancer_insight`. Keep unrelated existing databases intact.
4. Open **Connect**, select that database, and enable **Connection pooling**. Copy its PostgreSQL connection string privately. Keep the TLS parameters Neon supplies.

See [Neon's database management documentation](https://neon.com/docs/manage/databases) and [connection guide](https://neon.com/docs/connect/connect-from-any-app). Creating a local SQL file does not provision a hosted database; that must be completed in the Neon account.

### Configure and initialize

Create a `.env` file in the project root using `.env.example` as the template. Set its `DATABASE_URL` to the real Neon connection string. Do not place this URL in frontend variables, commit it, or paste it into public messages.

Illustrative format (replace all placeholders):

~~~dotenv
DATABASE_URL=postgresql://ROLE:PASSWORD@HOST-pooler.REGION.aws.neon.tech/breast_cancer_insight?sslmode=require&channel_binding=require
~~~

After installing the updated `requirements.txt` into your existing virtual environment, run from the project root:

~~~powershell
.\.venv\Scripts\python.exe -m backend.app.manage_database init
.\.venv\Scripts\python.exe -m backend.app.manage_database check
~~~

`init` applies `backend/postgres.sql` to the existing database inside one transaction and checks the tables. Repeating it preserves existing records. `check` verifies connectivity and table access without creating tables. Neither command creates a Neon project or changes a database password.

The `breast_cancer` schema contains:

| Table | Stored information |
| --- | --- |
| `users` | Username, salted password hash, salt, role, approval status, and creation time. A unique lowercase-username index prevents case-only duplicates. |
| `sessions` | SHA-256 session-token hash, account reference, and expiry. Foreign keys link sessions to their accounts. |

Run FastAPI normally after initialization. Registration, sign-in, sign-out, session expiry, and `manage_users approve` all use the selected PostgreSQL database. The adapter uses parameterized SQL, short-lived connections, connection/query timeouts, and generic public database-error messages. App import does not connect to PostgreSQL or create tables.

With `DATABASE_URL` empty, the original SQLite store remains available. Existing SQLite accounts are not automatically copied to PostgreSQL. This setup creates a separate account store and leaves SQLite files intact.

### Hosting configuration

Set `DATABASE_URL` in the **backend's** hosting environment. Set `SESSION_COOKIE_SECURE=true` for HTTPS and `CORS_ORIGINS` to the exact frontend origin. Prefer serving frontend and `/api/v1` routes on the same public origin to match the app's cookie configuration. Vercel routing/deployment must be configured separately; database support alone does not deploy the application.

### Database checks

These configuration checks do not need a live PostgreSQL database:

~~~powershell
.\.venv\Scripts\python.exe -B -m unittest discover -s backend/tests -p test_database.py -v
~~~

PostgreSQL integration checks in the same file run only when `TEST_DATABASE_URL` points to a dedicated test database. They cover role approval, case-insensitive accounts, password/session hashing, login failures, revocation, and expiry. Test changes roll back; use a separate test database because tests still acquire locks. Without that setting they are reported as skipped, not passed.

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
| POST /calculator/predict | Public | Calculate a malignancy estimate for 30 specimen measurements. |
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

## Serving the exported ensemble

With Python 3.12, install `requirements-model.txt` in the backend environment. Keep `metadata.json`, `base_models.joblib`, `ann_scaler.joblib`, `ann.keras`, and `lr_meta.joblib` together under `ml_model/model_exports/`. FastAPI loads these trusted project files once at startup. Restart the backend after installing the dependencies or replacing the export.

The public React calculator sends the 30 measurements to `POST /api/v1/calculator/predict`. It works without a session cookie or bearer token. The existing professional workspace uses the authenticated `/api/v1/predict` route. Both use the same validator and fitted ensemble. Inputs are processed in memory.

The adapter matches API field names to the saved column names and applies the preprocessing already fitted for each model. It combines eight classifier probabilities and the scaled ANN output in the exported order. The Logistic Regression meta-model produces the malignant-class probability. The response includes the probability, predicted class, saved threshold, and optional case reference. The estimate applies to a measured specimen.

Check `GET /api/v1/health` for `prediction_available`. If the runtime or export cannot load, account and reading features remain available and the calculator displays a service message. For a hosted frontend, point `VITE_API_BASE_URL` at the deployed FastAPI server and include the frontend origin in `CORS_ORIGINS`.

## Project layout

~~~text
Breast-Cancer-Prediction/
├── backend/
│   ├── app/
│   │   ├── main.py               # API routes and access checks
│   │   ├── auth.py               # Account/session persistence
│   │   ├── database.py           # PostgreSQL adapter and storage selection
│   │   ├── manage_database.py    # PostgreSQL initialization/check commands
│   │   ├── manage_users.py       # Trusted local approval command
│   │   ├── features.py           # Shared measurement metadata
│   │   ├── schemas.py            # Request/response validation
│   │   └── library.json          # Educational content and source links
│   ├── data/                    # Runtime account database, ignored by Git
│   ├── postgres.sql             # PostgreSQL account/session schema
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

The API stores account records and session hashes in PostgreSQL when `DATABASE_URL` is set, or SQLite for local development otherwise. Passwords are salted and hashed using PBKDF2; raw session tokens are not stored in the database. React uses an HTTP-only cookie, and Streamlit keeps its bearer token in session memory. Signing out revokes the active session.

Measurement submissions are processed in memory and are not persisted by this application. Streamlit clears case data on sign-out, detected session expiry, a change of API address, or a change of account/role that removes access. Protected tools are hidden while access cannot be verified, and local sign-out remains available during an API outage. Cases otherwise remain in interface session memory until cleared or the session ends. An explicit JSON download writes a file only where you choose to save it.

The application runs on local loopback addresses. Before making it available publicly, configure HTTPS, secure cookies, trusted frontend origins, production process supervision, account administration, and the requirements of your intended clinical or research environment. Model performance should be reported from the evaluated research implementation; clinical use requires validation appropriate to the intended setting.

