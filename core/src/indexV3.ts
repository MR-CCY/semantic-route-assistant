import path from "path";
import { mkdir, readFile, rename, rm, unlink, writeFile } from "fs/promises";
import { createHash } from "crypto";
import fg from "fast-glob";
import ignore from "ignore";
import { generateBriefAndTagsForSymbol } from "./llm/generateBriefForSymbol";
import { buildRoutingFromModules, loadRouting, saveRouting, RoutingJson } from "./routingStore";
import { loadMeta, saveMeta, Meta } from "./metaStore";
import { hashSignature, normalizeSignature } from "./signatureUtils";
import { Cluster, SymbolRecord } from "./v3Types";
import { groupSymbolsToModulesWithLLM } from "./moduleGrouper";
import { filterSemanticTags } from "./tagUtils";
import { getLanguageAdapter, getAdapterForFile, getSupportedExtensions, LanguageAdapter } from "./language";
import { generateSkillsFiles } from "./skillsGenerator";

function hashContent(content: string): string {
  return createHash("sha1").update(content).digest("hex");
}

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

/**
 * Load .gitignore patterns from project root.
 */
async function loadIgnorePatterns(projectRoot: string): Promise<ReturnType<typeof ignore>> {
  const ig = ignore();
  const gitignorePath = path.join(projectRoot, ".gitignore");
  try {
    const content = await readFile(gitignorePath, "utf8");
    ig.add(content);
  } catch (error: any) {
    if (error?.code !== "ENOENT") {
      throw error;
    }
  }
  return ig;
}

/**
 * Scan source files for all supported languages.
 */
async function scanAllLanguageFiles(projectRoot: string): Promise<string[]> {
  const extensions = getSupportedExtensions();
  const patterns = extensions.map((ext) => `**/*.${ext}`);
  const ig = await loadIgnorePatterns(projectRoot);

  const matches = await fg(patterns, {
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


const ENTRY_REGEX =
  /^\s*-\s+`([^`]+)`\s*<!--\s*id:\s*([^|]+)\s*\|\s*hash:\s*([^\s|]+)(?:\s*\|\s*impl:\s*([^\s|]+))?(?:\s*\|\s*file:\s*([^|]+))?(?:\s*\|\s*tags_base:\s*\[([^\]]*)\])?(?:\s*\|\s*tags_sem:\s*\[([^\]]*)\])?(?:\s*\|\s*tags:\s*\[([^\]]*)\])?\s*-->/;

type ExistingEntry = {
  signature: string;
  declHash: string;
  implHash?: string;
  brief: string;
  baseTags: string[];
  semanticTags: string[];
  filePath?: string;
};

function parseModuleEntries(content: string): Map<string, ExistingEntry> {
  const entries = new Map<string, ExistingEntry>();
  const lines = content.split("\n");
  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i];
    const match = line.match(ENTRY_REGEX);
    if (!match) {
      continue;
    }

    const signature = match[1].trim();
    const id = match[2].trim();
    const declHash = match[3].trim();
    const implHash = match[4]?.trim();
    const filePath = match[5]?.trim();
    const baseTagsRaw = match[6];
    const semanticTagsRaw = match[7];
    const legacyTagsRaw = match[8];
    const baseTags = baseTagsRaw
      ? baseTagsRaw
        .split(",")
        .map((tag) => tag.trim().toLowerCase())
        .filter(Boolean)
      : [];
    const semanticTags = semanticTagsRaw
      ? semanticTagsRaw
        .split(",")
        .map((tag) => tag.trim().toLowerCase())
        .filter(Boolean)
      : [];
    const legacyTags = legacyTagsRaw
      ? legacyTagsRaw
        .split(",")
        .map((tag) => tag.trim().toLowerCase())
        .filter(Boolean)
      : [];

    let brief = "";
    let j = i + 1;
    while (j < lines.length && !lines[j].startsWith("## ") && !ENTRY_REGEX.test(lines[j])) {
      if (lines[j].trim()) {
        brief = lines[j].trim();
      }
      j += 1;
    }

    entries.set(id, {
      signature,
      declHash,
      implHash,
      brief,
      baseTags: baseTags,
      semanticTags: semanticTags.length > 0 ? semanticTags : legacyTags,
      filePath
    });
    i = j - 1;
  }
  return entries;
}

async function loadExistingEntries(indexRoot: string): Promise<Map<string, ExistingEntry>> {
  const modulesDir = path.join(indexRoot, "modules");
  const entryMap = new Map<string, ExistingEntry>();
  let moduleFiles: string[] = [];
  try {
    moduleFiles = await fg("**/*.md", { cwd: modulesDir, onlyFiles: true });
  } catch {
    return entryMap;
  }

  for (const relPath of moduleFiles) {
    const filePath = path.join(modulesDir, relPath);
    try {
      const content = await readFile(filePath, "utf8");
      const entries = parseModuleEntries(content);
      for (const [id, entry] of entries.entries()) {
        if (!entryMap.has(id)) {
          entryMap.set(id, entry);
        }
      }
    } catch {
      // ignore unreadable files
    }
  }

  return entryMap;
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

function normalizeTag(tag: string): string {
  return tag.toLowerCase().trim();
}

function collectExistingCustomTags(existingRouting: RoutingJson): Map<string, string[]> {
  const customTagsBySymbol = new Map<string, string[]>();
  const customIndex = existingRouting.tagIndex?.custom ?? {};

  for (const [symbolId, info] of Object.entries(existingRouting.symbols || {})) {
    const legacyCustom = info.tagsCustom ?? [];
    let customTags = legacyCustom;

    if (customTags.length === 0) {
      const tags = info.tags ?? [];
      if (tags.length > 0) {
        customTags = tags.filter((tag) => {
          const normalized = normalizeTag(tag);
          return normalized && customIndex[normalized];
        });
      }
    }

    const normalizedTags = Array.from(
      new Set(customTags.map(normalizeTag).filter(Boolean))
    );

    if (normalizedTags.length > 0) {
      customTagsBySymbol.set(symbolId, normalizedTags);
    }
  }

  return customTagsBySymbol;
}

function renderModuleGroup(group: Cluster): string {
  const lines: string[] = [];
  lines.push(`# Module: ${group.title}`);
  lines.push(`> ${group.description}`);
  lines.push("");
  lines.push("## APIs");
  lines.push("");

  const ordered = [...group.symbols].sort((a, b) => a.signature.localeCompare(b.signature));
  for (const symbol of ordered) {
    const normalized = normalizeSignature(symbol.signature);
    const baseTags = (symbol.baseTags || []).map((tag) => tag.toLowerCase().trim()).filter(Boolean);
    const semanticTags = (symbol.semanticTags || [])
      .map((tag) => tag.toLowerCase().trim())
      .filter(Boolean);
    const baseSegment =
      baseTags.length > 0 ? ` | tags_base: [${baseTags.join(", ")}]` : "";
    const semSegment =
      semanticTags.length > 0 ? ` | tags_sem: [${semanticTags.join(", ")}]` : "";
    const implSegment = symbol.implHash ? ` | impl: ${symbol.implHash}` : "";
    lines.push(
      `- \`${normalized}\` <!-- id: ${symbol.symbolId} | hash: ${symbol.declHash}${implSegment} | file: ${symbol.filePath}${baseSegment}${semSegment} -->`
    );
    lines.push(`  ${symbol.brief}`);
    lines.push("");
  }

  return lines.join("\n");
}

export async function buildModuleIndexV3(
  projectRoot: string,
  outDir: string,
  options?: {
    onProgress?: (info: { current: number; total: number; filePath?: string }) => void;
    onBriefProgress?: (info: { current: number; total: number }) => void;
    languageId?: string;
    briefConcurrency?: number;
    writeSkillsFiles?: boolean;
  }
): Promise<void> {
  const existingRouting = await loadRouting(outDir).catch(() => ({
    modules: {},
    tagIndex: { base: {}, semantic: {}, custom: {} },
    symbols: {}
  }));

  const stagingDir = `${outDir}.tmp`;
  const backupDir = `${outDir}.bak`;
  let backupCreated = false;

  try {
    await rm(stagingDir, { recursive: true, force: true });
    await mkdir(stagingDir, { recursive: true });

    const adapter = getLanguageAdapter(options?.languageId);
    const {
      fileHashes,
      symbols,
      briefTasks
    } = await collectSymbolsForV3(projectRoot, outDir, false, adapter, options);
    const writeSkillsFiles = options?.writeSkillsFiles ?? true;

    await resolveBriefsForV3(projectRoot, adapter, briefTasks, symbols, options);
    await writeV3Outputs(stagingDir, symbols, fileHashes, existingRouting, writeSkillsFiles);

    await rm(backupDir, { recursive: true, force: true });
    try {
      await rename(outDir, backupDir);
      backupCreated = true;
    } catch (error: any) {
      if (error?.code !== "ENOENT") {
        throw error;
      }
    }
    await rename(stagingDir, outDir);
    if (backupCreated) {
      await rm(backupDir, { recursive: true, force: true });
    }
  } catch (error) {
    if (backupCreated) {
      try {
        await rename(backupDir, outDir);
      } catch {
        // ignore restore failure to preserve original error
      }
    }
    try {
      await rm(stagingDir, { recursive: true, force: true });
    } catch {
      // ignore cleanup errors
    }
    throw error;
  }
}

async function collectSymbolsForV3(
  projectRoot: string,
  outDir: string,
  reuseExisting: boolean,
  defaultAdapter: LanguageAdapter,
  options?: {
    onProgress?: (info: { current: number; total: number; filePath?: string }) => void;
  }
): Promise<{
  fileHashes: Record<string, string>;
  symbols: SymbolRecord[];
  briefTasks: Array<{
    filePath: string;
    signature: string;
    symbolId: string;
    declHash: string;
    declLine?: number;
    implLine?: number;
    pathModuleHint: string;
    baseTags: string[];
  }>;
}> {
  // Scan all supported language files
  const files = await scanAllLanguageFiles(projectRoot);
  const fileHashes: Record<string, string> = {};
  const symbols: SymbolRecord[] = [];
  const briefTasks: Array<{
    filePath: string;
    signature: string;
    symbolId: string;
    declHash: string;
    declLine?: number;
    implLine?: number;
    pathModuleHint: string;
    baseTags: string[];
  }> = [];

  const candidates = new Map<
    string,
    {
      filePath: string;
      signature: string;
      symbolId: string;
      declHash: string;
      implHash: string;
      declLine?: number;
      implLine?: number;
      pathModuleHint: string;
      baseTags: string[];
      priority: number;
      qualifierDepth: number;
    }
  >();

  const existingEntries = reuseExisting ? await loadExistingEntries(outDir) : new Map();
  const previousMeta = reuseExisting ? await loadMeta(outDir) : {};
  const totalFiles = files.length;
  let currentFile = 0;

  for (const absolutePath of files) {
    currentFile += 1;
    const relativePath = path.relative(projectRoot, absolutePath);

    // Get adapter for this specific file type
    const adapter = getAdapterForFile(absolutePath) || defaultAdapter;

    const code = await readFile(absolutePath, "utf8");
    fileHashes[relativePath] = hashContent(code);
    options?.onProgress?.({ current: currentFile, total: totalFiles, filePath: relativePath });

    const extracted = adapter.extractSymbolsFromCode(code, relativePath);
    for (const symbol of extracted) {
      const normalizedSignature = normalizeSignature(symbol.signature);
      const declHash = hashSignature(normalizedSignature);
      const pathModuleHint = adapter.inferPathModuleHint(relativePath);
      const rawId = symbol.id;
      const declLine = symbol.declLine;
      const implLine = symbol.implLine;
      const parts = rawId.split("::").filter(Boolean);
      const qualifierDepth = parts.length;
      const canonicalId =
        parts.length > 2 ? parts.slice(-2).join("::") : parts.join("::");
      const symbolKey = `${pathModuleHint}::${canonicalId}`;
      const symbolId = `${pathModuleHint}::${rawId}`;
      const baseTags = adapter.inferBaseTags({
        pathModuleHint,
        filePath: relativePath,
        symbolId,
        signature: normalizedSignature,
        kind: symbol.kind
      });
      const implSnippet = adapter.extractImplementationFromCode(code, normalizedSignature) || "";
      const implHash = hashContent(`${normalizedSignature}\n${implSnippet}`);
      const ext = path.extname(relativePath).toLowerCase();
      const priority = [".cpp", ".cc", ".cxx", ".c"].includes(ext) ? 0 : 1;
      const existing = candidates.get(symbolKey);
      const prefer =
        !existing ||
        priority < existing.priority ||
        (priority === existing.priority && qualifierDepth > existing.qualifierDepth);
      if (prefer) {
        candidates.set(symbolKey, {
          filePath: relativePath,
          signature: normalizedSignature,
          symbolId,
          declHash,
          implHash,
          declLine,
          implLine,
          pathModuleHint,
          baseTags,
          priority,
          qualifierDepth
        });
      }
    }
  }

  for (const candidate of candidates.values()) {
    const existing = existingEntries.get(candidate.symbolId);
    const canReuse =
      reuseExisting &&
      existing &&
      existing.declHash === candidate.declHash &&
      existing.implHash === candidate.implHash;

    if (canReuse) {
      const baseTags = existing.baseTags.length > 0 ? existing.baseTags : candidate.baseTags;
      const semanticTags = existing.semanticTags.length > 0 ? existing.semanticTags : [];
      symbols.push({
        symbolId: candidate.symbolId,
        signature: candidate.signature,
        declHash: candidate.declHash,
        implHash: candidate.implHash,
        brief: existing.brief,
        filePath: candidate.filePath,
        declLine: candidate.declLine,
        implLine: candidate.implLine,
        pathModuleHint: candidate.pathModuleHint,
        baseTags,
        semanticTags
      });
      continue;
    }

    briefTasks.push({
      filePath: candidate.filePath,
      signature: candidate.signature,
      symbolId: candidate.symbolId,
      declHash: candidate.declHash,
      declLine: candidate.declLine,
      implLine: candidate.implLine,
      pathModuleHint: candidate.pathModuleHint,
      baseTags: candidate.baseTags
    });
  }

  return { fileHashes, symbols, briefTasks };
}

async function resolveBriefsForV3(
  projectRoot: string,
  adapter: LanguageAdapter,
  briefTasks: Array<{
    filePath: string;
    signature: string;
    symbolId: string;
    declHash: string;
    declLine?: number;
    implLine?: number;
    pathModuleHint: string;
    baseTags: string[];
  }>,
  symbols: SymbolRecord[],
  options?: {
    onBriefProgress?: (info: { current: number; total: number }) => void;
    briefConcurrency?: number;
  }
): Promise<void> {
  const concurrency = Math.max(1, Math.floor(options?.briefConcurrency ?? BRIEF_CONCURRENCY));
  let briefDone = 0;
  const briefTotal = briefTasks.length;
  const briefResults = await runWithConcurrency(briefTasks, concurrency, async (task) => {
    const impl = await adapter.extractImplementationForSymbol({
      projectRoot,
      filePath: task.filePath,
      signature: task.signature
    });
    const moduleName = task.pathModuleHint;
    const briefResult = await generateBriefAndTagsForSymbol({
      moduleName,
      signature: task.signature,
      implementation: impl.implementation ?? undefined,
      filePath: task.filePath
    });
    const semanticTags = filterSemanticTags({
      semanticTags: briefResult.tags || [],
      baseTags: task.baseTags || [],
      filePath: task.filePath,
      symbolId: task.symbolId
    });
    const result: SymbolRecord = {
      filePath: task.filePath,
      symbolId: task.symbolId,
      signature: task.signature,
      declHash: task.declHash,
      implHash: hashContent(`${task.signature}\n${impl.implementation ?? ""}`),
      brief: briefResult.brief,
      declLine: task.declLine,
      implLine: task.implLine,
      pathModuleHint: task.pathModuleHint,
      baseTags: task.baseTags || [],
      semanticTags
    };
    briefDone += 1;
    if (briefDone % 10 === 0 || briefDone === briefTotal) {
      options?.onBriefProgress?.({ current: briefDone, total: briefTotal });
    }
    return result;
  });

  symbols.push(...briefResults);
}

async function writeV3Outputs(
  outDir: string,
  symbols: SymbolRecord[],
  fileHashes: Record<string, string>,
  existingRouting?: RoutingJson,
  writeSkillsFiles?: boolean
): Promise<void> {
  const groups = await groupSymbolsToModulesWithLLM(symbols, { maxSymbolsForLLM: 300 });

  const resolvedExistingRouting = existingRouting ?? await loadRouting(outDir).catch(() => ({
    modules: {},
    tagIndex: { base: {}, semantic: {}, custom: {} },
    symbols: {}
  }));
  const customTagsBySymbol = collectExistingCustomTags(resolvedExistingRouting);

  const routingModules: Record<
    string,
    Array<{
      id: string;
      declHash: string;
      declLine?: number;
      implLine?: number;
      filePath?: string;
      signature?: string;
      brief?: string;
      tagsBase?: string[];
      tagsSemantic?: string[];
      tagsCustom?: string[];
    }>
  > = {};

  for (const group of groups) {
    routingModules[group.clusterId] = group.symbols.map((symbol) => {
      const baseSet = new Set((symbol.baseTags || []).map(normalizeTag));
      const semanticSet = new Set((symbol.semanticTags || []).map(normalizeTag));
      const preservedCustom = (customTagsBySymbol.get(symbol.symbolId) || []).filter(
        (tag) => !baseSet.has(tag) && !semanticSet.has(tag)
      );

      return {
        id: symbol.symbolId,
        declHash: symbol.declHash,
        declLine: symbol.declLine,
        implLine: symbol.implLine,
        filePath: symbol.filePath,
        signature: symbol.signature,
        brief: symbol.brief,
        tagsBase: symbol.baseTags,
        tagsSemantic: symbol.semanticTags,
        tagsCustom: preservedCustom.length > 0 ? preservedCustom : undefined
      };
    });
  }

  // Preserve tag scores while rebuilding
  const routing = buildRoutingFromModules(routingModules, resolvedExistingRouting.tagIndex);
  await saveRouting(outDir, routing);

  const meta = buildMeta(fileHashes);
  await saveMeta(outDir, meta);

  if (writeSkillsFiles) {
    // Generate Claude Skills files
    await generateSkillsFiles(outDir, symbols);
  }
}

export async function updateModuleIndexV3(
  projectRoot: string,
  outDir: string,
  options?: {
    onProgress?: (info: { current: number; total: number; filePath?: string }) => void;
    onBriefProgress?: (info: { current: number; total: number }) => void;
    languageId?: string;
    briefConcurrency?: number;
  }
): Promise<void> {
  const adapter = getLanguageAdapter(options?.languageId);
  const existingRouting = await loadRouting(outDir).catch(() => ({
    modules: {},
    tagIndex: { base: {}, semantic: {}, custom: {} },
    symbols: {}
  }));
  const previousMeta = await loadMeta(outDir);
  const { fileHashes, symbols, briefTasks } = await collectSymbolsForV3(
    projectRoot,
    outDir,
    true,
    adapter,
    options
  );
  const changedFiles = getChangedFiles(previousMeta, fileHashes);

  if (changedFiles.size === 0) {
    return;
  }

  await resolveBriefsForV3(projectRoot, adapter, briefTasks, symbols, options);
  await writeV3Outputs(outDir, symbols, fileHashes, existingRouting, false);
}
