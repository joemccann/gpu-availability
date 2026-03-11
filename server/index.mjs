import {
  createApiServer,
  createSnapshotScheduler,
  createSnapshotService,
  DEFAULT_API_PORT,
  DEFAULT_CACHE_TTL_MS,
  DEFAULT_POLL_INTERVAL_MS
} from "../src/api.js";

const port = Number(process.env.PORT ?? DEFAULT_API_PORT);
const cacheTtlMs = Number(process.env.SNAPSHOT_CACHE_TTL_MS ?? DEFAULT_CACHE_TTL_MS);
const pollIntervalMs = Number(process.env.SNAPSHOT_POLL_INTERVAL_MS ?? DEFAULT_POLL_INTERVAL_MS);
const pollingEnabled = process.env.SNAPSHOT_POLL_ENABLED !== "0";
const service = createSnapshotService({
  cacheTtlMs
});
const server = createApiServer({
  service
});
const scheduler = createSnapshotScheduler({
  service,
  intervalMs: pollIntervalMs,
  enabled: pollingEnabled
});

server.listen(port, () => {
  console.log(`GPU availability API listening on http://127.0.0.1:${port}`);
  scheduler.start();
});
