import { readFile, writeFile, mkdir } from "node:fs/promises";
import { createHash } from "node:crypto";
import { compile } from "json-schema-to-typescript";

const dependency = "c4d849492f02f082677835832fca7c2957735733";
const root = new URL("../", import.meta.url);
const source = new URL("../backend/docs/scenario-planning.openapi.json", root);
const raw = (await readFile(source, "utf8")).replace(/\r\n/g, "\n");
if (
  createHash("sha256").update(raw).digest("hex") !==
  "5e4f7676d18e3a7e88c49599887caae4ba0efd311193249e8da8301677a0b6c4"
)
  throw new Error(
    "Scenario producer changed; review the pinned dependency SHA and schema hash before regeneration",
  );
const contract = JSON.parse(raw);
const definitions = { ...contract.components.schemas };
for (const [path, methods] of Object.entries(contract.paths))
  for (const [method, operation] of Object.entries(methods)) {
    const name = `${method}_${path}`
      .replace(/\{([^}]+)\}/g, "by_$1")
      .replace(/[^a-zA-Z0-9]+/g, "_")
      .replace(/_$/, "");
    for (const [status, response] of Object.entries(operation.responses))
      if (status.startsWith("2"))
        definitions[name] = response.content["application/json"].schema;
  }
const schema = JSON.parse(
  JSON.stringify({
    type: "object",
    additionalProperties: false,
    definitions,
  }).replaceAll("#/components/schemas/", "#/definitions/"),
);
const types = await compile(schema, "ScenarioProposalCatalog", {
  bannerComment: `/* Generated from Backend + canonical Python ${dependency}. Do not edit. */`,
  unreachableDefinitions: true,
  maxItems: -1,
  unknownAny: true,
});
const manifest = {
  status: "INTEGRATED_CONTRACT",
  producer_sha: dependency,
  source_sha256: createHash("sha256").update(raw).digest("hex"),
  engine_result: "scenario-engine:1.0",
  comparison: "scenario-engine:1.0",
  runnable: true,
  sensitivity: true,
  live_handoff: true,
};
await mkdir(new URL("types/generated/", root), { recursive: true });
for (const [file, value] of [
  ["scenario-planning.ts", types],
  ["scenario-planning.schema.json", JSON.stringify(schema, null, 2) + "\n"],
  ["scenario-planning.manifest.json", JSON.stringify(manifest, null, 2) + "\n"],
]) {
  const target = new URL(`types/generated/${file}`, root);
  if (process.argv.includes("--check")) {
    const current = await readFile(target, "utf8").catch(() => "");
    if (current.replace(/\r\n/g, "\n") !== value.replace(/\r\n/g, "\n")) {
      console.error(`Scenario consumer drift: ${file}`);
      process.exitCode = 1;
    }
  } else await writeFile(target, value);
}
