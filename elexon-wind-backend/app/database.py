# File use to connect to the database in the neon.tech through it's url

import os
from pathlib import Path

import psycopg
from dotenv import load_dotenv
from psycopg.rows import dict_row


PROJECT_ROOT = Path(__file__).resolve().parents[1]

load_dotenv(PROJECT_ROOT / ".env")


def get_connection():
    database_url = os.getenv("DATABASE_URL")

    if not database_url or "USER:PASSWORD@HOST/DBNAME" in database_url:
        raise RuntimeError(
            "DATABASE_URL is missing or still has the example placeholder. "
            "Check .env."
        )

    return psycopg.connect(
        database_url,
        connect_timeout=10,
        row_factory=dict_row,
    )