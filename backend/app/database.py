from pathlib import Path
from uuid import UUID

import psycopg
from dotenv import dotenv_values

ROOT = Path(__file__).resolve().parents[2]


def read_database_settings():
    # Disable interpolation so password characters remain literal.
    settings = dotenv_values(ROOT / ".env", interpolate=False)

    required = (
        "DB_HOST",
        "DB_PORT",
        "DB_NAME",
        "DB_USER",
        "DB_PASSWORD",
        "DEMO_ORGANIZATION_ID",
    )
    missing = [name for name in required if not settings.get(name)]
    if missing:
        raise RuntimeError("Missing settings: " + ", ".join(missing))

    return settings


def get_demo_organization_id():
    from app.identity import current_identity
    user = current_identity.get()
    if user is not None:
        return user.organization_id
    settings = read_database_settings()
    return UUID(settings["DEMO_ORGANIZATION_ID"])


def get_connection():
    settings = read_database_settings()

    from app.identity import current_identity
    user = current_identity.get()
    actor_option = f" -c sentinel.account_id={user.account_id}" if user else ""
    return psycopg.connect(
        host=settings["DB_HOST"],
        port=settings["DB_PORT"],
        dbname=settings["DB_NAME"],
        user=settings["DB_USER"],
        password=settings["DB_PASSWORD"],
        sslmode="require",
        connect_timeout=15,
        options="-c statement_timeout=10000" + actor_option,
    )