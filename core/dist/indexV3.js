"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.buildModuleIndexV3 = buildModuleIndexV3;
exports.updateModuleIndexV3 = updateModuleIndexV3;
const path_1 = __importDefault(require("path"));
const promises_1 = require("fs/promises");
const crypto_1 = require("crypto");
const fast_glob_1 = __importDefault(require("fast-glob"));
const ignore_1 = __importDefault(require("ignore"));
const generateBriefForSymbol_1 = require("./llm/generateBriefForSymbol");
const routingStore_1 = require("./routingStore");
const metaStore_1 = require("./metaStore");
const signatureUtils_1 = require("./signatureUtils");
const moduleGrouper_1 = require("./moduleGrouper");
const tagUtils_1 = require("./tagUtils");
const language_1 = require("./language");
const skillsGenerator_1 = require("./skillsGenerator");
function hashContent(content) {
    return (0, crypto_1.createHash)("sha1").update(content).digest("hex");
}
const BRIEF_CONCURRENCY = 4;
async function runWithConcurrency(items, limit, worker) {
    const results = new Array(items.length);
    let nextIndex = 0;
    async function runNext() {
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
function buildMeta(fileHashes) {
    const meta = {};
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
async function loadIgnorePatterns(projectRoot) {
    const ig = (0, ignore_1.default)();
    const gitignorePath = path_1.default.join(projectRoot, ".gitignore");
    try {
        const content = await (0, promises_1.readFile)(gitignorePath, "utf8");
        ig.add(content);
    }
    catch (error) {
        if (error?.code !== "ENOENT") {
            throw error;
        }
    }
    ig.add(["node_modules/", "**/node_modules/**"]);
    return ig;
}
/**
 * Scan source files for all supported languages.
 */
async function scanAllLanguageFiles(projectRoot) {
    const extensions = (0, language_1.getSupportedExtensions)();
    const patterns = extensions.map((ext) => `**/*.${ext}`);
    const ig = await loadIgnorePatterns(projectRoot);
    const matches = await (0, fast_glob_1.default)(patterns, {
        cwd: projectRoot,
        onlyFiles: true,
        dot: false,
        absolute: true
    });
    const filtered = matches.filter((filePath) => {
        const relative = path_1.default.relative(projectRoot, filePath);
        return !ig.ignores(relative);
    });
    return filtered;
}
const ENTRY_REGEX = /^\s*-\s+`([^`]+)`\s*<!--\s*id:\s*([^|]+)\s*\|\s*hash:\s*([^\s|]+)(?:\s*\|\s*impl:\s*([^\s|]+))?(?:\s*\|\s*file:\s*([^|]+))?(?:\s*\|\s*tags_base:\s*\[([^\]]*)\])?(?:\s*\|\s*tags_sem:\s*\[([^\]]*)\])?(?:\s*\|\s*tags:\s*\[([^\]]*)\])?\s*-->/;
function parseModuleEntries(content) {
    const entries = new Map();
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
function buildExistingEntriesFromRouting(existingRouting) {
    const entries = new Map();
    for (const [id, info] of Object.entries(existingRouting.symbols || {})) {
        const baseTags = (info.tagsBase || []).map(normalizeTag).filter(Boolean);
        const semanticSource = info.tagsSemantic && info.tagsSemantic.length > 0 ? info.tagsSemantic : info.tags || [];
        const semanticTags = semanticSource.map(normalizeTag).filter(Boolean);
        entries.set(id, {
            signature: info.signature ?? "",
            declHash: info.declHash,
            brief: info.brief ?? "",
            baseTags,
            semanticTags,
            filePath: info.filePath
        });
    }
    return entries;
}
async function loadExistingEntries(indexRoot) {
    try {
        const routing = await (0, routingStore_1.loadRouting)(indexRoot);
        if (Object.keys(routing.symbols || {}).length > 0) {
            return buildExistingEntriesFromRouting(routing);
        }
    }
    catch {
        // fall through to legacy module parsing
    }
    const modulesDir = path_1.default.join(indexRoot, "modules");
    const entryMap = new Map();
    let moduleFiles = [];
    try {
        moduleFiles = await (0, fast_glob_1.default)("**/*.md", { cwd: modulesDir, onlyFiles: true });
    }
    catch {
        return entryMap;
    }
    for (const relPath of moduleFiles) {
        const filePath = path_1.default.join(modulesDir, relPath);
        try {
            const content = await (0, promises_1.readFile)(filePath, "utf8");
            const entries = parseModuleEntries(content);
            for (const [id, entry] of entries.entries()) {
                if (!entryMap.has(id)) {
                    entryMap.set(id, entry);
                }
            }
        }
        catch {
            // ignore unreadable files
        }
    }
    return entryMap;
}
function getChangedFiles(previousMeta, fileHashes) {
    const changed = new Set();
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
function normalizeTag(tag) {
    return tag.toLowerCase().trim();
}
function collectExistingCustomTags(existingRouting) {
    const customTagsBySymbol = new Map();
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
        const normalizedTags = Array.from(new Set(customTags.map(normalizeTag).filter(Boolean)));
        if (normalizedTags.length > 0) {
            customTagsBySymbol.set(symbolId, normalizedTags);
        }
    }
    return customTagsBySymbol;
}
function renderModuleGroup(group) {
    const lines = [];
    lines.push(`# Module: ${group.title}`);
    lines.push(`> ${group.description}`);
    lines.push("");
    lines.push("## APIs");
    lines.push("");
    const ordered = [...group.symbols].sort((a, b) => a.signature.localeCompare(b.signature));
    for (const symbol of ordered) {
        const normalized = (0, signatureUtils_1.normalizeSignature)(symbol.signature);
        const baseTags = (symbol.baseTags || []).map((tag) => tag.toLowerCase().trim()).filter(Boolean);
        const semanticTags = (symbol.semanticTags || [])
            .map((tag) => tag.toLowerCase().trim())
            .filter(Boolean);
        const baseSegment = baseTags.length > 0 ? ` | tags_base: [${baseTags.join(", ")}]` : "";
        const semSegment = semanticTags.length > 0 ? ` | tags_sem: [${semanticTags.join(", ")}]` : "";
        const implSegment = symbol.implHash ? ` | impl: ${symbol.implHash}` : "";
        lines.push(`- \`${normalized}\` <!-- id: ${symbol.symbolId} | hash: ${symbol.declHash}${implSegment} | file: ${symbol.filePath}${baseSegment}${semSegment} -->`);
        lines.push(`  ${symbol.brief}`);
        lines.push("");
    }
    return lines.join("\n");
}
async function buildModuleIndexV3(projectRoot, outDir, options) {
    const existingRouting = await (0, routingStore_1.loadRouting)(outDir).catch(() => ({
        modules: {},
        tagIndex: { base: {}, semantic: {}, custom: {} },
        symbols: {}
    }));
    const stagingDir = `${outDir}.tmp`;
    const backupDir = `${outDir}.bak`;
    let backupCreated = false;
    try {
        await (0, promises_1.rm)(stagingDir, { recursive: true, force: true });
        await (0, promises_1.mkdir)(stagingDir, { recursive: true });
        const adapter = (0, language_1.getLanguageAdapter)(options?.languageId);
        const { fileHashes, symbols, briefTasks } = await collectSymbolsForV3(projectRoot, outDir, false, adapter, options);
        const writeSkillsFiles = options?.writeSkillsFiles ?? true;
        await resolveBriefsForV3(projectRoot, adapter, briefTasks, symbols, options);
        await writeV3Outputs(stagingDir, symbols, fileHashes, existingRouting, writeSkillsFiles);
        await (0, promises_1.rm)(backupDir, { recursive: true, force: true });
        try {
            await (0, promises_1.rename)(outDir, backupDir);
            backupCreated = true;
        }
        catch (error) {
            if (error?.code !== "ENOENT") {
                throw error;
            }
        }
        await (0, promises_1.rename)(stagingDir, outDir);
        if (backupCreated) {
            await (0, promises_1.rm)(backupDir, { recursive: true, force: true });
        }
    }
    catch (error) {
        if (backupCreated) {
            try {
                await (0, promises_1.rename)(backupDir, outDir);
            }
            catch {
                // ignore restore failure to preserve original error
            }
        }
        try {
            await (0, promises_1.rm)(stagingDir, { recursive: true, force: true });
        }
        catch {
            // ignore cleanup errors
        }
        throw error;
    }
}
async function collectSymbolsForV3(projectRoot, outDir, reuseExisting, defaultAdapter, options) {
    // Scan all supported language files
    const files = await scanAllLanguageFiles(projectRoot);
    const fileHashes = {};
    const symbols = [];
    const briefTasks = [];
    const candidates = new Map();
    const existingEntries = reuseExisting ? await loadExistingEntries(outDir) : new Map();
    const previousMeta = reuseExisting ? await (0, metaStore_1.loadMeta)(outDir) : {};
    const fileChangedMap = new Map();
    const totalFiles = files.length;
    let currentFile = 0;
    for (const absolutePath of files) {
        currentFile += 1;
        const relativePath = path_1.default.relative(projectRoot, absolutePath);
        // Get adapter for this specific file type
        const adapter = (0, language_1.getAdapterForFile)(absolutePath) || defaultAdapter;
        const code = await (0, promises_1.readFile)(absolutePath, "utf8");
        fileHashes[relativePath] = hashContent(code);
        if (reuseExisting) {
            const previousHash = previousMeta[relativePath]?.hash;
            fileChangedMap.set(relativePath, previousHash !== fileHashes[relativePath]);
        }
        options?.onProgress?.({ current: currentFile, total: totalFiles, filePath: relativePath });
        const extracted = adapter.extractSymbolsFromCode(code, relativePath);
        for (const symbol of extracted) {
            const normalizedSignature = (0, signatureUtils_1.normalizeSignature)(symbol.signature);
            const declHash = (0, signatureUtils_1.hashSignature)(normalizedSignature);
            const pathModuleHint = adapter.inferPathModuleHint(relativePath);
            const rawId = symbol.id;
            const declLine = symbol.declLine;
            const implLine = symbol.implLine;
            const parts = rawId.split("::").filter(Boolean);
            const qualifierDepth = parts.length;
            const canonicalId = parts.length > 2 ? parts.slice(-2).join("::") : parts.join("::");
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
            const ext = path_1.default.extname(relativePath).toLowerCase();
            const priority = [".cpp", ".cc", ".cxx", ".c"].includes(ext) ? 0 : 1;
            const existing = candidates.get(symbolKey);
            const prefer = !existing ||
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
        const fileChanged = reuseExisting
            ? fileChangedMap.get(candidate.filePath) ?? true
            : true;
        const canReuse = reuseExisting &&
            existing &&
            existing.declHash === candidate.declHash &&
            (!fileChanged || (existing.implHash && existing.implHash === candidate.implHash));
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
async function resolveBriefsForV3(projectRoot, adapter, briefTasks, symbols, options) {
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
        const briefResult = await (0, generateBriefForSymbol_1.generateBriefAndTagsForSymbol)({
            moduleName,
            signature: task.signature,
            implementation: impl.implementation ?? undefined,
            filePath: task.filePath
        });
        const semanticTags = (0, tagUtils_1.filterSemanticTags)({
            semanticTags: briefResult.tags || [],
            baseTags: task.baseTags || [],
            filePath: task.filePath,
            symbolId: task.symbolId
        });
        const result = {
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
async function writeV3Outputs(outDir, symbols, fileHashes, existingRouting, writeSkillsFiles) {
    const groups = await (0, moduleGrouper_1.groupSymbolsToModulesWithLLM)(symbols, { maxSymbolsForLLM: 300 });
    const resolvedExistingRouting = existingRouting ?? await (0, routingStore_1.loadRouting)(outDir).catch(() => ({
        modules: {},
        tagIndex: { base: {}, semantic: {}, custom: {} },
        symbols: {}
    }));
    const customTagsBySymbol = collectExistingCustomTags(resolvedExistingRouting);
    const routingModules = {};
    for (const group of groups) {
        routingModules[group.clusterId] = group.symbols.map((symbol) => {
            const baseSet = new Set((symbol.baseTags || []).map(normalizeTag));
            const semanticSet = new Set((symbol.semanticTags || []).map(normalizeTag));
            const preservedCustom = (customTagsBySymbol.get(symbol.symbolId) || []).filter((tag) => !baseSet.has(tag) && !semanticSet.has(tag));
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
    const routing = (0, routingStore_1.buildRoutingFromModules)(routingModules, resolvedExistingRouting.tagIndex);
    await (0, routingStore_1.saveRouting)(outDir, routing);
    const meta = buildMeta(fileHashes);
    await (0, metaStore_1.saveMeta)(outDir, meta);
    if (writeSkillsFiles) {
        // Generate Claude Skills files
        await (0, skillsGenerator_1.generateSkillsFiles)(outDir, symbols);
    }
}
async function updateModuleIndexV3(projectRoot, outDir, options) {
    const adapter = (0, language_1.getLanguageAdapter)(options?.languageId);
    const existingRouting = await (0, routingStore_1.loadRouting)(outDir).catch(() => ({
        modules: {},
        tagIndex: { base: {}, semantic: {}, custom: {} },
        symbols: {}
    }));
    const previousMeta = await (0, metaStore_1.loadMeta)(outDir);
    const { fileHashes, symbols, briefTasks } = await collectSymbolsForV3(projectRoot, outDir, true, adapter, options);
    const changedFiles = getChangedFiles(previousMeta, fileHashes);
    if (changedFiles.size === 0) {
        return;
    }
    await resolveBriefsForV3(projectRoot, adapter, briefTasks, symbols, options);
    await writeV3Outputs(outDir, symbols, fileHashes, existingRouting, false);
}
