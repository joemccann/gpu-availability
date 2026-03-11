# Lessons

- When the user asks to move faster, keep updates terse and spend less time on low-yield retrieval attempts before converging on a documented assumption set.
- When shipping a static browser artifact intended to be opened directly, do not rely on `type="module"` imports or `fetch()` from `file://`; emit a self-contained build artifact or require `http(s)` explicitly.
- When a repo has both a source entry page and a standalone build, do not leave the project-root `index.html` pointing at `src/` modules if users may open it via `file://`; make the root entry file-safe or forward it to the standalone artifact.
- When the user asks for live data, do not substitute modeled or synthetic data; verify reachable live sources first and make any fallback explicit.
