import sys

import psycopg

from app.database import get_connection, get_demo_organization_id

EXPECTED_TABLES = {
    "organizations",
    "reports",
    "transcription_attempts",
    "transcription_reviews",
}


def main():
    organization_id = get_demo_organization_id()

    with get_connection() as connection:
        rows = connection.execute(
            """
            SELECT table_name
            FROM information_schema.tables
            WHERE table_schema = 'sentinel'
              AND table_type = 'BASE TABLE'
            """
        ).fetchall()

        found_tables = {row[0] for row in rows}
        missing_tables = EXPECTED_TABLES - found_tables

        if missing_tables:
            raise RuntimeError(
                "Missing tables: " + ", ".join(sorted(missing_tables))
            )

        organization = connection.execute(
            """
            SELECT name, is_demo
            FROM sentinel.organizations
            WHERE id = %s
            """,
            (organization_id,),
        ).fetchone()

        if organization is None:
            raise RuntimeError("Configured demo organization was not found.")

        if organization[1] is not True:
            raise RuntimeError("Configured organization is not a demo.")

    print("SUCCESS: All four reporting tables exist.")
    print(f"Demo organization: {organization[0]}")
    print("Reusable database connection passed. No records changed.")


if __name__ == "__main__":
    try:
        main()
    except psycopg.Error as error:
        print(f"Database test failed: {type(error).__name__}")
        print("Check the connection settings, password and network.")
        sys.exit(1)
    except (RuntimeError, ValueError) as error:
        print(f"Configuration test failed: {error}")
        sys.exit(1)