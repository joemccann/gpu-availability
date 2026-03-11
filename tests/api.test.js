import test from "node:test";
import assert from "node:assert/strict";
import {
  createApiServer,
  createSnapshotScheduler,
  createSnapshotService,
  DEFAULT_API_PORT,
  DEFAULT_CACHE_TTL_MS,
  DEFAULT_POLL_INTERVAL_MS
} from "../src/api.js";

function createFixtureDataset() {
  return {
    title: "Live GPU Availability Snapshot",
    subtitle: "Current publicly reachable GPU availability from official RunPod and Vast.ai endpoints.",
    generatedAt: "2026-03-10T00:00:00.000Z",
    generatedAtLabel: "Mar 10, 2026, 12:00 AM",
    chartLabel: "Observable live units",
    methodology: [
      "RunPod comes from official stock metadata.",
      "Vast.ai comes from verified rentable offers.",
      "Provider methodologies differ."
    ],
    sources: [
      {
        id: "runpod",
        name: "RunPod",
        liveAvailabilityType: "official stock metadata"
      },
      {
        id: "vast",
        name: "Vast.ai",
        liveAvailabilityType: "verified rentable marketplace offers"
      }
    ],
    sourceFailures: [],
    sourceGaps: [],
    maxAvailableUnits: 6,
    chips: [
      {
        chip: "A100",
        label: "A100",
        color: "#ff7a18",
        totalAvailableUnits: 8,
        totalOfferCount: 2,
        cheapestObservedPrice: 1.25
      },
      {
        chip: "H100",
        label: "H100",
        color: "#1fbba6",
        totalAvailableUnits: 3,
        totalOfferCount: 1,
        cheapestObservedPrice: 2.5
      },
      {
        chip: "B200",
        label: "B200",
        color: "#6b8cff",
        totalAvailableUnits: 1,
        totalOfferCount: 1,
        cheapestObservedPrice: null
      }
    ]
  };
}

async function listen(server) {
  await new Promise((resolve) => {
    server.listen(0, "127.0.0.1", resolve);
  });

  const address = server.address();

  return `http://127.0.0.1:${address.port}`;
}

async function close(server) {
  await new Promise((resolve, reject) => {
    server.close((error) => {
      if (error) {
        reject(error);
        return;
      }

      resolve();
    });
  });
}

test("DEFAULT_* exports expose stable API defaults", () => {
  assert.equal(DEFAULT_API_PORT, 3001);
  assert.equal(DEFAULT_CACHE_TTL_MS, 60_000);
  assert.equal(DEFAULT_POLL_INTERVAL_MS, 900_000);
});

test("createSnapshotService caches snapshots and falls back to a fresh snapshot for empty history", async () => {
  let buildCount = 0;
  let currentTime = 0;
  const recordedSnapshots = [];
  const service = createSnapshotService({
    cacheTtlMs: 60_000,
    now: () => currentTime,
    historyStore: {
      async recordSnapshot(snapshot) {
        recordedSnapshots.push(snapshot.generatedAt);
      },
      async listSnapshots() {
        return [];
      }
    },
    async buildDataset() {
      buildCount += 1;
      const dataset = createFixtureDataset();
      dataset.generatedAt = `dataset-${buildCount}`;
      return dataset;
    }
  });

  const first = await service.getSnapshot();
  const second = await service.getSnapshot();
  currentTime = 120_000;
  const third = await service.getSnapshot();
  const forced = await service.getSnapshot({ forceRefresh: true });
  service.reset();
  const history = await service.getHistory({ limit: 5 });
  const afterReset = await service.getSnapshot();

  assert.equal(first.generatedAt, "dataset-1");
  assert.equal(second.generatedAt, "dataset-1");
  assert.equal(third.generatedAt, "dataset-2");
  assert.equal(forced.generatedAt, "dataset-3");
  assert.equal(history.count, 1);
  assert.equal(history.snapshots[0].generatedAt, "dataset-4");
  assert.equal(afterReset.generatedAt, "dataset-4");
  assert.deepEqual(recordedSnapshots, [
    "dataset-1",
    "dataset-2",
    "dataset-3",
    "dataset-4"
  ]);
});

test("createSnapshotService returns stored history without rebuilding snapshots", async () => {
  let buildCount = 0;
  const service = createSnapshotService({
    historyStore: {
      async recordSnapshot() {},
      async listSnapshots({ limit }) {
        assert.equal(limit, 2);
        return [
          {
            generatedAt: "2026-03-10T00:01:00.000Z",
            generatedAtLabel: "Mar 10, 2026, 12:01 AM",
            chips: []
          },
          {
            generatedAt: "2026-03-10T00:02:00.000Z",
            generatedAtLabel: "Mar 10, 2026, 12:02 AM",
            chips: []
          }
        ];
      }
    },
    async buildDataset() {
      buildCount += 1;
      return createFixtureDataset();
    }
  });

  const history = await service.getHistory({ limit: 2 });

  assert.equal(buildCount, 0);
  assert.equal(history.count, 2);
  assert.equal(history.latestGeneratedAt, "2026-03-10T00:02:00.000Z");
});

test("createSnapshotScheduler starts polling, logs success, and can be stopped", async () => {
  const infoMessages = [];
  const errorMessages = [];
  const timerState = [];
  const originalSetInterval = globalThis.setInterval;
  const originalClearInterval = globalThis.clearInterval;
  let scheduledCallback = null;

  globalThis.setInterval = (callback, intervalMs) => {
    scheduledCallback = callback;
    timerState.push(intervalMs);
    return {
      unref() {
        timerState.push("unref");
      }
    };
  };
  globalThis.clearInterval = () => {
    timerState.push("cleared");
  };

  try {
    const scheduler = createSnapshotScheduler({
      service: {
        async recordSnapshot() {
          return {
            generatedAt: "2026-03-10T00:05:00.000Z"
          };
        }
      },
      intervalMs: 123,
      logger: {
        info(message) {
          infoMessages.push(message);
        },
        error(message) {
          errorMessages.push(message);
        }
      }
    });

    scheduler.start();
    assert.equal(scheduler.isRunning(), true);
    await Promise.resolve();
    await scheduledCallback();
    scheduler.start();
    scheduler.stop();
    scheduler.stop();

    assert.deepEqual(timerState, [123, "unref", "cleared"]);
    assert.match(infoMessages[0], /Recorded live snapshot/);
    assert.match(infoMessages[1], /Recorded live snapshot/);
    assert.deepEqual(errorMessages, []);
    assert.equal(scheduler.isRunning(), false);
  } finally {
    globalThis.setInterval = originalSetInterval;
    globalThis.clearInterval = originalClearInterval;
  }
});

test("createSnapshotScheduler handles disabled and failed polling paths", async () => {
  const errorMessages = [];
  const scheduler = createSnapshotScheduler({
    enabled: false,
    service: {
      async recordSnapshot() {
        throw new Error("offline");
      }
    },
    logger: {
      info() {},
      error(message) {
        errorMessages.push(message);
      }
    }
  });

  scheduler.start();
  assert.equal(scheduler.isRunning(), false);
  assert.equal(await scheduler.pollOnce(), null);
  assert.match(errorMessages[0], /Failed to record live snapshot: offline/);
});

test("API server exposes health, snapshot, history, method, and not-found responses", async () => {
  let buildCount = 0;
  const server = createApiServer({
    service: createSnapshotService({
      historyStore: {
        async recordSnapshot() {},
        async listSnapshots({ limit }) {
          if (limit === 3) {
            return [
              {
                generatedAt: "2026-03-10T00:01:00.000Z",
                generatedAtLabel: "Mar 10, 2026, 12:01 AM",
                chips: []
              },
              {
                generatedAt: "2026-03-10T00:02:00.000Z",
                generatedAtLabel: "Mar 10, 2026, 12:02 AM",
                chips: []
              }
            ];
          }

          return [];
        }
      },
      async buildDataset() {
        buildCount += 1;
        const dataset = createFixtureDataset();
        dataset.generatedAt = `dataset-${buildCount}`;
        return dataset;
      }
    })
  });
  const baseUrl = await listen(server);

  try {
    const healthResponse = await fetch(`${baseUrl}/health`);
    assert.equal(healthResponse.status, 200);
    assert.equal(healthResponse.headers.get("access-control-allow-origin"), "*");
    assert.deepEqual(await healthResponse.json(), {
      ok: true,
      service: "gpu-availability-api"
    });

    const snapshotResponse = await fetch(`${baseUrl}/api/live-snapshot`);
    assert.equal(snapshotResponse.status, 200);
    assert.equal(snapshotResponse.headers.get("content-type"), "application/json; charset=utf-8");
    assert.equal(snapshotResponse.headers.get("cache-control"), "no-store");
    assert.equal((await snapshotResponse.json()).generatedAt, "dataset-1");

    const cachedResponse = await fetch(`${baseUrl}/api/live-snapshot`);
    assert.equal((await cachedResponse.json()).generatedAt, "dataset-1");

    const refreshResponse = await fetch(`${baseUrl}/api/live-snapshot?refresh=1`);
    assert.equal((await refreshResponse.json()).generatedAt, "dataset-2");

    const historyResponse = await fetch(`${baseUrl}/api/history?limit=3`);
    assert.equal(historyResponse.status, 200);
    assert.equal((await historyResponse.json()).count, 2);

    const historyFallbackResponse = await fetch(`${baseUrl}/api/history?limit=bogus`);
    assert.equal((await historyFallbackResponse.json()).count, 1);

    const methodResponse = await fetch(`${baseUrl}/api/live-snapshot`, {
      method: "POST"
    });
    assert.equal(methodResponse.status, 405);
    assert.equal(methodResponse.headers.get("allow"), "GET, OPTIONS");
    assert.deepEqual(await methodResponse.json(), {
      error: "Method not allowed"
    });

    const optionsResponse = await fetch(`${baseUrl}/api/live-snapshot`, {
      method: "OPTIONS"
    });
    assert.equal(optionsResponse.status, 204);
    assert.equal(optionsResponse.headers.get("access-control-allow-methods"), "GET, OPTIONS");
    assert.equal(await optionsResponse.text(), "");

    const missingResponse = await fetch(`${baseUrl}/missing`);
    assert.equal(missingResponse.status, 404);
    assert.deepEqual(await missingResponse.json(), {
      error: "Not found"
    });

    assert.equal(buildCount, 2);
  } finally {
    await close(server);
  }
});

test("API server returns a 500 when live dataset generation fails", async () => {
  const server = createApiServer({
    service: createSnapshotService({
      historyStore: {
        async recordSnapshot() {},
        async listSnapshots() {
          return [];
        }
      },
      async buildDataset() {
        throw new Error("provider timeout");
      }
    })
  });
  const baseUrl = await listen(server);

  try {
    const response = await fetch(`${baseUrl}/api/live-snapshot`);

    assert.equal(response.status, 500);
    assert.deepEqual(await response.json(), {
      error: "provider timeout"
    });
  } finally {
    await close(server);
  }
});

test("API server returns a 500 when history lookup fails", async () => {
  const server = createApiServer({
    service: {
      async getSnapshot() {
        return createFixtureDataset();
      },
      async getHistory() {
        throw "history unavailable";
      }
    }
  });
  const baseUrl = await listen(server);

  try {
    const response = await fetch(`${baseUrl}/api/history`);

    assert.equal(response.status, 500);
    assert.deepEqual(await response.json(), {
      error: "history unavailable"
    });
  } finally {
    await close(server);
  }
});
