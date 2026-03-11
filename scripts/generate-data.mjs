import { mkdir, writeFile } from "node:fs/promises";
import { buildLiveDataset, serializeDataset } from "../src/market.js";

const dataset = await buildLiveDataset();
const serialized = `${serializeDataset(dataset)}\n`;
const outputs = [
  new URL("../data/chart-data.json", import.meta.url),
  new URL("../public/chart-data.json", import.meta.url)
];

await Promise.all(
  outputs.map(async (fileUrl) => {
    await mkdir(new URL(".", fileUrl), { recursive: true });
    await writeFile(fileUrl, serialized, "utf8");
  })
);

console.log(
  `Generated live snapshot for ${dataset.chips.length} GPU families from ${dataset.sources.length} sources into ${outputs
    .map((fileUrl) => fileUrl.pathname)
    .join(", ")}`
);
