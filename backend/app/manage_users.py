"""Approve a registered account from the trusted local development terminal."""

import argparse

from .auth import AuthStore, configured_database_path


def main() -> None:
    parser = argparse.ArgumentParser(description="Local Breast Cancer Prediction account administration")
    parser.add_argument("command", choices=["approve"])
    parser.add_argument("username", help="The registered account to approve")
    arguments = parser.parse_args()
    store = AuthStore(configured_database_path())
    user = store.approve(arguments.username)
    if user is None:
        parser.exit(status=1, message="No registered account has that username.\n")
    print(f"Approved {user.username} ({user.role}).")


if __name__ == "__main__":
    main()
