import path from "path";
import fg from "fast-glob";
import { readFile } from "fs/promises";

export type SkillSearchResult = {
  path: string;
  score: number;
  title: string;
  preview: string;
};

function countOccurrences(haystack: string, needle: string): number {
  if (!needle) return 0;
  let count = 0;
  let index = 0;
  while (index !== -1) {
    index = haystack.indexOf(needle, index);
    if (index !== -1) {
      count += 1;
      index += needle.length || 1;
    }
  }
  return count;
}

function extractTitle(firstLine: string, fallback: string): string {
  const trimmed = firstLine.trim();
  if (trimmed.startsWith("# ")) {
    return trimmed.slice(2).trim();
  }
  return fallback;
}

export async function searchSkills(indexRoot: string, query: string): Promise<SkillSearchResult[]> {
  const lowerQuery = query.toLowerCase();
  const entries = await fg("**/*.md", {
    cwd: indexRoot,
    absolute: true,
    dot: false,
    ignore: [".meta.json"]
  });

  const results: SkillSearchResult[] = [];

  for (const absolutePath of entries) {
    const content = await readFile(absolutePath, "utf8");
    const relativePath = path.relative(indexRoot, absolutePath);
    const [firstLine = ""] = content.split("\n");
    const title = extractTitle(firstLine, relativePath);

    let score = 0;
    if (lowerQuery && title.toLowerCase().includes(lowerQuery)) {
      score += 3;
    }
    if (lowerQuery) {
      const occurrences = countOccurrences(content.toLowerCase(), lowerQuery);
      score += occurrences;
    }

    const preview = content.slice(0, 240);

    results.push({
      path: relativePath,
      score,
      title,
      preview
    });
  }

  results.sort((a, b) => b.score - a.score);
  return results;
}
