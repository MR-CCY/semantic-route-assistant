import { readFile, access } from "fs/promises";
import path from "path";
import fg from "fast-glob";
import ignore from "ignore";

async function loadIgnore(projectRoot: string): Promise<ReturnType<typeof ignore>> {
  const ig = ignore();
  const gitignorePath = path.join(projectRoot, ".gitignore");

  try {
    await access(gitignorePath);
    const content = await readFile(gitignorePath, "utf8");
    ig.add(content);
  } catch (error: any) {
    if (error?.code !== "ENOENT") {
      throw error;
    }
  }
  ig.add(["node_modules/", "**/node_modules/**"]);

  return ig;
}

export async function scanSourceFiles(projectRoot: string): Promise<string[]> {
  const ig = await loadIgnore(projectRoot);

  const matches = await fg(["**/*.h", "**/*.hpp", "**/*.cpp"], {
    cwd: projectRoot,
    onlyFiles: true,
    dot: false,
    absolute: true
  });

  const filtered = matches.filter((filePath) => {
    const relative = path.relative(projectRoot, filePath);
    return !ig.ignores(relative);
  });

  return filtered;
}
