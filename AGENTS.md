# AGENTS.md

## Project Summary
- This repo is a live GPU availability system with a Node.js API and a Next.js frontend.
- Live collection currently normalizes public availability for `A100`, `H100`, and `B200`.
- Real provider inputs come from RunPod and Vast.ai. Do not replace live data with synthetic data unless the user explicitly asks for a mock.
- The backend now persists time-series snapshots to `generated/history/snapshots.jsonl` and serves both current and historical API responses.

## Architecture
- `src/market.js`: live provider fetch + normalization logic
- `src/history.js`: JSONL-backed history persistence and aggregation helpers
- `src/api.js`: API server primitives, CORS behavior, snapshot caching, and polling scheduler logic
- `server/index.mjs`: runtime entrypoint for the Node API
- `web/app/api/live-snapshot/route.js`: same-origin proxy for the live snapshot endpoint
- `web/app/api/history/route.js`: same-origin proxy for the history endpoint
- `web/`: Next.js frontend that fetches the proxied API routes and renders the dashboard
- `tests/`: Node test suite; `src/*.js` must stay at 100% line, branch, and function coverage
- `scripts/generate-data.mjs`: manual live snapshot export to `data/` and `public/`

## Working Agreement For Codex
- For non-trivial work, update `tasks/todo.md` first with a dependency graph and checkable tasks.
- Keep backend changes in `src/` and `server/`; keep frontend app changes in `web/`.
- If you change the API contract, update the frontend and the README in the same pass.
- If you change live collection or history behavior, keep provider gaps explicit and update tests.
- Do not reintroduce direct file-based frontend data loading; the frontend should use the Next.js same-origin proxy routes.
- Treat `generated/history/` as runtime data, not committed source.
- CI and deployment files live at the repo root and `.github/workflows/`; keep them aligned with the active scripts.

## Commands
- API dev: `npm run dev:api`
- API start: `npm run start:api`
- Frontend dev: `npm run dev:web`
- Frontend production build: `npm run build:web`
- Manual live snapshot generation: `npm run generate:data`
- Tests: `npm test`
- Full verification: `npm run verify`

## Environment
- API port defaults to `3001` and can be overridden with `PORT`.
- Snapshot cache TTL defaults to `60000` ms and can be overridden with `SNAPSHOT_CACHE_TTL_MS`.
- Snapshot polling defaults to `900000` ms and can be overridden with `SNAPSHOT_POLL_INTERVAL_MS`.
- Set `SNAPSHOT_POLL_ENABLED=0` to disable background history recording.
- Frontend proxy base URL defaults to `http://127.0.0.1:3001` and can be overridden with `API_BASE_URL` or `NEXT_PUBLIC_API_BASE_URL`.

## Verification Expectations
- Backend-only changes: run `npm test`
- Frontend changes: run `npm run build:web`
- Changes that touch live data or repo wiring: run `npm run verify`
- When possible, include a small runtime smoke test against `/health`, `/api/live-snapshot`, and `/api/history`
