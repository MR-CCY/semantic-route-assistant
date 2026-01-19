import path from "path";
import { mkdir, readFile, writeFile } from "fs/promises";
import { createHash } from "crypto";
import { buildIndex as buildIndexFull } from "./buildStubIndex";
import { scanSourceFiles } from "./scanFiles";
import { summarizeFile } from "./llmClient";
import { loadMeta, saveMeta } from "./metaStore";
import { searchSkills as searchSkillsImpl } from "./searchSkills";
// v2: per-module md + routing.json (incremental)
export { buildIndexV2, updateIndexV2 } from "./indexV2";
// v3: in-memory clustering -> modules/*.md
export { buildModuleIndexV3, updateModuleIndexV3 } from "./indexV3";
export { generateSkillsFiles, removeSkillsFiles } from "./skillsGenerator";
// Skills generation config (Removed)
// export { setSkillsConfig, getSkillsConfig, DEFAULT_WHITELIST_TAGS } from "./skillsGenerator";
// export type { SkillsConfig } from "./skillsGenerator";

export { summarizeFile } from "./llmClient";
export { searchSkillsImpl as searchSkills };

export async function buildIndex(projectRoot: string, outDir: string): Promise<void> {
  await buildIndexFull(projectRoot, outDir);
}

export async function updateIndex(projectRoot: string, outDir: string): Promise<void> {
  const meta = await loadMeta(outDir);
  const files = await scanSourceFiles(projectRoot);
  const seenPaths = new Set<string>();

  for (const absolutePath of files) {
    const relativePath = path.relative(projectRoot, absolutePath);
    seenPaths.add(relativePath);

    const code = await readFile(absolutePath, "utf8");
    const hash = createHash("sha1").update(code).digest("hex");

    const metaEntry = meta[relativePath];
    const isChanged = !metaEntry || metaEntry.hash !== hash;

    if (!isChanged) {
      continue;
    }

    const { dir, name } = path.parse(relativePath);
    const targetDir = path.join(outDir, "domains", dir);
    const targetPath = path.join(targetDir, `${name}_api.md`);

    await mkdir(targetDir, { recursive: true });

    const markdown = await summarizeFile(code, relativePath);
    await writeFile(targetPath, markdown, "utf8");

    meta[relativePath] = {
      hash,
      skillDoc: markdown,
      lastUpdated: new Date().toISOString()
    };
  }

  // Clean up meta entries for files that no longer exist
  for (const relativePath of Object.keys(meta)) {
    if (!seenPaths.has(relativePath)) {
      delete meta[relativePath];
    }
  }

  await saveMeta(outDir, meta);
}

// Routing Store
export {
  ROUTING_SCHEMA_VERSION,
  loadRouting,
  saveRouting,
  incrementTagScore,
  updateSymbolDescription,
  addSymbolTag,
  removeSymbolTag,
  updateSymbolTags
} from "./routingStore";

// Export types for consumers
export type { RoutingJson, TagIndexEntry, TagType, TagChange } from "./routingStore";
