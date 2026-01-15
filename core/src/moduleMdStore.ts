import path from "path";
import { mkdir, readFile, writeFile } from "fs/promises";
import { ExtractedSymbol } from "./symbolExtractor";

export type ModuleEntry = {
  id: string;
  kind: "function" | "class";
  signature: string;
  declHash: string;
  brief: string;
  rawLines?: string[];
};

type ParsedModule = {
  headerLines: string[];
  functions: ModuleEntry[];
  classes: ModuleEntry[];
};

const ENTRY_REGEX =
  /^\s*-\s+`([^`]+)`\s*<!--\s*id:\s*([^|]+)\s*\|\s*hash:\s*([^\s]+)\s*-->/;

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
      lines.push(`- \`${entry.signature}\` <!-- id: ${entry.id} | hash: ${entry.declHash} -->`);
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

    const brief = await generateBrief({ moduleName, symbol });

    const freshEntry: ModuleEntry = {
      id: symbol.id,
      kind: symbol.kind,
      signature: symbol.signature,
      declHash: symbol.declHash,
      brief
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
