import { readFile, writeFile, mkdir } from "node:fs/promises";
import { compile } from "json-schema-to-typescript";

const source = new URL("../../contracts/v3/operations-domain.schema.json", import.meta.url);
const target = new URL("../types/generated/operations.ts", import.meta.url);
const schema = JSON.parse(await readFile(source, "utf8"));
const output = await compile(schema, "OperationsContractCatalog", {
  bannerComment: "/* Generated from contracts/v3/operations-domain.schema.json. Do not edit. */",
  unreachableDefinitions: true,
  // Do not expand bounded lists into huge tuple unions.
  maxItems: -1,
});
if (process.argv.includes("--check")) {
  const committed = await readFile(target, "utf8").catch(() => "");
  if (committed.replace(/\r\n/g, "\n") !== output.replace(/\r\n/g, "\n")) {
    console.error("Operations TypeScript drift. Run npm --prefix frontend run contracts:generate");
    process.exitCode = 1;
  }
} else {
  await mkdir(new URL(".", target), { recursive: true });
  await writeFile(target, output);
}
