export const CHIPS = Object.freeze(["A100", "H100", "B200"]);

export const CHIP_META = Object.freeze({
  A100: Object.freeze({
    label: "A100",
    color: "#ff7a18",
    accentColor: "#ffd3a1",
    summary: "Legacy training inventory is the loosest of the tracked accelerator set."
  }),
  H100: Object.freeze({
    label: "H100",
    color: "#1fbba6",
    accentColor: "#8ff0dc",
    summary: "Flagship Hopper supply is present, but public on-demand depth remains uneven."
  }),
  B200: Object.freeze({
    label: "B200",
    color: "#6b8cff",
    accentColor: "#d3dcff",
    summary: "Blackwell capacity is visible publicly, but current live depth is still thin."
  })
});

export const PROVIDER_META = Object.freeze({
  runpod: Object.freeze({
    id: "runpod",
    name: "RunPod",
    color: "#ff6b35",
    liveAvailabilityType: "official stock metadata"
  }),
  vast: Object.freeze({
    id: "vast",
    name: "Vast.ai",
    color: "#111111",
    liveAvailabilityType: "verified rentable marketplace offers"
  })
});

export const RUNPOD_GPU_IDS = Object.freeze({
  A100: Object.freeze(["NVIDIA A100 80GB PCIe", "NVIDIA A100-SXM4-80GB"]),
  H100: Object.freeze(["NVIDIA H100 80GB HBM3", "NVIDIA H100 PCIe"]),
  B200: Object.freeze(["NVIDIA B200"])
});

export const VAST_GPU_NAMES = Object.freeze({
  A100: Object.freeze(["A100 SXM", "A100 PCIe", "A100 SXM4", "A100 80GB PCIe"]),
  H100: Object.freeze(["H100 SXM", "H100 PCIe"]),
  B200: Object.freeze(["B200"])
});

export const SOURCE_GAPS = Object.freeze([
  "Lambda exposes current self-serve pricing publicly, but not unauthenticated live availability counts.",
  "TensorDock's public deploy surface returned an internal server error during collection on March 10, 2026.",
  "CoreWeave's public site does not expose unauthenticated on-demand availability counts."
]);

function quoteGraphqlString(value) {
  return JSON.stringify(value);
}

export function roundTo(value, decimals = 2) {
  const factor = 10 ** decimals;
  return Math.round(value * factor) / factor;
}

export function median(values) {
  if (values.length === 0) {
    return null;
  }

  const sorted = [...values].sort((left, right) => left - right);
  const middle = Math.floor(sorted.length / 2);

  if (sorted.length % 2 === 0) {
    return roundTo((sorted[middle - 1] + sorted[middle]) / 2);
  }

  return roundTo(sorted[middle]);
}

export function formatGeneratedAt(isoString) {
  return new Intl.DateTimeFormat("en-US", {
    dateStyle: "medium",
    timeStyle: "short",
    timeZone: "UTC"
  }).format(new Date(isoString));
}

function deriveStockStatus(availableUnits) {
  if (availableUnits >= 8) {
    return "High";
  }

  if (availableUnits >= 3) {
    return "Medium";
  }

  if (availableUnits >= 1) {
    return "Low";
  }

  return "None";
}

async function fetchJson(url, options, fetchImpl) {
  const response = await fetchImpl(url, options);

  if (!response.ok) {
    throw new Error(`Request failed with status ${response.status}`);
  }

  return response.json();
}

export function buildRunpodGpuQuery(id) {
  return JSON.stringify({
    query: `query {
      gpuTypes(input: { id: ${quoteGraphqlString(id)} }) {
        id
        displayName
        memoryInGb
        securePrice
        communityPrice
        maxGpuCountCommunityCloud
        lowestPrice(input: {
          compliance: null,
          dataCenterId: null,
          globalNetwork: false,
          gpuCount: 1,
          minDisk: 0,
          minMemoryInGb: 8,
          minVcpuCount: 2,
          secureCloud: true
        }) {
          stockStatus
          maxUnreservedGpuCount
          availableGpuCounts
          minimumBidPrice
          uninterruptablePrice
        }
      }
    }`
  });
}

export function buildVastUrl() {
  const query = {
    verified: { eq: true },
    external: { eq: false },
    rentable: { eq: true },
    gpu_name: {
      in: [...new Set(Object.values(VAST_GPU_NAMES).flat())]
    }
  };
  const url = new URL("https://cloud.vast.ai/api/v0/bundles/");
  url.searchParams.set("q", JSON.stringify(query));
  return url.toString();
}

function normalizeRunpodChip(variants, chip) {
  const availableUnits = variants.reduce(
    (sum, variant) => sum + (variant.lowestPrice?.maxUnreservedGpuCount ?? 0),
    0
  );
  const deploymentSizes = [...new Set(variants.flatMap((variant) => variant.lowestPrice?.availableGpuCounts ?? []))]
    .sort((left, right) => left - right);
  const cheapestPrice = variants.reduce((lowest, variant) => {
    const candidate =
      variant.lowestPrice?.minimumBidPrice ??
      variant.lowestPrice?.uninterruptablePrice ??
      variant.communityPrice ??
      variant.securePrice ??
      null;

    if (candidate === null) {
      return lowest;
    }

    if (lowest === null || candidate < lowest) {
      return candidate;
    }

    return lowest;
  }, null);

  return {
    chip,
    providerId: PROVIDER_META.runpod.id,
    providerName: PROVIDER_META.runpod.name,
    providerColor: PROVIDER_META.runpod.color,
    availableUnits,
    offerCount: variants.length,
    cheapestPrice,
    medianPrice: cheapestPrice,
    stockStatus:
      variants.find((variant) => variant.lowestPrice?.stockStatus)?.lowestPrice?.stockStatus ??
      deriveStockStatus(availableUnits),
    detailLabel:
      deploymentSizes.length > 0
        ? `Deployable sizes: ${deploymentSizes.join(", ")} GPU`
        : "No public community-cloud sizes exposed",
    variants: variants.map((variant) => variant.displayName)
  };
}

export async function fetchRunpodSnapshot(fetchImpl = fetch) {
  const results = {};

  for (const chip of CHIPS) {
    const variants = [];

    for (const id of RUNPOD_GPU_IDS[chip]) {
      const payload = await fetchJson(
        "https://api.runpod.io/graphql",
        {
          method: "POST",
          headers: {
            "content-type": "application/json"
          },
          body: buildRunpodGpuQuery(id)
        },
        fetchImpl
      );

      const record = payload.data?.gpuTypes?.[0];

      if (record) {
        variants.push(record);
      }
    }

    results[chip] = normalizeRunpodChip(variants, chip);
  }

  return {
    providerId: PROVIDER_META.runpod.id,
    providerName: PROVIDER_META.runpod.name,
    liveAvailabilityType: PROVIDER_META.runpod.liveAvailabilityType,
    chips: results
  };
}

function matchVastChip(gpuName) {
  return CHIPS.find((chip) => VAST_GPU_NAMES[chip].some((needle) => gpuName.includes(needle))) ?? null;
}

function normalizeVastChip(offers, chip) {
  const prices = offers
    .map((offer) => offer.search?.totalHour ?? offer.dph_total ?? null)
    .filter((value) => value !== null);
  const availableUnits = offers.reduce((sum, offer) => sum + (offer.num_gpus ?? 0), 0);
  const cheapestPrice = prices.length === 0 ? null : roundTo(Math.min(...prices));

  return {
    chip,
    providerId: PROVIDER_META.vast.id,
    providerName: PROVIDER_META.vast.name,
    providerColor: PROVIDER_META.vast.color,
    availableUnits,
    offerCount: offers.length,
    cheapestPrice,
    medianPrice: median(prices),
    stockStatus: deriveStockStatus(availableUnits),
    detailLabel:
      offers.length === 0 ? "No verified rentable offers returned" : `${offers.length} verified rentable offers`,
    variants: [...new Set(offers.map((offer) => offer.gpu_name))].sort()
  };
}

export async function fetchVastSnapshot(fetchImpl = fetch) {
  const payload = await fetchJson(
    buildVastUrl(),
    {
      headers: {
        "user-agent": "gpu-availability/1.0"
      }
    },
    fetchImpl
  );
  const buckets = Object.fromEntries(CHIPS.map((chip) => [chip, []]));

  for (const offer of payload.offers ?? []) {
    const chip = matchVastChip(offer.gpu_name ?? "");

    if (chip) {
      buckets[chip].push(offer);
    }
  }

  return {
    providerId: PROVIDER_META.vast.id,
    providerName: PROVIDER_META.vast.name,
    liveAvailabilityType: PROVIDER_META.vast.liveAvailabilityType,
    chips: Object.fromEntries(CHIPS.map((chip) => [chip, normalizeVastChip(buckets[chip], chip)]))
  };
}

function buildChipRollup(sourceSnapshots, chip) {
  const providers = sourceSnapshots.map((snapshot) => snapshot.chips[chip]);
  const prices = providers
    .map((provider) => provider.cheapestPrice)
    .filter((value) => value !== null);

  return {
    chip,
    label: CHIP_META[chip].label,
    color: CHIP_META[chip].color,
    accentColor: CHIP_META[chip].accentColor,
    summary: CHIP_META[chip].summary,
    totalAvailableUnits: providers.reduce((sum, provider) => sum + provider.availableUnits, 0),
    totalOfferCount: providers.reduce((sum, provider) => sum + provider.offerCount, 0),
    cheapestObservedPrice: prices.length === 0 ? null : roundTo(Math.min(...prices)),
    providers
  };
}

export async function buildLiveDataset({ fetchImpl = fetch } = {}) {
  const generatedAt = new Date().toISOString();
  const sourceAttempts = await Promise.allSettled([
    fetchRunpodSnapshot(fetchImpl),
    fetchVastSnapshot(fetchImpl)
  ]);
  const fulfilled = sourceAttempts
    .filter((attempt) => attempt.status === "fulfilled")
    .map((attempt) => attempt.value);
  const failures = sourceAttempts
    .filter((attempt) => attempt.status === "rejected")
    .map((attempt) => String(attempt.reason instanceof Error ? attempt.reason.message : attempt.reason));

  if (fulfilled.length === 0) {
    throw new Error("No live provider sources succeeded");
  }

  const chips = CHIPS.map((chip) => buildChipRollup(fulfilled, chip));

  return {
    title: "Live GPU Availability Snapshot",
    subtitle:
      "Current publicly reachable GPU availability from official RunPod and Vast.ai endpoints.",
    generatedAt,
    generatedAtLabel: formatGeneratedAt(generatedAt),
    chartLabel: "Observable live units",
    methodology: [
      "RunPod data comes from the official GraphQL gpuTypes endpoint using current stock status, max unreserved GPU counts, and current price fields.",
      "Vast.ai data comes from the official /api/v0/bundles endpoint filtered to verified, non-external, currently rentable offers for A100, H100, and B200 listings.",
      "Observable live units are comparable directional indicators, not identical capacity definitions across providers."
    ],
    sources: fulfilled.map((snapshot) => ({
      id: snapshot.providerId,
      name: snapshot.providerName,
      liveAvailabilityType: snapshot.liveAvailabilityType
    })),
    sourceFailures: failures,
    sourceGaps: [...SOURCE_GAPS],
    chips,
    maxAvailableUnits: Math.max(...chips.flatMap((chip) => chip.providers.map((provider) => provider.availableUnits))),
    providerLegend: Object.values(PROVIDER_META).map(({ id, name, color }) => ({ id, name, color }))
  };
}

export function serializeDataset(dataset) {
  return JSON.stringify(dataset, null, 2);
}
