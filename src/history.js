import { mkdir, readFile, writeFile } from "node:fs/promises";
import { CHIP_META, CHIPS } from "./market.js";

export const DEFAULT_HISTORY_FILE_URL = new URL("../generated/history/snapshots.jsonl", import.meta.url);
export const DEFAULT_HISTORY_LIMIT = 96;
export const DEFAULT_MAX_HISTORY_ENTRIES = 2_000;

export function normalizeLimit(value, fallback = DEFAULT_HISTORY_LIMIT) {
  const parsed = Number(value);

  if (!Number.isInteger(parsed) || parsed <= 0) {
    return fallback;
  }

  return parsed;
}

async function ensureParentDirectory(fileUrl) {
  await mkdir(new URL(".", fileUrl), {
    recursive: true
  });
}

async function readJsonLines(fileUrl) {
  try {
    const raw = await readFile(fileUrl, "utf8");
    const lines = raw
      .split("\n")
      .map((line) => line.trim())
      .filter(Boolean);

    return lines.map((line) => JSON.parse(line));
  } catch (error) {
    if (error && typeof error === "object" && "code" in error && error.code === "ENOENT") {
      return [];
    }

    throw error;
  }
}

export function summarizeSnapshot(snapshot) {
  return {
    generatedAt: snapshot.generatedAt,
    generatedAtLabel: snapshot.generatedAtLabel,
    chips: snapshot.chips.map((chip) => ({
      chip: chip.chip,
      label: chip.label,
      color: chip.color,
      totalAvailableUnits: chip.totalAvailableUnits,
      cheapestObservedPrice: chip.cheapestObservedPrice
    }))
  };
}

export function buildHistoryResponse(snapshots, { limit = DEFAULT_HISTORY_LIMIT } = {}) {
  const ordered = [...snapshots].sort(
    (left, right) => Date.parse(left.generatedAt) - Date.parse(right.generatedAt)
  );

  return {
    count: ordered.length,
    limit: normalizeLimit(limit),
    latestGeneratedAt: ordered.at(-1)?.generatedAt ?? null,
    snapshots: ordered.map((snapshot) => summarizeSnapshot(snapshot)),
    series: CHIPS.map((chip) => ({
      chip,
      label: CHIP_META[chip].label,
      color: CHIP_META[chip].color,
      points: ordered.map((snapshot) => {
        const point =
          snapshot.chips.find((entry) => entry.chip === chip) ?? {
            totalAvailableUnits: 0,
            cheapestObservedPrice: null
          };

        return {
          generatedAt: snapshot.generatedAt,
          generatedAtLabel: snapshot.generatedAtLabel,
          totalAvailableUnits: point.totalAvailableUnits,
          cheapestObservedPrice: point.cheapestObservedPrice
        };
      })
    }))
  };
}

export function createHistoryStore({
  fileUrl = DEFAULT_HISTORY_FILE_URL,
  maxEntries = DEFAULT_MAX_HISTORY_ENTRIES
} = {}) {
  return {
    async listSnapshots({ limit = DEFAULT_HISTORY_LIMIT } = {}) {
      const snapshots = await readJsonLines(fileUrl);

      return snapshots.slice(-normalizeLimit(limit));
    },

    async recordSnapshot(snapshot) {
      const snapshots = await readJsonLines(fileUrl);

      if (snapshots.at(-1)?.generatedAt === snapshot.generatedAt) {
        return snapshot;
      }

      const nextSnapshots = [...snapshots, snapshot].slice(-maxEntries);

      await ensureParentDirectory(fileUrl);
      await writeFile(
        fileUrl,
        nextSnapshots.map((entry) => JSON.stringify(entry)).join("\n") + "\n",
        "utf8"
      );

      return snapshot;
    },

    async getHistory({ limit = DEFAULT_HISTORY_LIMIT } = {}) {
      const snapshots = await this.listSnapshots({
        limit
      });

      return buildHistoryResponse(snapshots, {
        limit
      });
    }
  };
}
