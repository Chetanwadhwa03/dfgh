#  It will have the backend code the for the FastAPI endpoints .

import logging
import os
from datetime import date, datetime, timedelta, timezone
from decimal import Decimal, InvalidOperation

import httpx
import psycopg
from fastapi import FastAPI, HTTPException, Query
from fastapi.middleware.cors import CORSMiddleware

from app.database import get_connection


logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

ELEXON_BASE_URL = "https://data.elexon.co.uk/bmrs/api/v1"

FUELHH_URL = f"{ELEXON_BASE_URL}/datasets/FUELHH/stream"
WINDFOR_URL = f"{ELEXON_BASE_URL}/datasets/WINDFOR/stream"

JANUARY_START = datetime(2026, 1, 1, tzinfo=timezone.utc)
FEBRUARY_START = datetime(2026, 2, 1, tzinfo=timezone.utc)

SYNC_COOLDOWN = timedelta(minutes=30)
SYNC_LOCK_KEY = 73829217

FRONTEND_ORIGIN = os.getenv(
    "FRONTEND_ORIGIN",
    "http://localhost:5173",
)


app = FastAPI(title="Elexon Wind Forecast API")

app.add_middleware(
    CORSMiddleware,
    allow_origins=[FRONTEND_ORIGIN],
    allow_credentials=False,
    allow_methods=["GET", "POST"],
    allow_headers=["Content-Type"],
)


def format_timestamp(value: datetime) -> str:
    return value.astimezone(timezone.utc).isoformat().replace("+00:00", "Z")


def parse_timestamp(value):
    if not isinstance(value, str):
        return None

    try:
        parsed = datetime.fromisoformat(
            value.strip().replace("Z", "+00:00")
        )
    except ValueError:
        return None

    if parsed.tzinfo is None:
        return None

    return parsed.astimezone(timezone.utc)


def parse_generation(value):
    try:
        generation = Decimal(str(value))
    except (InvalidOperation, TypeError, ValueError):
        return None

    if not generation.is_finite() or generation < 0:
        return None

    return generation


def fetch_elexon_records(client, url, params):
    response = client.get(url, params=params)
    response.raise_for_status()

    try:
        payload = response.json()
    except ValueError:
        raise HTTPException(
            status_code=502,
            detail="Elexon returned an invalid JSON response.",
        )

    if isinstance(payload, list):
        return payload

    if isinstance(payload, dict) and isinstance(payload.get("data"), list):
        return payload["data"]

    raise HTTPException(
        status_code=502,
        detail="Elexon returned an unexpected response format.",
    )

# Validating and cleaning the data obtained from the FUELHH api endpoint as the actuals record.
# Rules for cleaning :
# 1. 
# 2. FuelType we are picking here just for the wind.
# 3. start_time should be in between janurary 1st to 31st ( because that is what we have to observe)
# 4. If any clumsy data appears in which any of the time or the settlement period does not match the data it expects we will be skipping that record.
def prepare_actuals(records):
    rows = []
    skipped = 0

    for record in records:
        if not isinstance(record, dict):
            skipped += 1
            continue

        if record.get("fuelType") != "WIND":
            continue

        start_time = parse_timestamp(record.get("startTime"))
        publish_time = parse_timestamp(record.get("publishTime"))
        generation = parse_generation(record.get("generation"))

        try:
            settlement_date = date.fromisoformat(
                str(record.get("settlementDate", ""))
            )
            settlement_period = int(record.get("settlementPeriod"))
        except (TypeError, ValueError):
            skipped += 1
            continue

        if (
            start_time is None
            or publish_time is None
            or generation is None
            or settlement_period <= 0
        ):
            skipped += 1
            continue

        if not (
            date(2026, 1, 1) <= settlement_date <= date(2026, 1, 31)
            and JANUARY_START <= start_time < FEBRUARY_START
        ):
            continue

        rows.append(
            (
                start_time,
                publish_time,
                settlement_date,
                settlement_period,
                generation,
            )
        )

    # It returns the tuple containing these 2 values and python can unpack them on the left hand side to the 2 variables from them.
    return rows, skipped


def prepare_forecasts(records):
    rows = []
    skipped = 0

    for record in records:
        if not isinstance(record, dict):
            skipped += 1
            continue

        start_time = parse_timestamp(record.get("startTime"))

        if start_time is None:
            skipped += 1
            continue

        if not JANUARY_START <= start_time < FEBRUARY_START:
            continue

        publish_time = parse_timestamp(record.get("publishTime"))
        generation = parse_generation(record.get("generation"))

        if publish_time is None or generation is None:
            skipped += 1
            continue

        rows.append((start_time, publish_time, generation))

    return rows, skipped

# API used for fetching the records from the elexon API and upserts the respected tables in the DB for it and also it maintains the logic for the sync cool down period and for the sync_table if the application is scaled in future and multiple workers are doing this same operation to update the sync time it will handle it and it will give the required error with 429 status code.

@app.post("/api/sync")

def sync_data():
    try:
        with get_connection() as connection:
            with connection.cursor() as cursor:
                cursor.execute(
                    "SELECT pg_try_advisory_xact_lock(%s) AS locked",
                    (SYNC_LOCK_KEY,),
                )

                if not cursor.fetchone()["locked"]:
                    raise HTTPException(
                        status_code=409,
                        detail="A sync is already in progress.",
                    )

                cursor.execute(
                    """
                    SELECT last_successful_sync
                    FROM sync_control
                    WHERE id = 1
                    """
                )
                sync_state = cursor.fetchone()

                if sync_state is None:
                    raise RuntimeError(
                        "Sync control is missing. Run scripts.init first."
                    )

                now = datetime.now(timezone.utc)
                last_sync = sync_state["last_successful_sync"]

                if last_sync is not None:
                    next_allowed = last_sync + SYNC_COOLDOWN

                    if now < next_allowed:
                        retry_after = max(
                            1,
                            int((next_allowed - now).total_seconds()),
                        )

                        raise HTTPException(
                            status_code=429,
                            detail={
                                "message": "Sync is available once every 30 minutes.",
                                "nextSyncAllowedAt": format_timestamp(
                                    next_allowed
                                ),
                            },
                            headers={"Retry-After": str(retry_after)},
                        )

                with httpx.Client(
                    timeout=httpx.Timeout(30.0, connect=10.0),
                    follow_redirects=False,
                ) as client:
                    actual_records = fetch_elexon_records(
                        client,
                        FUELHH_URL,
                        {
                            "settlementDateFrom": "2026-01-01",
                            "settlementDateTo": "2026-01-31",
                            "fuelType": "WIND",
                        },
                    )

                    forecast_records = fetch_elexon_records(
                        client,
                        WINDFOR_URL,
                        {
                            "publishDateTimeFrom": "2025-12-01T00:00:00Z",
                            "publishDateTimeTo": "2026-01-31T23:59:59Z",
                        },
                    )

                # Prepare the data that we got from elexon to feed it in to the postgreSQL DB.
                actual_rows, actuals_skipped = prepare_actuals(
                    actual_records
                )
                forecast_rows, forecasts_skipped = prepare_forecasts(
                    forecast_records
                )

                if not actual_rows or not forecast_rows:
                    raise HTTPException(
                        status_code=502,

                        # detail with the parentheses is used to write multiline statements without need to introduce new line in to it.
                        detail=(
                            "Elexon returned no usable January actual or "
                            "forecast records. No data was saved."
                        ),
                    )

                # Upserting the data in to the DB making sure it follows the uniqueness you setted on the columns of (start_time , publish_time)
                cursor.executemany(
                    """
                    INSERT INTO actual_generation (
                        start_time,
                        publish_time,
                        settlement_date,
                        settlement_period,
                        generation_mw
                    )
                    VALUES (%s, %s, %s, %s, %s)
                    ON CONFLICT (start_time, publish_time)
                    DO UPDATE SET
                        settlement_date = EXCLUDED.settlement_date,
                        settlement_period = EXCLUDED.settlement_period,
                        generation_mw = EXCLUDED.generation_mw
                    """,
                    actual_rows,
                )

                # upserting the wind_forecasts table.
                cursor.executemany(
                    """
                    INSERT INTO wind_forecasts (
                        start_time,
                        publish_time,
                        generation_mw
                    )
                    VALUES (%s, %s, %s)
                    ON CONFLICT (start_time, publish_time)
                    DO UPDATE SET
                        generation_mw = EXCLUDED.generation_mw
                    """,
                    forecast_rows,
                )


                # After the upsertion, obviously we will update the sync_control table in the DB so that it has the latest value.
                completed_at = datetime.now(timezone.utc)
                next_allowed = completed_at + SYNC_COOLDOWN

                cursor.execute(
                    """
                    UPDATE sync_control
                    SET last_successful_sync = %s
                    WHERE id = 1
                    """,
                    (completed_at,),
                )

        return {
            "message": "Sync completed successfully.",
            "period": {
                "from": "2026-01-01",
                "to": "2026-01-31",
            },
            "actualRecordsProcessed": len(actual_rows),
            "forecastRecordsProcessed": len(forecast_rows),
            "malformedActualRecordsSkipped": actuals_skipped,
            "malformedForecastRecordsSkipped": forecasts_skipped,
            "nextSyncAllowedAt": format_timestamp(next_allowed),
        }

    except HTTPException:
        raise

    except httpx.TimeoutException:
        raise HTTPException(
            status_code=504,
            detail="Elexon did not respond before the request timed out.",
        )

    except httpx.HTTPStatusError as error:
        logger.warning(
            "Elexon returned HTTP status %s.",
            error.response.status_code,
        )
        raise HTTPException(
            status_code=502,
            detail="Elexon returned an unsuccessful response.",
        )

    except httpx.HTTPError:
        logger.exception("Could not retrieve data from Elexon.")
        raise HTTPException(
            status_code=502,
            detail="Could not retrieve data from Elexon.",
        )

    except (psycopg.Error, RuntimeError):
        logger.exception("Database operation failed.")
        raise HTTPException(
            status_code=503,
            detail="Database operation failed. Check the backend logs.",
        )


# This endpoint is fetching the power generated for the interval user wants and it handles the exception if the forecasted data is not present to the latest interval for that time period that user wants it asks to sync the data or wait for sometime when elexon will publish the data.
@app.get("/forecast")
def get_forecast(
    start_time: datetime = Query(..., alias="startTime"),
):
    if start_time.tzinfo is None:
        raise HTTPException(
            status_code=422,
            detail="startTime must include a timezone, for example: 2026-01-15T08:00:00Z.",
        )

    start_time = start_time.astimezone(timezone.utc)

    if not JANUARY_START <= start_time < FEBRUARY_START:
        raise HTTPException(
            status_code=400,
            detail="This endpoint currently supports January 2026 delivery intervals only.",
        )

    decision_cutoff = start_time - timedelta(hours=24)

    try:
        with get_connection() as connection:
            with connection.cursor() as cursor:
                cursor.execute(
                    """
                    SELECT start_time, publish_time, generation_mw
                    FROM wind_forecasts
                    WHERE start_time = %s
                      AND publish_time <= %s
                    ORDER BY publish_time DESC
                    LIMIT 1
                    """,
                    (start_time, decision_cutoff),
                )
                forecast = cursor.fetchone()

    except (psycopg.Error, RuntimeError):
        logger.exception("Could not read the forecast from PostgreSQL.")
        raise HTTPException(
            status_code=503,
            detail="Could not read forecast data. Check the backend logs.",
        )

    if forecast is None:
        raise HTTPException(
            status_code=404,
            detail=(
                "No forecast was found for this delivery interval that "
                "satisfies the 24-hour decision cutoff. Sync the data or "
                "check the requested startTime."
            ),
        )

    return {
        "startTime": format_timestamp(forecast["start_time"]),
        "decisionCutoff": format_timestamp(decision_cutoff),
        "publishTime": format_timestamp(forecast["publish_time"]),
        "generationMW": float(forecast["generation_mw"]),
    }