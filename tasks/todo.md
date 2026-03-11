# Full Execution Plan

## Objective
Execute the full next-step backlog for this repo: add history persistence and time-series endpoints, add a same-origin frontend proxy path, add CI and deployment artifacts, run and verify the full stack, commit the work, and publish the GitHub repository publicly.

## Constraints
- Preserve the existing live provider collection contract unless a coordinated API/frontend change is needed.
- Keep `src/*.js` at 100% line, branch, and function coverage.
- Keep repo metadata and docs aligned with the final architecture.
- Publishing to GitHub depends on working `gh` authentication and repo creation/push succeeding.

## Dependency Graph
- `T1` depends_on: []
- `T2` depends_on: [`T1`]
- `T3` depends_on: [`T1`]
- `T4` depends_on: [`T2`]
- `T5` depends_on: [`T2`, `T3`, `T4`]
- `T6` depends_on: [`T5`]
- `T7` depends_on: [`T6`]
- `T8` depends_on: [`T7`]

## Tasks
- [x] `T1` Audit the current API/frontend/repo state, define the history-storage and deployment plan, and confirm GitHub publication prerequisites. `depends_on: []`
- [x] `T2` Implement snapshot persistence, history querying endpoints, and backend tests. `depends_on: [T1]`
- [x] `T3` Add CI and deployment artifacts for the API + Next.js stack. `depends_on: [T1]`
- [x] `T4` Add a same-origin frontend proxy path and update the Next.js app to render current and historical data from the API. `depends_on: [T2]`
- [x] `T5` Update repo scripts, docs, and ignore rules for the final architecture. `depends_on: [T2, T3, T4]`
- [x] `T6` Run full verification, plus runtime smoke tests for the API and frontend behavior. `depends_on: [T5]`
- [x] `T7` Create descriptive git commits for the completed work. `depends_on: [T6]`
- [x] `T8` Create or publish the GitHub repository publicly and push the current branch. `depends_on: [T7]`

## Review
- Added persistent snapshot history in `src/history.js` and wired `src/api.js` plus `server/index.mjs` to serve `GET /api/history`, cache current snapshots, and record scheduled snapshots to disk.
- Added same-origin Next.js proxy routes in `web/app/api/live-snapshot/route.js` and `web/app/api/history/route.js`, and updated `web/app/page.js` to render both live and recent-history views from those routes.
- Added repo automation and deployment artifacts in `.github/workflows/verify.yml`, `Dockerfile`, `.dockerignore`, and `docker-compose.yml`.
- Updated `README.md` and `AGENTS.md` to reflect the history API, scheduler, proxy model, Docker workflow, and runtime environment variables.
- `npm run verify` passed on March 11, 2026 with 22 passing tests, 100% line/branch/function coverage for `src/*.js`, and a successful `next build ./web`.
- Runtime smoke passed on March 11, 2026:
  API `http://127.0.0.1:4010/health` returned `200`.
  API `http://127.0.0.1:4010/api/live-snapshot` returned `200` with `generatedAt=2026-03-11T14:20:33.473Z` and totals `A100=33`, `H100=35`, `B200=29`.
  API `http://127.0.0.1:4010/api/history?limit=24` returned `200` with `count=1`.
  Web `http://127.0.0.1:4020/api/live-snapshot` returned `200` with 3 chip rows.
  Web `http://127.0.0.1:4020/api/history?limit=24` returned `200` with `count=2`.
  Web `http://127.0.0.1:4020/` returned `200` and included the dashboard shell text.
- `docker compose config` passed on March 11, 2026.
- Created git commit `4973c8b` with the full API, history, proxy, CI, deployment, and docs baseline.
- Published `https://github.com/joemccann/gpu-availability` on March 11, 2026 and confirmed `visibility=PUBLIC` with `gh repo view`.
