# This file is used to create the tables and even enter records for the sync table.

import sys

import psycopg

from app.database import get_connection


CREATE_WIND_FORECASTS_SQL = """
CREATE TABLE IF NOT EXISTS wind_forecasts (
    id BIGSERIAL PRIMARY KEY,
    start_time TIMESTAMPTZ NOT NULL,
    publish_time TIMESTAMPTZ NOT NULL,
    generation_mw NUMERIC NOT NULL CHECK (generation_mw >= 0),
    CONSTRAINT uq_wind_forecasts_start_publish
        UNIQUE (start_time, publish_time)
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
    CONSTRAINT uq_actual_generation_start_publish
        UNIQUE (start_time, publish_time)
);
"""

CREATE_SYNC_CONTROL_SQL = """
CREATE TABLE IF NOT EXISTS sync_control (
    id SMALLINT PRIMARY KEY CHECK (id = 1),
    last_successful_sync TIMESTAMPTZ
);
"""

INSERT_SYNC_CONTROL_ROW_SQL = """
INSERT INTO sync_control (id, last_successful_sync)
VALUES (1, NULL)
ON CONFLICT (id) DO NOTHING;
"""


def main() -> int:
    try:
        with get_connection() as connection:
            with connection.cursor() as cursor:
                cursor.execute(CREATE_WIND_FORECASTS_SQL)
                cursor.execute(CREATE_ACTUAL_GENERATION_SQL)
                cursor.execute(CREATE_SYNC_CONTROL_SQL)
                cursor.execute(INSERT_SYNC_CONTROL_ROW_SQL)

        print("Connected to PostgreSQL successfully.")
        print(
            "Tables are ready: wind_forecasts, actual_generation, sync_control."
        )
        return 0

    except (psycopg.Error, RuntimeError) as error:
        print(f"Database initialization failed: {error}", file=sys.stderr)
        return 1


if __name__ == "__main__":
    raise SystemExit(main())