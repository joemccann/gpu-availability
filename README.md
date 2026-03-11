# GPU Availability API + Next.js

Live GPU availability system with a Node.js API, persistent history storage, and a Next.js frontend. The backend polls public provider endpoints, normalizes inventory into one dataset, stores a rolling time series on disk, and the frontend renders both the latest snapshot and recent history through same-origin proxy routes.

## What This Project Does
- Collects live public GPU availability for `A100`, `H100`, and `B200`
- Exposes current and historical normalized datasets over HTTP
- Persists snapshots to `generated/history/snapshots.jsonl`
- Renders a responsive dashboard in Next.js using same-origin `/api/*` routes
- Preserves automated tests with 100% line, branch, and function coverage for `src/*.js`

## Supported Live Sources
- RunPod official GraphQL `gpuTypes` endpoint
- Vast.ai official `/api/v0/bundles/` endpoint filtered to verified, non-external, rentable offers

## Known Public Source Gaps
- Lambda publishes self-serve pricing, but not unauthenticated availability counts
- TensorDock public collection was not reliably available during implementation
- CoreWeave does not expose unauthenticated on-demand availability counts publicly

## Architecture
- `src/market.js`: live provider collection and normalization
- `src/history.js`: JSONL-backed snapshot persistence and history aggregation
- `src/api.js`: HTTP API handlers, CORS, snapshot caching, and polling scheduler primitives
- `server/index.mjs`: Node API runtime entrypoint
- `web/app/page.js`: dashboard page that fetches same-origin API routes
- `web/app/api/live-snapshot/route.js`: Next.js proxy for the live snapshot endpoint
- `web/app/api/history/route.js`: Next.js proxy for the history endpoint
- `web/lib/backend-api.js`: backend base URL resolution for server-side proxy routes
- `tests/`: Node test suite
- `.github/workflows/verify.yml`: CI pipeline running full verification
- `Dockerfile` and `docker-compose.yml`: containerized API + web setup

## API Endpoints
- `GET /health`
- `GET /api/live-snapshot`
- `GET /api/live-snapshot?refresh=1`
- `GET /api/history`
- `GET /api/history?limit=24`

The API caches live snapshots in memory for `60s` by default and records periodic snapshots to disk every `15m` by default.

## Web Behavior
- The browser hits the Next.js app on `http://127.0.0.1:3000`
- The Next.js app calls same-origin `/api/live-snapshot` and `/api/history`
- Those routes proxy to the Node API using `API_BASE_URL` or `NEXT_PUBLIC_API_BASE_URL`

This avoids direct browser-to-backend base URL wiring in the UI and keeps local/dev deployments simpler.

## Scripts
- `npm run start:api`: start the Node API on the configured port
- `npm run dev:api`: run the API in watch mode
- `npm run dev:web`: start the Next.js frontend in development mode
- `npm run start:web`: start the built Next.js frontend
- `npm run build:web`: build the Next.js frontend
- `npm run build`: alias for `npm run build:web`
- `npm run generate:data`: write a live snapshot into `data/chart-data.json` and `public/chart-data.json`
- `npm test`: run the automated test suite with coverage gates
- `npm run verify`: run live snapshot generation, tests, and the frontend build

## Environment Variables
- `PORT`: API port, default `3001`
- `SNAPSHOT_CACHE_TTL_MS`: in-memory snapshot cache TTL, default `60000`
- `SNAPSHOT_POLL_INTERVAL_MS`: scheduler interval for persisted snapshots, default `900000`
- `SNAPSHOT_POLL_ENABLED`: set to `0` to disable background polling
- `API_BASE_URL`: backend base URL used by Next.js server-side proxy routes
- `NEXT_PUBLIC_API_BASE_URL`: fallback backend base URL for local development

## Local Development
1. Start the API in one terminal:

```bash
npm run start:api
```

2. Start the Next.js app in another terminal:

```bash
npm run dev:web
```

3. Open `http://127.0.0.1:3000`

If `3001` is occupied, run:

```bash
PORT=4010 npm run start:api
API_BASE_URL=http://127.0.0.1:4010 npm run dev:web
```

## Docker
Run both services together with:

```bash
docker compose up --build
```

The compose stack starts:
- API on `http://127.0.0.1:3001`
- Next.js web app on `http://127.0.0.1:3000`

## CI
GitHub Actions runs `.github/workflows/verify.yml`, which installs dependencies and executes:

```bash
npm run verify
```

## Verification
- `npm test` keeps `src/*.js` at 100% line, branch, and function coverage
- `npm run verify` exercises live snapshot generation, tests, and `next build ./web`
- Runtime smoke checks should include `/health`, `/api/live-snapshot`, and `/api/history`

## Notes
- The frontend does not read local JSON files directly.
- `data/chart-data.json`, `public/chart-data.json`, and `generated/history/` are generated artifacts and are ignored by git.
