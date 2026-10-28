# Elbuy Frontend

A React + TypeScript dashboard built with Vite, Tailwind CSS, Axios, and Lucide icons.

## Requirements

- Node.js 20.19+ (or 22.12+)
- npm
- The Elbuy Python backend running on `http://localhost:8000`

## Install and run

Open a terminal in this `frontend` directory and run:

```bash
npm install
npm run dev
```

Open the local URL printed by Vite. The app defaults to `http://localhost:5173`.

## Backend URL

The default backend base URL is `http://localhost:8000`. To configure it, copy `.env.example` to `.env.local` and update:

```env
VITE_API_BASE_URL=http://localhost:8000
```

Vite environment variables are embedded in frontend code, so do not put secrets or the Neon database connection string in this file.

## API calls used

- `POST /api/sync`
- `GET /forecast?startTime=...`
- `GET /accuracy?from=...&to=...`

The forecast date/time input is interpreted as UK time. Since the evaluated period is January 2026, UK time is GMT (UTC), and the frontend sends an explicit `Z` timezone suffix.

## Build

```bash
npm run build
npm run preview
```

The frontend does not bundle the Python backend. Run it separately and ensure its `FRONTEND_ORIGIN` is `http://localhost:5173` for local development.
