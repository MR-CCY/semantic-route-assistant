import path from "path";
import { buildIndex } from "./index";
import { scanSourceFiles } from "./scanFiles";

async function main(): Promise<void> {
  const projectRoot = process.argv[2];
  const outDirArg = process.argv[3];

  if (!projectRoot) {
    console.error("Usage: npx ts-node src/dev_buildIndex.ts <projectRoot> [outDir]");
    process.exit(1);
  }

  const outDir = outDirArg ?? path.join(projectRoot, "llm_index");

  console.log(`[buildIndex] start projectRoot=${projectRoot} outDir=${outDir}`);

  const files = await scanSourceFiles(projectRoot);
  console.log(`[buildIndex] found ${files.length} source files`);

  await buildIndex(projectRoot, outDir);

  console.log("[buildIndex] done");
}

main().catch((error) => {
  console.error("[buildIndex] failed", error);
  process.exit(1);
});
