"""Select persistent PostgreSQL storage or the existing local SQLite store."""

from contextlib import contextmanager
import hmac
import os
from pathlib import Path
import secrets
import time
from urllib.parse import parse_qs, urlsplit

from .auth import (
    AuthStore, DEFAULT_SESSION_TTL_SECONDS, InvalidCredentialsError,
    UsernameTakenError, WORKSPACE_ROOT, _hash_password, _token_digest,
    configured_database_path, configured_session_ttl,
)
from .schemas import Role, UserResponse


class DatabaseUnavailableError(RuntimeError):
    """A database operation failed; the public message never contains credentials."""


def load_environment() -> None:
    """Read only this project's .env; hosting environment settings take precedence."""
    env_file = WORKSPACE_ROOT / ".env"
    if env_file.is_file():
        from dotenv import load_dotenv
        load_dotenv(env_file, override=False)


def validate_database_url(value: str) -> str:
    """Accept PostgreSQL URLs; require TLS for remote connections."""
    try:
        parsed = urlsplit(value)
        hostname = parsed.hostname
        port = parsed.port
        options = parse_qs(parsed.query, keep_blank_values=True)
        if (
            parsed.scheme not in {"postgres", "postgresql"}
            or not hostname or not parsed.username
            or parsed.path in {"", "/"} or parsed.fragment
            or (port is not None and port == 0)
            or any(key in options for key in ("host", "hostaddr", "port", "user", "dbname", "service"))
        ):
            raise ValueError
        modes = options.get("sslmode", [])
        if hostname not in {"localhost", "127.0.0.1", "::1"} and (
            len(modes) != 1 or modes[0] not in {"require", "verify-ca", "verify-full"}
        ):
            raise ValueError
    except ValueError:
        raise ValueError(
            "DATABASE_URL must be a PostgreSQL connection URL with a database name. "
            "Remote databases require sslmode=require, verify-ca, or verify-full."
        ) from None
    return value


def _user(row) -> UserResponse:
    return UserResponse(
        id=row["id"], username=row["username"], role=row["role"], approved=row["approved"]
    )


class PostgresAuthStore:
    """Account storage using short-lived connections to Neon's pooled endpoint.

    Construction performs no network requests or DDL. Run manage_database init
    once before serving the app. SQL names are fixed and values are parameterized.
    """

    def __init__(self, database_url: str, session_ttl_seconds: int = DEFAULT_SESSION_TTL_SECONDS):
        self._database_url = validate_database_url(database_url)
        self.session_ttl_seconds = session_ttl_seconds

    @contextmanager
    def connection(self):
        try:
            import psycopg
            from psycopg.rows import dict_row
        except ImportError:
            raise DatabaseUnavailableError(
                "PostgreSQL support requires the dependencies in requirements.txt."
            ) from None
        try:
            # Context exit commits on success, rolls back on error, and closes.
            # Disable automatic prepared statements for pooler compatibility.
            with psycopg.connect(
                self._database_url, row_factory=dict_row, connect_timeout=10,
                prepare_threshold=None,
            ) as database:
                database.execute("SET LOCAL statement_timeout = '15s'")
                database.execute("SET LOCAL lock_timeout = '5s'")
                yield database
        except psycopg.Error:
            raise DatabaseUnavailableError(
                "The account database is unavailable. Check the connection and initialize the schema."
            ) from None

    def initialize_schema(self) -> None:
        schema = (WORKSPACE_ROOT / "backend" / "postgres.sql").read_text(encoding="utf-8-sig")
        with self.connection() as database:
            database.execute(schema, prepare=False)

    def check_schema(self) -> None:
        with self.connection() as database:
            database.execute("SELECT id, username, role, approved FROM breast_cancer.users LIMIT 0")
            database.execute("SELECT token_hash, user_id, expires_at FROM breast_cancer.sessions LIMIT 0")

    def register(self, username: str, password: str, role: Role) -> UserResponse:
        salt = secrets.token_bytes(16)
        password_hash = _hash_password(password, salt)
        with self.connection() as database:
            from psycopg.errors import UniqueViolation
            try:
                row = database.execute(
                    "INSERT INTO breast_cancer.users "
                    "(username, password_hash, password_salt, role, approved, created_at) "
                    "VALUES (%s, %s, %s, %s, %s, %s) "
                    "RETURNING id, username, role, approved",
                    (username, password_hash, salt.hex(), role, role in {"patient", "student"}, int(time.time())),
                ).fetchone()
            except UniqueViolation as error:
                if error.diag.constraint_name == "users_username_lower":
                    raise UsernameTakenError("That username is already registered.") from None
                raise
        return _user(row)

    def login(self, username: str, password: str) -> tuple[UserResponse, str]:
        with self.connection() as database:
            row = database.execute(
                "SELECT * FROM breast_cancer.users WHERE lower(username) = lower(%s)",
                (username,),
            ).fetchone()
        salt = bytes.fromhex(row["password_salt"]) if row else b"\x00" * 16
        supplied_hash = _hash_password(password, salt)
        if row is None or not hmac.compare_digest(supplied_hash, row["password_hash"]):
            raise InvalidCredentialsError("Incorrect username or password.")
        token = secrets.token_urlsafe(32)
        now = int(time.time())
        with self.connection() as database:
            database.execute("DELETE FROM breast_cancer.sessions WHERE expires_at <= %s", (now,))
            database.execute(
                "INSERT INTO breast_cancer.sessions (token_hash, user_id, expires_at) VALUES (%s, %s, %s)",
                (_token_digest(token), row["id"], now + self.session_ttl_seconds),
            )
        return _user(row), token

    def session_user(self, token: str) -> UserResponse | None:
        with self.connection() as database:
            row = database.execute(
                "SELECT users.id, users.username, users.role, users.approved "
                "FROM breast_cancer.users JOIN breast_cancer.sessions ON users.id = sessions.user_id "
                "WHERE sessions.token_hash = %s AND sessions.expires_at > %s",
                (_token_digest(token), int(time.time())),
            ).fetchone()
        return _user(row) if row is not None else None

    def revoke(self, token: str) -> None:
        with self.connection() as database:
            database.execute("DELETE FROM breast_cancer.sessions WHERE token_hash = %s", (_token_digest(token),))

    def approve(self, username: str) -> UserResponse | None:
        with self.connection() as database:
            row = database.execute(
                "UPDATE breast_cancer.users SET approved = TRUE "
                "WHERE lower(username) = lower(%s) RETURNING id, username, role, approved",
                (username,),
            ).fetchone()
        return _user(row) if row is not None else None


AccountStore = AuthStore | PostgresAuthStore


def create_auth_store(database_path: Path | None = None) -> AccountStore:
    # Explicit SQLite paths are used by isolated tests, irrespective of live env.
    ttl = configured_session_ttl()
    if database_path is not None:
        return AuthStore(database_path, ttl)
    database_url = os.environ.get("DATABASE_URL", "").strip()
    if database_url:
        return PostgresAuthStore(database_url, ttl)
    raise ValueError("DATABASE_URL is required. Configure PostgreSQL; SQLite fallback is disabled.")
