# Breast Cancer Prediction

A local web application built with **React**, **FastAPI**, and **Streamlit**. Breast Cancer Prediction combines a role-based educational library, account access, and a structured measurement workspace. React is the primary interface; Streamlit is a Python companion that uses the same API and permissions.

**No machine learning model, training code, model artifacts, or dataset is included.** The prediction endpoint intentionally returns an unavailable response until you integrate your own implementation. The app never invents a diagnosis or confidence score.

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
| Approved researcher | Public/patient and research resources | Available | Available; currently HTTP 503 |
| Approved doctor | Public/patient and professional resources | Available | Available; currently HTTP 503 |

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
| GET /health | Public | Service status and prediction_available: false. |
| GET /features | Public | Ordered feature names, groups, labels, and disclaimer. |
| GET /library | Public or signed in | Resources filtered by the authenticated account's access. |
| POST /auth/register | Public | Register an account; professional roles begin pending. |
| POST /auth/login | Public | Set React's session cookie and return a bearer token. |
| POST /auth/logout | Supplied session cookie/token | Revoke the current session and clear the cookie. |
| GET /auth/me | Signed in | Current account, role, and approval status. |
| POST /validate | Approved student, researcher, or doctor | Validate exactly 30 named numeric measurements. |
| POST /predict | Approved researcher or doctor | Validate input and return intentional HTTP 503. |

Protected API clients send an Authorization header with Bearer followed by the access token. React sends its session cookie automatically.

Validation/prediction requests contain a features object keyed by all 30 names and an optional sample_id. Every feature must be a finite, nonnegative JSON number. Strings, booleans, missing/extra keys, negative values, NaN, and infinity are rejected. sample_id is optional, nullable, and at most 80 characters. Do not use patient identifiers.

Feature order is group-major: all ten _mean fields, then all ten _se fields, then all ten _worst fields. Within each group:

~~~text
radius, texture, perimeter, area, smoothness,
compactness, concavity, concave_points, symmetry, fractal_dimension
~~~

backend/app/features.py is the shared source for names, order, labels, groups, and descriptions. React reads /features; Streamlit imports the same metadata module. If your eventual implementation needs a different input schema, update that contract, validation, synthetic examples, and tests together.

Successful validation returns status: valid, the submitted sample_id and features, feature_count: 30, and feature_order containing the 30 ordered names.

Authorized prediction requests return **HTTP 503**:

~~~json
{
  "detail": {
    "code": "MODEL_NOT_CONFIGURED",
    "message": "Prediction is unavailable. Connect your model to enable results."
  }
}
~~~

Unauthenticated requests receive HTTP 401, restricted accounts receive HTTP 403, and invalid inputs receive HTTP 422. The interfaces display these states and never turn them into example predictions.

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

## Integrate predictions later

The integration point is the predict route in backend/app/main.py. Keep its authentication, professional approval, and measurement validation. Replace the intentional unavailable response with your implementation when ready. Use FEATURE_ORDER to assemble inputs in the order your implementation expects.

The React client's future successful response contract has status: completed, prediction: benign or malignant, probability: a number or null, and sample_id: a string or null. The current backend never returns that result. Define the meaning and calibration of any probability before displaying it. Streamlit displays a real successful API response as JSON; update that presentation when the response contract is finalized.

Update the predict route's response model and HTTP status declaration for successful results, along with its unavailable behavior. Update the health response and its schema so prediction_available becomes true only when the prediction service is actually ready. Current HealthResponse deliberately fixes this flag to false. Add checks for preprocessing, feature order, response meaning, and error handling when integrating your implementation.

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

Streamlit tests mock HTTP calls to check public/patient/pending restrictions, student validation, authorized unavailable predictions, import handling, export/reset, revoked approval, expired sessions during requests, navigation, and local sign-out while the API is offline. They do not include or invoke a model. These commands require the runtime and test dependencies to be installed first.

## Local data and deployment

The API stores account records and session hashes in SQLite. Passwords are salted and hashed using PBKDF2; raw session tokens are not stored in the database. React uses an HTTP-only cookie, and Streamlit keeps its bearer token in session memory. Signing out revokes the active session.

Measurement submissions are processed in memory and are not persisted by this application. Streamlit clears case data on sign-out, detected session expiry, a change of API address, or a change of account/role that removes access. Protected tools are hidden while access cannot be verified, and local sign-out remains available during an API outage. Cases otherwise remain in interface session memory until cleared or the session ends. An explicit JSON download writes a file only where you choose to save it.

This scaffold runs on local loopback addresses. Before making it available publicly, configure HTTPS, secure cookies, trusted frontend origins, production process supervision, account administration, and the requirements of your intended clinical or research environment. No medical deployment or performance claim is made by this starter.

