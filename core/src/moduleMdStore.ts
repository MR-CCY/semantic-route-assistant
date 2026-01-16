import path from "path";
import { mkdir, readFile, writeFile } from "fs/promises";
import { ExtractedSymbol } from "./symbolExtractor";

export type ModuleEntry = {
  id: string;
  kind: "function" | "class";
  signature: string;
  declHash: string;
  brief: string;
  tags?: string[];
  rawLines?: string[];
};

type ParsedModule = {
  headerLines: string[];
  functions: ModuleEntry[];
  classes: ModuleEntry[];
};

const ENTRY_REGEX =
  /^\s*-\s+`([^`]+)`\s*<!--\s*id:\s*([^|]+)\s*\|\s*hash:\s*([^\s|]+)(?:\s*\|\s*file:\s*([^|]+))?(?:\s*\|\s*tags:\s*\[([^\]]*)\])?\s*-->/;
const BRIEF_CONCURRENCY = 4;

async function runWithConcurrency<T, R>(
  items: T[],
  limit: number,
  worker: (item: T, index: number) => Promise<R>
): Promise<R[]> {
  const results: R[] = new Array(items.length);
  let nextIndex = 0;

  async function runNext(): Promise<void> {
    const current = nextIndex;
    if (current >= items.length) {
      return;
    }
    nextIndex += 1;
    results[current] = await worker(items[current], current);
    await runNext();
  }

  const runners = Array.from({ length: Math.min(limit, items.length) }, () => runNext());
  await Promise.all(runners);
  return results;
}

function parseModuleMarkdown(content: string): ParsedModule {
  const lines = content.split("\n");
  const headerLines: string[] = [];
  const functions: ModuleEntry[] = [];
  const classes: ModuleEntry[] = [];

  let section: "functions" | "classes" | null = null;
  let index = 0;
  while (index < lines.length && !lines[index].startsWith("## ")) {
    headerLines.push(lines[index]);
    index += 1;
  }

  for (; index < lines.length; index += 1) {
    const line = lines[index];
    if (line.startsWith("## ")) {
      if (line.includes("Functions")) {
        section = "functions";
      } else if (line.includes("Classes")) {
        section = "classes";
      } else {
        section = null;
      }
      continue;
    }

    if (!section) {
      continue;
    }

    const match = line.match(ENTRY_REGEX);
    if (!match) {
      continue;
    }

    const signature = match[1].trim();
    const id = match[2].trim();
    const declHash = match[3].trim();
    const tagsRaw = match[5];
    const tags = tagsRaw
      ? tagsRaw
          .split(",")
          .map((tag) => tag.trim().toLowerCase())
          .filter(Boolean)
      : [];

    let end = index + 1;
    while (end < lines.length && !lines[end].startsWith("## ") && !ENTRY_REGEX.test(lines[end])) {
      end += 1;
    }

    const rawLines = lines.slice(index, end);
    const briefLine = rawLines.slice(1).find((entryLine) => entryLine.trim().length > 0);
    const brief = briefLine ? briefLine.trim() : "";

    const entry: ModuleEntry = {
      id,
      kind: section === "functions" ? "function" : "class",
      signature,
      declHash,
      brief,
      tags,
      rawLines
    };

    if (section === "functions") {
      functions.push(entry);
    } else {
      classes.push(entry);
    }

    index = end - 1;
  }

  return { headerLines, functions, classes };
}

function buildDefaultHeader(moduleName: string): string[] {
  return [`# Module: ${moduleName}`, `> TODO: module description`, ""];
}

function renderEntries(entries: ModuleEntry[]): string[] {
  const lines: string[] = [];
  for (const entry of entries) {
    if (entry.rawLines && entry.rawLines.length > 0) {
      lines.push(...entry.rawLines);
    } else {
      const brief = entry.brief || "TODO: brief description";
      const tags = (entry.tags || [])
        .map((tag) => tag.toLowerCase().trim())
        .filter(Boolean);
      const tagSegment = tags.length > 0 ? ` | tags: [${tags.join(", ")}]` : "";
      lines.push(
        `- \`${entry.signature}\` <!-- id: ${entry.id} | hash: ${entry.declHash}${tagSegment} -->`
      );
      lines.push(`  ${brief}`);
    }
    lines.push("");
  }
  return lines;
}

export async function updateModuleMarkdown(params: {
  moduleName: string;
  modulePath: string;
  symbols: ExtractedSymbol[];
  generateBrief: (input: {
    moduleName: string;
    symbol: ExtractedSymbol;
  }) => Promise<string>;
}): Promise<ModuleEntry[]> {
  const { moduleName, modulePath, symbols, generateBrief } = params;

  let existing: ParsedModule | null = null;
  try {
    const content = await readFile(modulePath, "utf8");
    existing = parseModuleMarkdown(content);
  } catch (error: any) {
    if (error?.code !== "ENOENT") {
      throw error;
    }
  }

  const headerLines = existing?.headerLines.length
    ? existing.headerLines
    : buildDefaultHeader(moduleName);

  const existingMap = new Map<string, ModuleEntry>();
  for (const entry of [...(existing?.functions ?? []), ...(existing?.classes ?? [])]) {
    existingMap.set(entry.id, entry);
  }

  const uniqueSymbols = new Map<string, ExtractedSymbol>();
  for (const symbol of symbols) {
    if (!uniqueSymbols.has(symbol.id)) {
      uniqueSymbols.set(symbol.id, symbol);
    }
  }

  const orderedSymbols = Array.from(uniqueSymbols.values()).sort((a, b) =>
    a.signature.localeCompare(b.signature)
  );

  const functionEntries: ModuleEntry[] = [];
  const classEntries: ModuleEntry[] = [];

  const briefsToGenerate: Array<{ moduleName: string; symbol: ExtractedSymbol }> = [];
  const briefById = new Map<string, string>();

  for (const symbol of orderedSymbols) {
    const existingEntry = existingMap.get(symbol.id);
    if (existingEntry && existingEntry.declHash === symbol.declHash) {
    const reusedEntry: ModuleEntry = {
      ...existingEntry,
      signature: existingEntry.signature || symbol.signature,
      kind: symbol.kind
    };
      if (symbol.kind === "function") {
        functionEntries.push(reusedEntry);
      } else {
        classEntries.push(reusedEntry);
      }
      continue;
    }

    briefsToGenerate.push({ moduleName, symbol });
  }

  if (briefsToGenerate.length > 0) {
    const results = await runWithConcurrency(briefsToGenerate, BRIEF_CONCURRENCY, async (item) => {
      const brief = await generateBrief(item);
      return { id: item.symbol.id, brief };
    });
    for (const result of results) {
      briefById.set(result.id, result.brief);
    }
  }

  for (const symbol of orderedSymbols) {
    const existingEntry = existingMap.get(symbol.id);
    if (existingEntry && existingEntry.declHash === symbol.declHash) {
      continue;
    }

    const brief = briefById.get(symbol.id) || "";
    const freshEntry: ModuleEntry = {
      id: symbol.id,
      kind: symbol.kind,
      signature: symbol.signature,
      declHash: symbol.declHash,
      brief,
      tags: (symbol as { tags?: string[] }).tags
    };

    if (symbol.kind === "function") {
      functionEntries.push(freshEntry);
    } else {
      classEntries.push(freshEntry);
    }
  }

  const lines: string[] = [];
  lines.push(...headerLines);
  if (lines.length === 0 || lines[lines.length - 1].trim() !== "") {
    lines.push("");
  }
  lines.push("## Functions", "");
  lines.push(...renderEntries(functionEntries));
  lines.push("## Classes", "");
  lines.push(...renderEntries(classEntries));

  await mkdir(path.dirname(modulePath), { recursive: true });
  await writeFile(modulePath, lines.join("\n"), "utf8");

  return [...functionEntries, ...classEntries].map((entry) => ({
    id: entry.id,
    kind: entry.kind,
    signature: entry.signature,
    declHash: entry.declHash,
    brief: entry.brief
  }));
}
