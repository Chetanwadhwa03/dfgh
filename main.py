import os
import sys
from pathlib import Path

import psycopg
from dotenv import load_dotenv


# Load this project's .env.local file explicitly; Python does not load it automatically.
load_dotenv(override = True)

DATABASE_URL = os.getenv("DATABASE_URL")

CREATE_WIND_FORECASTS_SQL = """
CREATE TABLE IF NOT EXISTS wind_forecasts (
    id BIGSERIAL PRIMARY KEY,
    start_time TIMESTAMPTZ NOT NULL,
    publish_time TIMESTAMPTZ NOT NULL,
    generation_mw NUMERIC NOT NULL CHECK (generation_mw >= 0),
    CONSTRAINT uq_wind_forecasts_start_publish UNIQUE (start_time, publish_time)
);
"""

CREATE_ACTUAL_GENERATION_SQL = """
CREATE TABLE IF NOT EXISTS actual_generation (
    id BIGSERIAL PRIMARY KEY,
    start_time TIMESTAMPTZ NOT NULL,
    publish_time TIMESTAMPTZ NOT NULL,
    settlement_date DATE NOT NULL,
    settlement_period SMALLINT NOT NULL CHECK (settlement_period > 0),
    generation_mw NUMERIC NOT NULL CHECK (generation_mw >= 0),
    CONSTRAINT uq_actual_generation_start_publish UNIQUE (start_time, publish_time)
);
"""


def main() -> int:
    # handling the edge case if the database does not get connected.
    if not DATABASE_URL or "USER:PASSWORD@HOST/DBNAME" in DATABASE_URL:
        print(
            "DATABASE_URL is missing or still has the example placeholder.\n"
            "Open .env.local and paste your Neon PostgreSQL connection string.",
            file=sys.stderr,
        )
        return 1

    # Keeping try-except so that server does not break when encounter error.
    try:
        # The connection context commits on success and closes the connection.
        with psycopg.connect(DATABASE_URL) as connection:
            with connection.cursor() as cursor:
                cursor.execute(CREATE_WIND_FORECASTS_SQL)
                cursor.execute(CREATE_ACTUAL_GENERATION_SQL)
        print("Connected to PostgreSQL successfully.")
        print("Tables are ready: wind_forecasts, actual_generation.")
        return 0
    except psycopg.Error as error:
        print("Could not connect or create the tables.", file=sys.stderr)
        print(f"PostgreSQL error: {error}", file=sys.stderr)
        print(
            "Check that DATABASE_URL is correct and that the Neon database is reachable.",
            file=sys.stderr,
        )
        return 1

# Raise is used to exit gracefully and it helps mainly in the CI/CD piplelines to get that has the server exited successfully (statuhzscode= 0) or the server has exited with some error (statuscode = 1)
if __name__ == "__main__":
    raise SystemExit(main())
