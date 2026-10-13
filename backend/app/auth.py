"""Local account and opaque session storage using only the Python standard library."""

from contextlib import contextmanager
import hashlib
import hmac
import os
from pathlib import Path
import secrets
import sqlite3
import time
from typing import Iterator

from .schemas import Role, UserResponse

WORKSPACE_ROOT = Path(__file__).resolve().parents[2]
SESSION_COOKIE_NAME = "breast_cancer_session"
PASSWORD_ITERATIONS = 600_000
DEFAULT_SESSION_TTL_SECONDS = 8 * 60 * 60


class UsernameTakenError(Exception):
    """A registration attempted to reuse an existing account name."""


class InvalidCredentialsError(Exception):
    """Credentials did not identify a valid account."""


def configured_database_path() -> Path:
    """Keep environment-selected runtime databases inside this workspace."""
    configured = os.environ.get("AUTH_DB_PATH", "backend/data/auth.sqlite3")
    selected = Path(configured)
    if not selected.is_absolute():
        selected = WORKSPACE_ROOT / selected
    selected = selected.resolve()
    if not selected.is_relative_to(WORKSPACE_ROOT):
        raise ValueError("AUTH_DB_PATH must point inside the project workspace.")
    if selected == WORKSPACE_ROOT or selected.is_dir():
        raise ValueError("AUTH_DB_PATH must name a database file inside the project workspace.")
    return selected


def configured_session_ttl() -> int:
    try:
        hours = int(os.environ.get("SESSION_TTL_HOURS", "8"))
    except ValueError as error:
        raise ValueError("SESSION_TTL_HOURS must be a positive integer.") from error
    if hours <= 0 or hours > 8760:
        raise ValueError("SESSION_TTL_HOURS must be between 1 and 8760.")
    return hours * 3600


def configured_secure_cookie() -> bool:
    value = os.environ.get("SESSION_COOKIE_SECURE", "false").strip().lower()
    if value not in {"true", "false"}:
        raise ValueError("SESSION_COOKIE_SECURE must be true or false.")
    return value == "true"


def _hash_password(password: str, salt: bytes) -> str:
    return hashlib.pbkdf2_hmac(
        "sha256", password.encode("utf-8"), salt, PASSWORD_ITERATIONS
    ).hex()


def _token_digest(token: str) -> str:
    return hashlib.sha256(token.encode("utf-8")).hexdigest()


def _user_from_row(row: sqlite3.Row) -> UserResponse:
    return UserResponse(
        id=row["id"], username=row["username"], role=row["role"], approved=bool(row["approved"])
    )


class AuthStore:
    """A database-per-workspace store; explicit paths also support isolated tests."""

    def __init__(
        self, database_path: Path, session_ttl_seconds: int = DEFAULT_SESSION_TTL_SECONDS
    ) -> None:
        self.database_path = Path(database_path).resolve()
        if not self.database_path.is_relative_to(WORKSPACE_ROOT):
            raise ValueError("The account database must stay inside the project workspace.")
        if self.database_path == WORKSPACE_ROOT or self.database_path.is_dir():
            raise ValueError("The account database must name a file inside the project workspace.")
        self.session_ttl_seconds = session_ttl_seconds
        self.database_path.parent.mkdir(parents=True, exist_ok=True)
        with self.connection() as database:
            database.executescript(
                """
                CREATE TABLE IF NOT EXISTS users (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    username TEXT NOT NULL COLLATE NOCASE UNIQUE,
                    password_hash TEXT NOT NULL,
                    password_salt TEXT NOT NULL,
                    role TEXT NOT NULL CHECK(role IN ('patient','student','researcher','doctor')),
                    approved INTEGER NOT NULL CHECK(approved IN (0, 1)),
                    created_at INTEGER NOT NULL
                );
                CREATE TABLE IF NOT EXISTS sessions (
                    token_hash TEXT PRIMARY KEY,
                    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
                    expires_at INTEGER NOT NULL
                );
                CREATE INDEX IF NOT EXISTS sessions_expiry ON sessions(expires_at);
                """
            )

    @contextmanager
    def connection(self) -> Iterator[sqlite3.Connection]:
        database = sqlite3.connect(self.database_path, timeout=10)
        database.row_factory = sqlite3.Row
        database.execute("PRAGMA foreign_keys = ON")
        try:
            with database:
                yield database
        finally:
            database.close()

    def register(self, username: str, password: str, role: Role) -> UserResponse:
        salt = secrets.token_bytes(16)
        password_hash = _hash_password(password, salt)
        approved = role in {"patient", "student"}
        with self.connection() as database:
            try:
                cursor = database.execute(
                    "INSERT INTO users(username,password_hash,password_salt,role,approved,created_at) "
                    "VALUES (?,?,?,?,?,?)",
                    (username, password_hash, salt.hex(), role, int(approved), int(time.time())),
                )
            except sqlite3.IntegrityError as error:
                raise UsernameTakenError("That username is already registered.") from error
            row = database.execute("SELECT * FROM users WHERE id = ?", (cursor.lastrowid,)).fetchone()
        return _user_from_row(row)

    def login(self, username: str, password: str) -> tuple[UserResponse, str]:
        with self.connection() as database:
            row = database.execute("SELECT * FROM users WHERE username = ?", (username,)).fetchone()
        # Missing accounts still incur the password derivation cost.
        salt = bytes.fromhex(row["password_salt"]) if row else b"\x00" * 16
        supplied_hash = _hash_password(password, salt)
        if row is None or not hmac.compare_digest(supplied_hash, row["password_hash"]):
            raise InvalidCredentialsError("Incorrect username or password.")

        token = secrets.token_urlsafe(32)
        now = int(time.time())
        with self.connection() as database:
            database.execute("DELETE FROM sessions WHERE expires_at <= ?", (now,))
            database.execute(
                "INSERT INTO sessions(token_hash,user_id,expires_at) VALUES (?,?,?)",
                (_token_digest(token), row["id"], now + self.session_ttl_seconds),
            )
        return _user_from_row(row), token

    def session_user(self, token: str) -> UserResponse | None:
        with self.connection() as database:
            row = database.execute(
                "SELECT users.* FROM sessions JOIN users ON users.id = sessions.user_id "
                "WHERE sessions.token_hash = ? AND sessions.expires_at > ?",
                (_token_digest(token), int(time.time())),
            ).fetchone()
        return _user_from_row(row) if row is not None else None

    def revoke(self, token: str) -> None:
        with self.connection() as database:
            database.execute("DELETE FROM sessions WHERE token_hash = ?", (_token_digest(token),))

    def approve(self, username: str) -> UserResponse | None:
        """Trusted local administration only; there is no HTTP approval endpoint."""
        with self.connection() as database:
            database.execute("UPDATE users SET approved = 1 WHERE username = ?", (username,))
            row = database.execute("SELECT * FROM users WHERE username = ?", (username,)).fetchone()
        return _user_from_row(row) if row is not None else None
