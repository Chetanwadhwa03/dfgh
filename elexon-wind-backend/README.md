# Elexon Wind Database Setup

A minimal Python project that connects to an **existing Neon PostgreSQL database** and creates the two tables required for the Elexon wind-generation assignment.

## 1. Requirements

- Python 3.11 or newer
- `uv` installed
- A Neon PostgreSQL database and its connection string

> This script creates the tables inside the database named in your connection string. It does not create a new Neon project or a new PostgreSQL database. Create/select the database in Neon first, then copy its connection string.

## 2. Configure the connection string

Open `.env.local` and replace the example `DATABASE_URL` with the connection string copied from Neon. It typically looks like this:

```dotenv
DATABASE_URL="postgresql://USER:PASSWORD@HOST/DBNAME?sslmode=require"
```

Use the actual connection string supplied by Neon; do not use the example values above. Keep your real `.env.local` private and never commit it to a public repository.

## 3. Install dependencies with uv

Run these commands in the project directory:

```bash
uv sync
```

`uv sync` creates the local `.venv` environment if needed and installs the dependencies declared in `pyproject.toml`. It also creates `uv.lock` to lock the resolved dependency versions.

## 4. Create the tables

```bash
uv run python main.py
```

On success, you should see:

```text
Connected to PostgreSQL successfully.
Tables are ready: wind_forecasts, actual_generation.
```

The setup uses `CREATE TABLE IF NOT EXISTS`, so you can run it again without creating duplicate tables.

## 5. Tables created

### `wind_forecasts`

| Column | Type | Purpose |
|---|---|---|
| `id` | `BIGSERIAL PRIMARY KEY` | Unique row ID |
| `start_time` | `TIMESTAMPTZ` | Start of the forecast's delivery interval |
| `publish_time` | `TIMESTAMPTZ` | When this forecast version was published |
| `generation_mw` | `NUMERIC` | Forecast generation in MW |

A unique constraint on `(start_time, publish_time)` allows multiple forecast versions for one delivery interval while preventing the same version from being inserted twice.

### `actual_generation`

| Column | Type | Purpose |
|---|---|---|
| `id` | `BIGSERIAL PRIMARY KEY` | Unique row ID |
| `start_time` | `TIMESTAMPTZ` | Start of the half-hourly actual interval |
| `publish_time` | `TIMESTAMPTZ` | When this actual record was published |
| `settlement_date` | `DATE` | Settlement date from Elexon |
| `settlement_period` | `SMALLINT` | Settlement period number |
| `generation_mw` | `NUMERIC` | Actual generation in MW |

A unique constraint on `(start_time, publish_time)` preserves distinct published versions if an actual value is revised.

Both tables reject negative generation values. No data-fetching, API endpoints, forecast matching, or frontend code is included yet.

## File layout

```text
elexon-wind-db/
├── .env.local            # Your local Neon connection string (do not commit)
├── .env.local.example    # Placeholder example
├── .gitignore
├── main.py               # Connects and creates both tables
├── pyproject.toml        # Project metadata and dependencies for uv
├── README.md
└── uv.lock               # Created by uv sync
```
