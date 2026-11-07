"""Initialize/check the schema in an existing PostgreSQL database."""

import argparse
import os

from .database import DatabaseUnavailableError, PostgresAuthStore, load_environment


def main() -> None:
    parser = argparse.ArgumentParser(description="Breast Cancer Prediction PostgreSQL setup")
    parser.add_argument("command", choices=["init", "check"])
    arguments = parser.parse_args()
    load_environment()
    database_url = os.environ.get("DATABASE_URL", "").strip()
    if not database_url:
        parser.exit(1, "Set DATABASE_URL in the project .env or hosting environment first.\n")
    try:
        store = PostgresAuthStore(database_url)
        if arguments.command == "init":
            store.initialize_schema()
        store.check_schema()
    except (DatabaseUnavailableError, ValueError) as error:
        parser.exit(1, f"{error}\n")
    print("PostgreSQL connected. Account and session tables are ready.")


if __name__ == "__main__":
    main()
