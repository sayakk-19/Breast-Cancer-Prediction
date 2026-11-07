"""Database selection checks and opt-in PostgreSQL account lifecycle checks.

Run with the Python standard-library test runner. Live tests need psycopg and an
explicit TEST_DATABASE_URL for a dedicated test database. Their changes roll back.
"""

from contextlib import contextmanager
import hashlib
import os
from pathlib import Path
import unittest
from unittest.mock import patch
import uuid

from backend.app.auth import InvalidCredentialsError, UsernameTakenError
from backend.app.database import PostgresAuthStore, create_auth_store, validate_database_url


class DatabaseConfigurationTests(unittest.TestCase):
    def test_remote_database_requires_explicit_tls(self):
        for suffix in ("", "?sslmode=disable", "?sslmode=prefer", "?sslmode=require&sslmode=disable"):
            with self.subTest(suffix=suffix), self.assertRaises(ValueError):
                validate_database_url("postgresql://app:private-password@db.example/app" + suffix)
        for mode in ("require", "verify-ca", "verify-full"):
            url = "postgresql://app:private-password@db.example/app?sslmode=" + mode
            self.assertEqual(validate_database_url(url), url)

    def test_local_postgres_can_use_plain_connection(self):
        for host in ("localhost", "127.0.0.1", "[::1]"):
            url = f"postgresql://app:password@{host}:5432/app"
            self.assertEqual(validate_database_url(url), url)

    def test_ambiguous_or_malformed_destinations_are_rejected(self):
        for url in (
            "sqlite:///local.db", "postgresql://app:secret@db.example/",
            "postgresql://app:secret@db.example:wrong/app?sslmode=require",
            "postgresql://app:secret@db.example:0/app?sslmode=require",
            "postgresql://app:secret@localhost/app?host=remote.example",
            "postgresql://app:secret@localhost/app?service=other",
            "postgresql://app:secret@localhost/app#fragment",
        ):
            with self.subTest(url=url), self.assertRaises(ValueError) as error:
                validate_database_url(url)
            self.assertNotIn("secret", str(error.exception))

    def test_postgres_selection_does_not_create_a_local_database_or_connect(self):
        with patch.dict(os.environ, {"DATABASE_URL": "postgresql://app@localhost/test", "SESSION_TTL_HOURS": "2"}), patch("backend.app.database.AuthStore") as local:
            store = create_auth_store()
            self.assertIsInstance(store, PostgresAuthStore)
            self.assertEqual(store.session_ttl_seconds, 7200)
            local.assert_not_called()

    def test_bad_postgres_configuration_does_not_fall_back_to_sqlite(self):
        with patch.dict(os.environ, {"DATABASE_URL": "not-a-connection", "SESSION_TTL_HOURS": "8"}), patch("backend.app.database.AuthStore") as local:
            with self.assertRaises(ValueError):
                create_auth_store()
            local.assert_not_called()

    def test_explicit_local_test_path_isolated_from_live_database(self):
        path = Path(".test-artifacts/test-auth.sqlite3")
        with patch.dict(os.environ, {"DATABASE_URL": "postgresql://live@localhost/live", "SESSION_TTL_HOURS": "8"}), patch("backend.app.database.AuthStore") as local:
            self.assertIs(create_auth_store(path), local.return_value)
            local.assert_called_once_with(path, 28800)


@unittest.skipUnless(os.environ.get("TEST_DATABASE_URL"), "Set TEST_DATABASE_URL for a dedicated PostgreSQL test database.")
class PostgresAccountTests(unittest.TestCase):
    def setUp(self):
        try:
            import psycopg  # noqa: F401
        except ImportError:
            self.skipTest("Install project dependencies to run PostgreSQL integration tests.")
        self.store = PostgresAuthStore(os.environ["TEST_DATABASE_URL"])
        self.database = self.enterContext(self.store.connection())
        # Every test, including its DDL and session cleanup, is rolled back.
        self.enterContext(self.database.transaction(force_rollback=True))

        @contextmanager
        def test_connection():
            with self.database.transaction():
                yield self.database

        self.store.connection = test_connection
        self.store.initialize_schema()
        self.prefix = "test_" + uuid.uuid4().hex[:12]
        self.password = "isolated-postgres-test-password"

    def test_role_approval_rules_and_case_insensitive_username(self):
        for role in ("patient", "student", "researcher", "doctor"):
            user = self.store.register(self.prefix + role, self.password, role)
            self.assertEqual(user.approved, role in {"patient", "student"})
            logged_in, _token = self.store.login(user.username.upper(), self.password)
            self.assertEqual(logged_in.id, user.id)
        with self.assertRaises(UsernameTakenError):
            self.store.register((self.prefix + "doctor").upper(), self.password, "patient")

    def test_password_and_session_hashes_and_revocation(self):
        user = self.store.register(self.prefix, self.password, "student")
        _user, token = self.store.login(self.prefix, self.password)
        row = self.database.execute("SELECT * FROM breast_cancer.users WHERE id = %s", (user.id,)).fetchone()
        session = self.database.execute("SELECT token_hash FROM breast_cancer.sessions WHERE user_id = %s", (user.id,)).fetchone()
        self.assertNotEqual(row["password_hash"], self.password)
        self.assertEqual(len(row["password_salt"]), 32)
        self.assertEqual(session["token_hash"], hashlib.sha256(token.encode()).hexdigest())
        self.assertEqual(self.store.session_user(token).id, user.id)
        self.store.revoke(token)
        self.assertIsNone(self.store.session_user(token))

    def test_approval_refreshes_active_session_and_expiry_is_enforced(self):
        user = self.store.register(self.prefix, self.password, "doctor")
        _user, token = self.store.login(self.prefix, self.password)
        self.assertFalse(self.store.session_user(token).approved)
        self.store.approve(self.prefix.upper())
        self.assertTrue(self.store.session_user(token).approved)
        self.database.execute("UPDATE breast_cancer.sessions SET expires_at = 0 WHERE user_id = %s", (user.id,))
        self.assertIsNone(self.store.session_user(token))

    def test_missing_account_and_wrong_password_have_same_message(self):
        self.store.register(self.prefix, self.password, "student")
        messages = []
        for username in (self.prefix, self.prefix + "missing"):
            with self.assertRaises(InvalidCredentialsError) as error:
                self.store.login(username, "wrong-password")
            messages.append(str(error.exception))
        self.assertEqual(messages[0], messages[1])


if __name__ == "__main__":
    unittest.main()
