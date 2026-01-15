import path from "path";
import { mkdir, readFile, writeFile } from "fs/promises";
import { scanSourceFiles } from "./scanFiles";
import { summarizeFile } from "./llmClient";

export async function buildIndex(projectRoot: string, outDir: string): Promise<void> {
  const files = await scanSourceFiles(projectRoot);

  for (const absolutePath of files) {
    const relativePath = path.relative(projectRoot, absolutePath);
    const { dir, name } = path.parse(relativePath);

    const targetDir = path.join(outDir, "domains", dir);
    const targetPath = path.join(targetDir, `${name}_api.md`);

    await mkdir(targetDir, { recursive: true });

    const code = await readFile(absolutePath, "utf8");
    const markdown = await summarizeFile(code, relativePath);

    await writeFile(targetPath, markdown, "utf8");
  }
}

// Backward-compatible alias for callers still using the old name.
export const buildStubIndex = buildIndex;
