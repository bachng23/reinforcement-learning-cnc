import { readFile, writeFile } from "node:fs/promises";
import { compile } from "json-schema-to-typescript";

const contract = JSON.parse(await readFile(new URL("../../contracts/v3/operations-http.openapi.json", import.meta.url), "utf8"));
const definitions = Object.fromEntries(Object.entries(contract.components.schemas).filter(([name]) => name.startsWith("WorkOrder")));
// Mechanical reference relocation only. Preserve every producer field/null/enum.
const schema = JSON.parse(JSON.stringify({ type: "object", additionalProperties: false, definitions }).replaceAll("#/components/schemas/", "#/definitions/"));
const output = await compile(schema, "WorkOrderContractCatalog", {
  bannerComment: "/* Generated from contracts/v3/operations-http.openapi.json WorkOrder schemas. Do not edit. */",
  unreachableDefinitions: true, maxItems: -1,
});
for (const [file, value] of [["../types/generated/work-orders.ts", output], ["../types/generated/work-orders.schema.json", JSON.stringify(schema, null, 2) + "\n"]]) {
  const target = new URL(file, import.meta.url);
  if (process.argv.includes("--check")) {
    const current = await readFile(target, "utf8").catch(() => "");
    if (current.replace(/\r\n/g, "\n") !== value.replace(/\r\n/g, "\n")) { console.error(`Work Order generated contract drift: ${file}`); process.exitCode = 1; }
  } else await writeFile(target, value);
}
