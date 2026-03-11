import { createServer } from "node:http";
import { buildLiveDataset, serializeDataset } from "./market.js";
import {
  buildHistoryResponse,
  createHistoryStore,
  DEFAULT_HISTORY_LIMIT,
  normalizeLimit
} from "./history.js";

export const DEFAULT_API_PORT = 3001;
export const DEFAULT_CACHE_TTL_MS = 60_000;
export const DEFAULT_POLL_INTERVAL_MS = 15 * 60_000;

const CORS_HEADERS = Object.freeze({
  "access-control-allow-origin": "*",
  "access-control-allow-methods": "GET, OPTIONS",
  "access-control-allow-headers": "content-type"
});

function sendJson(response, statusCode, payload, extraHeaders = {}) {
  response.writeHead(statusCode, {
    "content-type": "application/json; charset=utf-8",
    "cache-control": "no-store",
    ...CORS_HEADERS,
    ...extraHeaders
  });
  response.end(`${serializeDataset(payload)}\n`);
}

export function createSnapshotService({
  buildDataset = buildLiveDataset,
  cacheTtlMs = DEFAULT_CACHE_TTL_MS,
  now = () => Date.now(),
  historyStore = createHistoryStore()
} = {}) {
  let cache = null;

  async function buildAndStoreSnapshot() {
    const dataset = await buildDataset();

    cache = {
      createdAt: now(),
      dataset
    };

    await historyStore.recordSnapshot(dataset);

    return dataset;
  }

  return {
    async getSnapshot({ forceRefresh = false } = {}) {
      if (!forceRefresh && cache && now() - cache.createdAt < cacheTtlMs) {
        return cache.dataset;
      }

      return buildAndStoreSnapshot();
    },
    async getHistory({ limit = DEFAULT_HISTORY_LIMIT } = {}) {
      const snapshots = await historyStore.listSnapshots({
        limit
      });

      if (snapshots.length > 0) {
        return buildHistoryResponse(snapshots, {
          limit
        });
      }

      const snapshot = await this.getSnapshot();

      return buildHistoryResponse([snapshot], {
        limit
      });
    },
    async recordSnapshot() {
      return buildAndStoreSnapshot();
    },
    reset() {
      cache = null;
    }
  };
}

export function createSnapshotScheduler({
  service,
  intervalMs = DEFAULT_POLL_INTERVAL_MS,
  enabled = true,
  logger = console
}) {
  let timer = null;

  async function pollOnce() {
    try {
      const snapshot = await service.recordSnapshot();
      logger.info?.(`Recorded live snapshot at ${snapshot.generatedAt}`);
      return snapshot;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      logger.error?.(`Failed to record live snapshot: ${message}`);
      return null;
    }
  }

  return {
    async pollOnce() {
      return pollOnce();
    },
    start() {
      if (!enabled || timer) {
        return;
      }

      void pollOnce();
      timer = setInterval(() => {
        void pollOnce();
      }, intervalMs);
      timer.unref?.();
    },
    stop() {
      if (!timer) {
        return;
      }

      clearInterval(timer);
      timer = null;
    },
    isRunning() {
      return timer !== null;
    }
  };
}

export function createApiHandler({ service = createSnapshotService() } = {}) {
  return async function handler(request, response) {
    const method = request.method ?? "GET";
    const url = new URL(request.url ?? "/", "http://127.0.0.1");

    if (method === "OPTIONS") {
      response.writeHead(204, CORS_HEADERS);
      response.end();
      return;
    }

    if (method !== "GET") {
      sendJson(
        response,
        405,
        {
          error: "Method not allowed"
        },
        {
          allow: "GET, OPTIONS"
        }
      );
      return;
    }

    if (url.pathname === "/health") {
      sendJson(response, 200, {
        ok: true,
        service: "gpu-availability-api"
      });
      return;
    }

    if (url.pathname === "/api/live-snapshot") {
      try {
        const dataset = await service.getSnapshot({
          forceRefresh: url.searchParams.get("refresh") === "1"
        });
        sendJson(response, 200, dataset);
      } catch (error) {
        sendJson(response, 500, {
          error: error instanceof Error ? error.message : String(error)
        });
      }
      return;
    }

    if (url.pathname === "/api/history") {
      try {
        const history = await service.getHistory({
          limit: normalizeLimit(url.searchParams.get("limit"), DEFAULT_HISTORY_LIMIT)
        });
        sendJson(response, 200, history);
      } catch (error) {
        sendJson(response, 500, {
          error: error instanceof Error ? error.message : String(error)
        });
      }
      return;
    }

    sendJson(response, 404, {
      error: "Not found"
    });
  };
}

export function createApiServer(options = {}) {
  return createServer(createApiHandler(options));
}
