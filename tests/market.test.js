import test from "node:test";
import assert from "node:assert/strict";
import {
  buildLiveDataset,
  buildRunpodGpuQuery,
  buildVastUrl,
  fetchRunpodSnapshot,
  fetchVastSnapshot,
  formatGeneratedAt,
  median,
  roundTo,
  serializeDataset
} from "../src/market.js";

function jsonResponse(payload, { ok = true, status = 200 } = {}) {
  return {
    ok,
    status,
    async json() {
      return payload;
    }
  };
}

function extractRunpodId(body) {
  const query = JSON.parse(body).query;
  return /id: "([^"]+)"/.exec(query)?.[1] ?? null;
}

function createRunpodFetch(recordsById) {
  return async (url, options = {}) => {
    assert.equal(url, "https://api.runpod.io/graphql");
    assert.equal(options.method, "POST");
    assert.equal(options.headers["content-type"], "application/json");

    const id = extractRunpodId(options.body);
    const record = id === null ? null : recordsById[id] ?? null;

    return jsonResponse({
      data: {
        gpuTypes: record ? [record] : []
      }
    });
  };
}

test("utility helpers build stable live-source request metadata", () => {
  assert.equal(roundTo(12.3456), 12.35);
  assert.equal(median([]), null);
  assert.equal(median([1, 9, 5]), 5);
  assert.equal(median([2.4, 2.6]), 2.5);
  assert.match(formatGeneratedAt("2026-03-10T15:30:00.000Z"), /Mar 10, 2026/);

  const runpodQuery = JSON.parse(buildRunpodGpuQuery("NVIDIA H100 PCIe")).query;
  assert.match(runpodQuery, /gpuTypes/);
  assert.match(runpodQuery, /NVIDIA H100 PCIe/);

  const url = new URL(buildVastUrl());
  assert.equal(url.origin, "https://cloud.vast.ai");
  assert.equal(url.pathname, "/api/v0/bundles/");

  const vastQuery = JSON.parse(url.searchParams.get("q"));
  assert.equal(vastQuery.verified.eq, true);
  assert.equal(vastQuery.external.eq, false);
  assert.equal(vastQuery.rentable.eq, true);
  assert.ok(vastQuery.gpu_name.in.includes("B200"));

  const serialized = serializeDataset({ title: "Live" });
  assert.deepEqual(JSON.parse(serialized), { title: "Live" });
});

test("fetchRunpodSnapshot aggregates live variants and price fallbacks", async () => {
  const snapshot = await fetchRunpodSnapshot(
    createRunpodFetch({
      "NVIDIA A100 80GB PCIe": {
        displayName: "A100 PCIe",
        memoryInGb: 80,
        securePrice: 1.4,
        communityPrice: 1.3,
        maxGpuCountCommunityCloud: 2,
        lowestPrice: null
      },
      "NVIDIA A100-SXM4-80GB": {
        displayName: "A100 SXM4",
        memoryInGb: 80,
        securePrice: 1.7,
        communityPrice: 1.5,
        maxGpuCountCommunityCloud: 4,
        lowestPrice: {
          stockStatus: "High",
          maxUnreservedGpuCount: 4,
          availableGpuCounts: [1, 2, 4],
          minimumBidPrice: 1.1,
          uninterruptablePrice: 1.6
        }
      },
      "NVIDIA H100 80GB HBM3": {
        displayName: "H100 HBM3",
        memoryInGb: 80,
        securePrice: 2.5,
        communityPrice: null,
        maxGpuCountCommunityCloud: 1,
        lowestPrice: null
      },
      "NVIDIA B200": {
        displayName: "B200",
        memoryInGb: 180,
        securePrice: null,
        communityPrice: null,
        maxGpuCountCommunityCloud: 1,
        lowestPrice: {
          stockStatus: null,
          maxUnreservedGpuCount: 3,
          availableGpuCounts: [1, 2],
          minimumBidPrice: null,
          uninterruptablePrice: 4.99
        }
      }
    })
  );

  assert.equal(snapshot.providerId, "runpod");
  assert.equal(snapshot.liveAvailabilityType, "official stock metadata");
  assert.equal(snapshot.chips.A100.availableUnits, 4);
  assert.equal(snapshot.chips.A100.cheapestPrice, 1.1);
  assert.equal(snapshot.chips.A100.stockStatus, "High");
  assert.equal(snapshot.chips.A100.detailLabel, "Deployable sizes: 1, 2, 4 GPU");
  assert.deepEqual(snapshot.chips.A100.variants, ["A100 PCIe", "A100 SXM4"]);

  assert.equal(snapshot.chips.H100.availableUnits, 0);
  assert.equal(snapshot.chips.H100.cheapestPrice, 2.5);
  assert.equal(snapshot.chips.H100.stockStatus, "None");
  assert.equal(snapshot.chips.H100.detailLabel, "No public community-cloud sizes exposed");

  assert.equal(snapshot.chips.B200.availableUnits, 3);
  assert.equal(snapshot.chips.B200.cheapestPrice, 4.99);
  assert.equal(snapshot.chips.B200.stockStatus, "Medium");
});

test("fetchRunpodSnapshot preserves null prices when no public rate fields exist", async () => {
  const snapshot = await fetchRunpodSnapshot(
    createRunpodFetch({
      "NVIDIA A100 80GB PCIe": {
        displayName: "A100 PCIe",
        memoryInGb: 80,
        securePrice: null,
        communityPrice: null,
        maxGpuCountCommunityCloud: 1,
        lowestPrice: {
          stockStatus: null,
          maxUnreservedGpuCount: 0,
          availableGpuCounts: [],
          minimumBidPrice: null,
          uninterruptablePrice: null
        }
      }
    })
  );

  assert.equal(snapshot.chips.A100.cheapestPrice, null);
  assert.equal(snapshot.chips.A100.medianPrice, null);
  assert.equal(snapshot.chips.A100.stockStatus, "None");
});

test("fetchRunpodSnapshot surfaces non-ok responses", async () => {
  await assert.rejects(
    () =>
      fetchRunpodSnapshot(async () =>
        jsonResponse(
          {},
          {
            ok: false,
            status: 503
          }
        )
      ),
    /Request failed with status 503/
  );
});

test("fetchVastSnapshot groups verified offers by tracked chip families", async () => {
  const snapshot = await fetchVastSnapshot(async (url, options = {}) => {
    assert.match(url, /cloud\.vast\.ai\/api\/v0\/bundles/);
    assert.equal(options.headers["user-agent"], "gpu-availability/1.0");

    return jsonResponse({
      offers: [
        {
          gpu_name: "A100 SXM4",
          num_gpus: 6,
          search: { totalHour: 2.6 }
        },
        {
          gpu_name: "A100 PCIe",
          num_gpus: 3,
          dph_total: 2.4
        },
        {
          gpu_name: "H100 SXM",
          num_gpus: 2
        },
        {
          gpu_name: "RTX 4090",
          num_gpus: 8,
          search: { totalHour: 0.5 }
        }
      ]
    });
  });

  assert.equal(snapshot.providerId, "vast");
  assert.equal(snapshot.liveAvailabilityType, "verified rentable marketplace offers");
  assert.equal(snapshot.chips.A100.availableUnits, 9);
  assert.equal(snapshot.chips.A100.cheapestPrice, 2.4);
  assert.equal(snapshot.chips.A100.medianPrice, 2.5);
  assert.equal(snapshot.chips.A100.stockStatus, "High");
  assert.equal(snapshot.chips.A100.detailLabel, "2 verified rentable offers");
  assert.deepEqual(snapshot.chips.A100.variants, ["A100 PCIe", "A100 SXM4"]);

  assert.equal(snapshot.chips.H100.availableUnits, 2);
  assert.equal(snapshot.chips.H100.cheapestPrice, null);
  assert.equal(snapshot.chips.H100.medianPrice, null);
  assert.equal(snapshot.chips.H100.stockStatus, "Low");

  assert.equal(snapshot.chips.B200.availableUnits, 0);
  assert.equal(snapshot.chips.B200.detailLabel, "No verified rentable offers returned");
});

test("fetchVastSnapshot tolerates missing offers arrays", async () => {
  const snapshot = await fetchVastSnapshot(async () => jsonResponse({}));

  assert.equal(snapshot.chips.A100.availableUnits, 0);
  assert.equal(snapshot.chips.H100.offerCount, 0);
  assert.equal(snapshot.chips.B200.cheapestPrice, null);
});

test("buildLiveDataset assembles chart-ready live rollups from both sources", async () => {
  const dataset = await buildLiveDataset({
    fetchImpl: async (url, options = {}) => {
      if (url === "https://api.runpod.io/graphql") {
        const id = extractRunpodId(options.body);

        return jsonResponse({
          data: {
            gpuTypes: [
              {
                "NVIDIA A100 80GB PCIe": {
                  displayName: "A100 PCIe",
                  memoryInGb: 80,
                  securePrice: 1.4,
                  communityPrice: 1.2,
                  lowestPrice: null
                },
                "NVIDIA A100-SXM4-80GB": {
                  displayName: "A100 SXM4",
                  memoryInGb: 80,
                  securePrice: 1.7,
                  communityPrice: 1.6,
                  lowestPrice: {
                    stockStatus: "Low",
                    maxUnreservedGpuCount: 2,
                    availableGpuCounts: [1, 2],
                    minimumBidPrice: 1.05,
                    uninterruptablePrice: 1.55
                  }
                },
                "NVIDIA H100 80GB HBM3": {
                  displayName: "H100 HBM3",
                  memoryInGb: 80,
                  securePrice: null,
                  communityPrice: null,
                  lowestPrice: {
                    stockStatus: null,
                    maxUnreservedGpuCount: 1,
                    availableGpuCounts: [1],
                    minimumBidPrice: null,
                    uninterruptablePrice: null
                  }
                },
                "NVIDIA H100 PCIe": {
                  displayName: "H100 PCIe",
                  memoryInGb: 80,
                  securePrice: null,
                  communityPrice: null,
                  lowestPrice: null
                },
                "NVIDIA B200": {
                  displayName: "B200",
                  memoryInGb: 180,
                  securePrice: null,
                  communityPrice: null,
                  lowestPrice: {
                    stockStatus: null,
                    maxUnreservedGpuCount: 0,
                    availableGpuCounts: [],
                    minimumBidPrice: null,
                    uninterruptablePrice: null
                  }
                }
              }[id]
            ].filter(Boolean)
          }
        });
      }

      return jsonResponse({
        offers: [
          {
            gpu_name: "A100 SXM",
            num_gpus: 7,
            search: { totalHour: 2.1 }
          },
          {
            gpu_name: "H100 PCIe",
            num_gpus: 2
          }
        ]
      });
    }
  });

  assert.equal(dataset.title, "Live GPU Availability Snapshot");
  assert.equal(dataset.subtitle.includes("RunPod and Vast.ai"), true);
  assert.equal(dataset.generatedAtLabel, formatGeneratedAt(dataset.generatedAt));
  assert.equal(dataset.sources.length, 2);
  assert.deepEqual(dataset.sourceFailures, []);
  assert.equal(dataset.sourceGaps.length, 3);
  assert.equal(dataset.providerLegend.length, 2);
  assert.equal(dataset.maxAvailableUnits, 7);

  assert.equal(dataset.chips[0].label, "A100");
  assert.equal(dataset.chips[0].totalAvailableUnits, 9);
  assert.equal(dataset.chips[0].totalOfferCount, 3);
  assert.equal(dataset.chips[0].cheapestObservedPrice, 1.05);

  assert.equal(dataset.chips[1].label, "H100");
  assert.equal(dataset.chips[1].totalAvailableUnits, 3);
  assert.equal(dataset.chips[1].cheapestObservedPrice, null);

  assert.equal(dataset.chips[2].label, "B200");
  assert.equal(dataset.chips[2].totalAvailableUnits, 0);
  assert.equal(dataset.chips[2].cheapestObservedPrice, null);
});

test("buildLiveDataset records Error-backed source failures while keeping reachable live data", async () => {
  const dataset = await buildLiveDataset({
    fetchImpl: async (url, options) => {
      if (url.includes("cloud.vast.ai")) {
        throw new Error("vast unavailable");
      }

      return createRunpodFetch({
        "NVIDIA A100 80GB PCIe": {
          displayName: "A100 PCIe",
          securePrice: 1.3,
          communityPrice: 1.2,
          lowestPrice: null
        }
      })(url, options);
    }
  });

  assert.equal(dataset.sources.length, 1);
  assert.deepEqual(dataset.sourceFailures, ["vast unavailable"]);
  assert.equal(dataset.chips[0].providers.length, 1);
});

test("buildLiveDataset records string-backed source failures while keeping reachable live data", async () => {
  const dataset = await buildLiveDataset({
    fetchImpl: async (url) => {
      if (url === "https://api.runpod.io/graphql") {
        throw "runpod offline";
      }

      return jsonResponse({
        offers: [
          {
            gpu_name: "B200",
            num_gpus: 1,
            search: { totalHour: 5.5 }
          }
        ]
      });
    }
  });

  assert.equal(dataset.sources.length, 1);
  assert.deepEqual(dataset.sourceFailures, ["runpod offline"]);
  assert.equal(dataset.chips[2].totalAvailableUnits, 1);
  assert.equal(dataset.maxAvailableUnits, 1);
});

test("buildLiveDataset throws when no live provider sources succeed", async () => {
  await assert.rejects(
    () =>
      buildLiveDataset({
        fetchImpl: async (url) => {
          if (url === "https://api.runpod.io/graphql") {
            throw new Error("runpod down");
          }

          throw "vast down";
        }
      }),
    /No live provider sources succeeded/
  );
});
