import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  buildHistoryResponse,
  createHistoryStore,
  DEFAULT_HISTORY_FILE_URL,
  DEFAULT_HISTORY_LIMIT,
  DEFAULT_MAX_HISTORY_ENTRIES,
  normalizeLimit,
  summarizeSnapshot
} from "../src/history.js";

function createSnapshot(id, units) {
  return {
    generatedAt: `2026-03-10T00:0${id}:00.000Z`,
    generatedAtLabel: `Mar 10, 2026, 12:0${id} AM`,
    chips: [
      {
        chip: "A100",
        label: "A100",
        color: "#ff7a18",
        totalAvailableUnits: units.A100,
        cheapestObservedPrice: 1.1
      },
      {
        chip: "H100",
        label: "H100",
        color: "#1fbba6",
        totalAvailableUnits: units.H100,
        cheapestObservedPrice: 2.2
      },
      {
        chip: "B200",
        label: "B200",
        color: "#6b8cff",
        totalAvailableUnits: units.B200,
        cheapestObservedPrice: null
      }
    ]
  };
}

test("history defaults expose stable storage values", () => {
  assert.ok(DEFAULT_HISTORY_FILE_URL.href.endsWith("/generated/history/snapshots.jsonl"));
  assert.equal(DEFAULT_HISTORY_LIMIT, 96);
  assert.equal(DEFAULT_MAX_HISTORY_ENTRIES, 2_000);
});

test("normalizeLimit validates integer query values", () => {
  assert.equal(normalizeLimit("12"), 12);
  assert.equal(normalizeLimit("-3", 7), 7);
  assert.equal(normalizeLimit("bogus", 5), 5);
});

test("summarizeSnapshot and buildHistoryResponse normalize snapshot history", () => {
  const summary = summarizeSnapshot(
    createSnapshot(1, {
      A100: 8,
      H100: 4,
      B200: 1
    })
  );
  const history = buildHistoryResponse(
    [
      {
        generatedAt: "2026-03-10T00:02:00.000Z",
        generatedAtLabel: "Mar 10, 2026, 12:02 AM",
        chips: [{ chip: "A100", label: "A100", color: "#ff7a18", totalAvailableUnits: 3, cheapestObservedPrice: 1.4 }]
      },
      {
        generatedAt: "2026-03-10T00:01:00.000Z",
        generatedAtLabel: "Mar 10, 2026, 12:01 AM",
        chips: [{ chip: "H100", label: "H100", color: "#1fbba6", totalAvailableUnits: 5, cheapestObservedPrice: 2.8 }]
      }
    ],
    { limit: "7" }
  );

  assert.equal(summary.generatedAt, "2026-03-10T00:01:00.000Z");
  assert.equal(summary.chips[2].cheapestObservedPrice, null);
  assert.equal(history.count, 2);
  assert.equal(history.limit, 7);
  assert.equal(history.latestGeneratedAt, "2026-03-10T00:02:00.000Z");
  assert.equal(history.series[0].points[0].totalAvailableUnits, 0);
  assert.equal(history.series[1].points[0].totalAvailableUnits, 5);
  assert.equal(history.series[2].points[1].cheapestObservedPrice, null);
});

test("createHistoryStore records snapshots, deduplicates generatedAt values, trims retention, and serves history", async () => {
  const directory = await mkdtemp(join(tmpdir(), "gpu-history-"));
  const fileUrl = new URL(`file://${directory}/snapshots.jsonl`);
  const store = createHistoryStore({
    fileUrl,
    maxEntries: 2
  });

  await store.recordSnapshot(
    createSnapshot(1, {
      A100: 3,
      H100: 4,
      B200: 1
    })
  );
  await store.recordSnapshot(
    createSnapshot(1, {
      A100: 9,
      H100: 9,
      B200: 9
    })
  );
  await store.recordSnapshot(
    createSnapshot(2, {
      A100: 5,
      H100: 6,
      B200: 2
    })
  );
  const third = await store.recordSnapshot(
    createSnapshot(3, {
      A100: 7,
      H100: 8,
      B200: 3
    })
  );

  const history = await store.getHistory({
    limit: 5
  });
  const persisted = await readFile(fileUrl, "utf8");

  assert.equal(third.generatedAt, "2026-03-10T00:03:00.000Z");
  assert.equal(history.count, 2);
  assert.equal(history.snapshots[0].generatedAt, "2026-03-10T00:02:00.000Z");
  assert.equal(history.snapshots[1].generatedAt, "2026-03-10T00:03:00.000Z");
  assert.equal(persisted.trim().split("\n").length, 2);
});
