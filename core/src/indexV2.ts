import path from "path";
import { readFile } from "fs/promises";
import { createHash } from "crypto";
import { scanSourceFiles } from "./scanFiles";
import { extractSymbolsFromCode, ExtractedSymbol } from "./symbolExtractor";
import { mapModuleName } from "./moduleMapper";
import { updateModuleMarkdown, ModuleEntry } from "./moduleMdStore";
import { buildRoutingFromModules, saveRouting } from "./routingStore";
import { generateBriefForSymbol } from "./llm/generateBriefForSymbol";
import { loadMeta, saveMeta, Meta } from "./metaStore";
import { extractImplementationForSymbol } from "./extract/implementationExtractor";

type IndexedSymbol = ExtractedSymbol & { moduleName: string };
type SymbolMap = Map<string, IndexedSymbol>;

function mergeSymbol(existing: IndexedSymbol | undefined, incoming: IndexedSymbol): IndexedSymbol {
  if (!existing) {
    return incoming;
  }

  const declLine = incoming.declLine ?? existing.declLine;
  const implLine = incoming.implLine ?? existing.implLine;
  const preferIncomingSignature = Boolean(incoming.declLine && !existing.declLine);

  return {
    ...existing,
    ...incoming,
    signature: preferIncomingSignature ? incoming.signature : existing.signature,
    declHash: preferIncomingSignature ? incoming.declHash : existing.declHash,
    declLine,
    implLine
  };
}

function hashContent(content: string): string {
  return createHash("sha1").update(content).digest("hex");
}

async function collectSymbols(projectRoot: string): Promise<{
  moduleSymbols: Map<string, IndexedSymbol[]>;
  fileHashes: Record<string, string>;
}> {
  const files = await scanSourceFiles(projectRoot);
  const moduleSymbols = new Map<string, IndexedSymbol[]>();
  const moduleSymbolMaps = new Map<string, SymbolMap>();
  const fileHashes: Record<string, string> = {};

  for (const absolutePath of files) {
    const relativePath = path.relative(projectRoot, absolutePath);
    const code = await readFile(absolutePath, "utf8");
    const fileHash = hashContent(code);
    fileHashes[relativePath] = fileHash;

    const extracted = extractSymbolsFromCode(code, relativePath);
    const moduleName = mapModuleName(relativePath);

    for (const symbol of extracted) {
      const symbolId = `${moduleName}::${symbol.id}`;
      const indexed: IndexedSymbol = {
        ...symbol,
        id: symbolId,
        moduleName
      };

      if (!moduleSymbolMaps.has(moduleName)) {
        moduleSymbolMaps.set(moduleName, new Map());
      }
      const map = moduleSymbolMaps.get(moduleName)!;
      const existing = map.get(symbolId);
      map.set(symbolId, mergeSymbol(existing, indexed));
    }
  }

  for (const [moduleName, map] of moduleSymbolMaps.entries()) {
    moduleSymbols.set(moduleName, Array.from(map.values()));
  }

  return { moduleSymbols, fileHashes };
}

function buildMeta(fileHashes: Record<string, string>): Meta {
  const meta: Meta = {};
  const now = new Date().toISOString();
  for (const [relativePath, hash] of Object.entries(fileHashes)) {
    meta[relativePath] = {
      hash,
      skillDoc: "",
      lastUpdated: now
    };
  }
  return meta;
}

function getChangedFiles(previousMeta: Meta, fileHashes: Record<string, string>): Set<string> {
  const changed = new Set<string>();
  const previousPaths = new Set(Object.keys(previousMeta));
  const currentPaths = new Set(Object.keys(fileHashes));

  for (const relativePath of currentPaths) {
    if (previousMeta[relativePath]?.hash !== fileHashes[relativePath]) {
      changed.add(relativePath);
    }
  }

  for (const relativePath of previousPaths) {
    if (!currentPaths.has(relativePath)) {
      changed.add(relativePath);
    }
  }

  return changed;
}

export async function buildIndexV2(projectRoot: string, outDir: string): Promise<void> {
  console.log(`[buildIndexV2] ts=${new Date().toISOString()}`);
  try {
    const { moduleSymbols, fileHashes } = await collectSymbols(projectRoot);
    console.log(`[buildIndexV2] files=${Object.keys(fileHashes).length}`);
    console.log(`[buildIndexV2] modules=${moduleSymbols.size}`);

    const moduleEntries: Record<string, ModuleEntry[]> = {};

    for (const [moduleName, symbols] of moduleSymbols.entries()) {
      console.log(`[buildIndexV2] module=${moduleName} symbols=${symbols.length}`);
      const modulePath = path.join(outDir, "modules", `${moduleName}.md`);
      const entries = await updateModuleMarkdown({
        moduleName,
        modulePath,
        symbols,
        generateBrief: async ({ moduleName: name, symbol }) => {
          const impl = await extractImplementationForSymbol({
            projectRoot,
            filePath: symbol.filePath,
            signature: symbol.signature
          });
          return generateBriefForSymbol({
            moduleName: name,
            signature: symbol.signature,
            implementation: impl.implementation ?? undefined,
            filePath: symbol.filePath
          });
        }
      });
      moduleEntries[moduleName] = entries;
    }

    console.log("[buildIndexV2] saving routing.json");
    const routingModules: Record<
      string,
      Array<{ id: string; declHash: string; declLine?: number; implLine?: number }>
    > = {};
    for (const [moduleName, symbols] of moduleSymbols.entries()) {
      routingModules[moduleName] = symbols.map((symbol) => ({
        id: symbol.id,
        declHash: symbol.declHash,
        declLine: symbol.declLine,
        implLine: symbol.implLine
      }));
    }
    const routing = buildRoutingFromModules(routingModules);
    await saveRouting(outDir, routing);

    console.log("[buildIndexV2] saving .meta.json");
    const meta = buildMeta(fileHashes);
    await saveMeta(outDir, meta);
    console.log("[buildIndexV2] done");
  } catch (error) {
    const err = error as Error;
    console.error("[buildIndexV2] failed", err?.message);
    if (err?.stack) {
      console.error(err.stack);
    }
    throw error;
  }
}

export async function updateIndexV2(projectRoot: string, outDir: string): Promise<void> {
  console.log(`[updateIndexV2] version=v2.2.1 ts=${new Date().toISOString()}`);
  try {
    const previousMeta = await loadMeta(outDir);
    const { moduleSymbols, fileHashes } = await collectSymbols(projectRoot);
    const changedFiles = getChangedFiles(previousMeta, fileHashes);
    console.log(`[updateIndexV2] files=${Object.keys(fileHashes).length}`);

    if (changedFiles.size === 0) {
      console.log("[updateIndexV2] No changed files detected.");
      return;
    }

    console.log("[updateIndexV2] Changed files:", Array.from(changedFiles));

    const impactedModules = new Set<string>();
    for (const relativePath of changedFiles) {
      impactedModules.add(mapModuleName(relativePath));
    }

    console.log("[updateIndexV2] Impacted modules:", Array.from(impactedModules));

    const moduleEntries: Record<string, ModuleEntry[]> = {};
    for (const moduleName of impactedModules) {
      const symbols = moduleSymbols.get(moduleName) ?? [];
      console.log(`[updateIndexV2] Module ${moduleName} symbols: ${symbols.length}`);
      const modulePath = path.join(outDir, "modules", `${moduleName}.md`);
      const entries = await updateModuleMarkdown({
        moduleName,
        modulePath,
        symbols,
        generateBrief: async ({ moduleName: name, symbol }) => {
          const impl = await extractImplementationForSymbol({
            projectRoot,
            filePath: symbol.filePath,
            signature: symbol.signature
          });
          return generateBriefForSymbol({
            moduleName: name,
            signature: symbol.signature,
            implementation: impl.implementation ?? undefined,
            filePath: symbol.filePath
          });
        }
      });
      moduleEntries[moduleName] = entries;
    }

    console.log("[updateIndexV2] saving routing.json");
    const routingModules: Record<
      string,
      Array<{ id: string; declHash: string; declLine?: number; implLine?: number }>
    > = {};
    for (const [moduleName, symbols] of moduleSymbols.entries()) {
      routingModules[moduleName] = symbols.map((symbol) => ({
        id: symbol.id,
        declHash: symbol.declHash,
        declLine: symbol.declLine,
        implLine: symbol.implLine
      }));
    }

    const routing = buildRoutingFromModules(routingModules);
    await saveRouting(outDir, routing);

    console.log("[updateIndexV2] saving .meta.json");
    const meta = buildMeta(fileHashes);
    await saveMeta(outDir, meta);
    console.log("[updateIndexV2] done");
  } catch (error) {
    const err = error as Error;
    console.error("[updateIndexV2] failed", err?.message);
    if (err?.stack) {
      console.error(err.stack);
    }
    throw error;
  }
}
