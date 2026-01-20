"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
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
const tagAggregator_1 = require("./tagAggregator");
const tagNormalizer_1 = require("./tagNormalizer");
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
async function loadIgnorePatterns(projectRoot, extraPatterns) {
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
    if (extraPatterns && extraPatterns.length > 0) {
        ig.add(extraPatterns.filter((pattern) => pattern && pattern.trim()));
    }
    return ig;
}
/**
 * Scan source files for all supported languages.
 */
async function scanAllLanguageFiles(projectRoot, extraIgnorePatterns) {
    const extensions = (0, language_1.getSupportedExtensions)();
    const patterns = extensions.map((ext) => `**/*.${ext}`);
    const ig = await loadIgnorePatterns(projectRoot, extraIgnorePatterns);
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
            implHash: info.implHash,
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
        // fall through
    }
    return new Map();
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
function normalizeTagsWithLocalRules(tags) {
    const seen = new Set();
    const normalized = [];
    for (const tag of tags) {
        const cleaned = (0, tagNormalizer_1.localNormalize)(tag);
        if (!cleaned || seen.has(cleaned)) {
            continue;
        }
        seen.add(cleaned);
        normalized.push(cleaned);
    }
    return normalized;
}
function applyAliasesToTags(tags, aliases) {
    const seen = new Set();
    const canonical = [];
    for (const tag of tags) {
        if (!tag) {
            continue;
        }
        const resolved = (0, tagNormalizer_1.applyAliasMapping)(tag, aliases);
        if (!resolved || seen.has(resolved)) {
            continue;
        }
        seen.add(resolved);
        canonical.push(resolved);
    }
    return canonical;
}
async function normalizeAndAggregateTags(symbols, existingMetadata, onAggregationProgress) {
    let metadata = existingMetadata ?? (0, routingStore_1.createEmptyTagMetadata)();
    const normalizedTags = [];
    let rawBaseCount = 0;
    let rawSemanticCount = 0;
    const normalizedSemanticTags = [];
    let normalizedSemanticCount = 0;
    console.log(`[tagAggregation] 开始获取原语义标签 symbols=${symbols.length}`);
    for (const symbol of symbols) {
        rawBaseCount += (symbol.baseTags || []).length;
        rawSemanticCount += (symbol.semanticTags || []).length;
        symbol.baseTags = normalizeTagsWithLocalRules(symbol.baseTags || []);
        symbol.semanticTags = normalizeTagsWithLocalRules(symbol.semanticTags || []);
        normalizedSemanticCount += symbol.semanticTags.length;
        normalizedSemanticTags.push(...symbol.semanticTags);
        normalizedTags.push(...symbol.baseTags, ...symbol.semanticTags);
    }
    const uniqueNormalizedCount = new Set(normalizedTags).size;
    const uniqueSemanticCount = new Set(normalizedSemanticTags).size;
    console.log(`[tagAggregation] 获取完原语义标签 rawBase=${rawBaseCount} rawSemantic=${rawSemanticCount} normalizedSemantic=${normalizedSemanticCount} semanticUnique=${uniqueSemanticCount} normalizedTotal=${normalizedTags.length} normalizedUnique=${uniqueNormalizedCount}`);
    const unknownTags = (0, tagAggregator_1.findUnknownTags)(normalizedSemanticTags, metadata.aliases, metadata.categories);
    if (unknownTags.length > 0) {
        metadata = await (0, tagAggregator_1.aggregateAllUnknownTags)(unknownTags, metadata, onAggregationProgress);
    }
    const cleanedAliases = (0, tagNormalizer_1.removeAliasCycles)(metadata.aliases);
    if (Object.keys(cleanedAliases).length !== Object.keys(metadata.aliases).length) {
        metadata = {
            ...metadata,
            aliases: cleanedAliases
        };
    }
    const canonicalTags = [];
    const canonicalSemanticTags = [];
    for (const symbol of symbols) {
        symbol.semanticTags = applyAliasesToTags(symbol.semanticTags || [], metadata.aliases);
        canonicalTags.push(...symbol.baseTags, ...symbol.semanticTags);
        canonicalSemanticTags.push(...symbol.semanticTags);
    }
    metadata = (0, tagAggregator_1.ensureCategoriesForTags)(metadata, canonicalTags);
    metadata = (0, tagAggregator_1.updateCategoryCounts)(metadata, canonicalSemanticTags);
    return metadata;
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
        tagIndex: { base: {}, semantic: {}, custom: {} },
        tagMetadata: (0, routingStore_1.createEmptyTagMetadata)(),
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
        await writeV3Outputs(stagingDir, symbols, fileHashes, existingRouting, writeSkillsFiles, { onAggregationProgress: options?.onAggregationProgress });
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
    const files = await scanAllLanguageFiles(projectRoot, options?.ignorePatterns);
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
        // 特殊处理：C++ 文件使用 WASM 异步版本
        let extracted;
        if (adapter.id === "cpp") {
            const { extractSymbolsFromCodeAsync } = await Promise.resolve().then(() => __importStar(require("./symbolExtractor")));
            extracted = await extractSymbolsFromCodeAsync(code, relativePath);
        }
        else {
            extracted = adapter.extractSymbolsFromCode(code, relativePath);
        }
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
    if (briefTotal > 0) {
        console.log(`[briefGeneration] start total=${briefTotal} concurrency=${concurrency}`);
    }
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
            if (options?.onBriefProgress) {
                options.onBriefProgress({ current: briefDone, total: briefTotal });
            }
            else {
                console.log(`[briefGeneration] progress ${briefDone}/${briefTotal}`);
            }
        }
        return result;
    });
    symbols.push(...briefResults);
}
async function writeV3Outputs(outDir, symbols, fileHashes, existingRouting, writeSkillsFiles, options) {
    const resolvedExistingRouting = existingRouting ?? await (0, routingStore_1.loadRouting)(outDir).catch(() => ({
        tagIndex: { base: {}, semantic: {}, custom: {} },
        tagMetadata: (0, routingStore_1.createEmptyTagMetadata)(),
        symbols: {}
    }));
    const tagMetadata = await normalizeAndAggregateTags(symbols, resolvedExistingRouting.tagMetadata, options?.onAggregationProgress);
    const groups = await (0, moduleGrouper_1.groupSymbolsToModulesWithLLM)(symbols, { maxSymbolsForLLM: 300 });
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
                implHash: symbol.implHash,
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
    const routing = (0, routingStore_1.buildRoutingFromModules)(routingModules, resolvedExistingRouting.tagIndex, tagMetadata);
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
        tagIndex: { base: {}, semantic: {}, custom: {} },
        tagMetadata: (0, routingStore_1.createEmptyTagMetadata)(),
        symbols: {}
    }));
    const previousMeta = await (0, metaStore_1.loadMeta)(outDir);
    const { fileHashes, symbols, briefTasks } = await collectSymbolsForV3(projectRoot, outDir, true, adapter, options);
    const changedFiles = getChangedFiles(previousMeta, fileHashes);
    if (changedFiles.size === 0) {
        return;
    }
    await resolveBriefsForV3(projectRoot, adapter, briefTasks, symbols, options);
    await writeV3Outputs(outDir, symbols, fileHashes, existingRouting, false, { onAggregationProgress: options?.onAggregationProgress });
}
