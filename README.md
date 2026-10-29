# Elbuy — Wind Forecast Accuracy Dashboard

Elbuy is a web application for exploring UK wind power generation forecasts and evaluating their accuracy against actual generation data published by Elexon.

The application retrieves historical forecast and actual generation records, stores them in PostgreSQL, selects forecasts that satisfy a 24-hour lead-time rule, and calculates forecast error metrics over a user-selected date range.

## Live Application

- **Frontend:** [Elbuy Dashboard](https://elbuy-lime.vercel.app/)
- **Backend API:** [Elbuy API](http://elbuy-backend.onrender.com/)
- **API Documentation:** [Interactive API Docs](http://elbuy-backend.onrender.com/docs)
- **Video Walkthrough:** [Unlisted YouTube Video](https://www.youtube.com/watch?v=bZwXRw50TQE)

## Features

- **Data synchronisation:** Fetches wind generation actuals and forecast records from Elexon's BMRS API.
- **Historical forecast selection:** Selects the latest forecast published at least 24 hours before its delivery interval.
- **Forecast lookup:** Displays the eligible forecast for a selected delivery interval.
- **Forecast accuracy metrics:** Calculates Mean Absolute Error (MAE), Root Mean Squared Error (RMSE), and forecast bias.
- **Daily error visualisation:** Displays daily MAE across the selected date range.
- **Duplicate prevention:** Uses PostgreSQL constraints and upserts to avoid duplicate records during repeated synchronisations.
- **Sync cooldown:** Limits successful synchronisations to one every 30 minutes.
- **Containerised backend:** Uses Docker to package and run the Python API.

## Technology Stack

| Component | Technologies |
|---|---|
| Frontend | React, TypeScript, Vite, Tailwind CSS |
| HTTP client and visualisation | Axios, Recharts |
| Backend | Python, FastAPI, HTTPX |
| Database | PostgreSQL hosted on Neon |
| Containerisation | Docker |
| Deployment | Vercel (frontend), Render (backend) |

## Project Structure

```text
elbuy/
├── elexon-wind-backend/
│   ├── app/
│   │   ├── __init__.py
│   │   ├── database.py
│   │   └── main.py
│   ├── scripts/
│   │   ├── __init__.py
│   │   └── init.py
│   ├── Dockerfile
│   ├── .dockerignore
│   ├── pyproject.toml
│   └── uv.lock
├── frontend/
│   ├── src/
│   │   ├── App.tsx
│   │   ├── api.ts
│   │   ├── index.css
│   │   └── main.tsx
│   ├── index.html
│   ├── package.json
│   ├── package-lock.json
│   └── vite.config.ts
├── .gitignore
└── README.md
```

### Key Files

- `app/main.py`: Defines the FastAPI endpoints, data synchronisation logic, forecast selection, and accuracy calculations.
- `app/database.py`: Loads the database connection configuration and provides a reusable PostgreSQL connection.
- `scripts/init.py`: Creates the database tables required by the application.
- `Dockerfile`: Defines how to build the backend image and start the API.
- `pyproject.toml` and `uv.lock`: Define the Python dependencies and their locked versions.
- `frontend/src/App.tsx`: Implements the dashboard, form interactions, loading states, and result rendering.
- `frontend/src/api.ts`: Configures Axios and the backend base URL.
- `frontend/src/index.css`: Contains the global styles and Tailwind CSS import.
- `frontend/src/main.tsx`: Entry point for the React application.

## Data Sources and Scope

Elbuy uses the following Elexon BMRS datasets:

- **FUELHH:** Actual generation by fuel type, filtered to `WIND`.
- **WINDFOR:** Wind generation forecasts, including publication timestamps and target delivery intervals.

The application evaluates delivery intervals in January 2026.

### Forecast Selection

For a delivery interval beginning at `startTime`, the application considers forecasts satisfying:

`publishTime <= startTime - 24 hours`

Among eligible forecasts for the same delivery interval, it selects the latest publication.

The 24-hour lead time is an explicit project assumption used to evaluate forecasts available sufficiently ahead of delivery; it is not presented as the official electricity-market purchasing deadline.

### Matching Actuals to Forecasts

WINDFOR forecasts are evaluated at hourly intervals, while FUELHH actual generation is recorded at half-hourly intervals. The two corresponding half-hourly actual readings are averaged to obtain an hourly actual-generation value.

Intervals without both required actual readings are excluded from the accuracy calculation and reported in the response.

## Forecast Accuracy Metrics

The application calculates three metrics using the error definition:

`Error = Forecast Generation - Actual Generation`

| Metric | Description |
|---|---|
| MAE | Mean Absolute Error measures the average magnitude of forecast errors, ignoring direction. Lower is better. |
| RMSE | Root Mean Squared Error gives greater weight to larger errors. Lower is better. |
| Bias | Mean signed error indicates whether forecasts tend to overestimate or underestimate generation. Positive values indicate overforecasting; negative values indicate underforecasting. |

All three metrics are reported in megawatts (MW).

The daily MAE chart displays how the average absolute forecast error changes across the requested period.

## API Endpoints

| Method | Endpoint | Purpose |
|---|---|---|
| `POST` | `/api/sync` | Fetches January 2026 actuals and forecast records from Elexon and stores them in PostgreSQL. |
| `GET` | `/forecast?startTime=...` | Returns the latest eligible forecast for a requested delivery interval. |
| `GET` | `/accuracy?from=...&to=...` | Returns overall accuracy metrics, interval counts, and daily MAE values. |

The sync endpoint returns a `409` response when a sync is already running and a `429` response when the 30-minute cooldown is active. The forecast and accuracy endpoints read data already stored in PostgreSQL.

## Local Setup

### Prerequisites

Install the following:

- Python 3.11 or newer
- `uv`
- Node.js and npm
- Docker Desktop, if running the backend in a container
- A PostgreSQL database, such as Neon

### 1. Clone the Repository

```bash
git clone https://github.com/Chetanwadhwa03/dfgh.git
cd elbuy
```

### 2. Configure the Backend

Move into the backend directory:

```bash
cd elexon-wind-backend
```

Create a `.env` file in this directory:

```dotenv
DATABASE_URL=YOUR_NEON_POSTGRESQL_CONNECTION_STRING
FRONTEND_ORIGIN=http://localhost:5173
```

Replace the database URL with your own Neon connection string.

Install the Python dependencies:

```bash
uv sync
```

Initialise the database tables:

```bash
uv run python -m scripts.init
```

Start the FastAPI server:

```bash
uv run uvicorn app.main:app --reload
```

The backend will normally be available at `http://localhost:8000`.

Open `http://localhost:8000/docs` to inspect and test the endpoints.

### 3. Configure the Frontend

Open a new terminal from the top-level project directory:

```bash
cd frontend
```

Create a `.env` file:

```dotenv
VITE_API_BASE_URL=http://localhost:8000
```

Install the frontend dependencies:

```bash
npm install
```

Start the development server:

```bash
npm run dev
```

Open the local URL printed by Vite, usually `http://localhost:5173`.

The frontend calls the backend using the configured `VITE_API_BASE_URL`.

## Running the Backend with Docker

From the `elexon-wind-backend` directory, create a local `.env.docker` file:

```dotenv
DATABASE_URL=YOUR_NEON_POSTGRESQL_CONNECTION_STRING
FRONTEND_ORIGIN=http://localhost:5173
```

Build the Docker image:

```bash
docker build -t elbuy-backend:local .
```

Run the container:

```bash
docker run --rm --name elbuy-backend -p 8000:8000 --env-file .env.docker elbuy-backend:local
```

The API will be available at `http://localhost:8000`.

Environment files contain credentials and must not be committed to Git. The Docker image does not include the local environment file; the values are provided at container startup.

## Deployment

The application is deployed using separate frontend and backend services.

### Frontend — Vercel

- Root directory: `frontend`
- Framework: Vite
- Build command: `npm run build`
- Output directory: `dist`
- Environment variable: `VITE_API_BASE_URL`, set to the deployed Render backend URL.

### Backend — Render

- Runtime: Docker
- Root directory: `elexon-wind-backend`
- Environment variable: `DATABASE_URL`, set to the Neon PostgreSQL connection string.
- Environment variable: `FRONTEND_ORIGIN`, set to the exact deployed Vercel frontend origin.

The Neon database remains hosted separately from the application containers.

## Security and Configuration

- Database credentials are supplied through environment variables and are not included in the source code or Docker image.
- Local environment files, virtual environments, and generated dependencies should remain excluded from Git.
- The backend restricts browser access using its configured frontend origin.
- The sync operation is protected by a database-level lock and a persistent cooldown.
- The public sync endpoint should be protected against unauthorised use if the application is extended beyond this assignment.

## AI-Assisted Development

OpenAI ChatGPT was used as an AI-assisted development tool to support architectural planning, implementation, Python and database code explanations, debugging, and deployment configuration.

The implementation was tested incrementally, including API requests, PostgreSQL operations, frontend integration, and local Docker execution. The developer reviewed and refined the code while learning the underlying application logic.

