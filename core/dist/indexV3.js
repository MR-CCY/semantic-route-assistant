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
const generateBriefForSymbol_1 = require("./llm/generateBriefForSymbol");
const routingStore_1 = require("./routingStore");
const metaStore_1 = require("./metaStore");
const signatureUtils_1 = require("./signatureUtils");
const moduleGrouper_1 = require("./moduleGrouper");
const tagUtils_1 = require("./tagUtils");
const language_1 = require("./language");
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
async function loadExistingEntries(indexRoot) {
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
    const adapter = (0, language_1.getLanguageAdapter)(options?.languageId);
    const { fileHashes, symbols, briefTasks } = await collectSymbolsForV3(projectRoot, outDir, false, adapter, options);
    await resolveBriefsForV3(projectRoot, adapter, briefTasks, symbols, options);
    await writeV3Outputs(outDir, symbols, fileHashes);
}
async function collectSymbolsForV3(projectRoot, outDir, reuseExisting, adapter, options) {
    const files = await adapter.scanSourceFiles(projectRoot);
    const fileHashes = {};
    const symbols = [];
    const briefTasks = [];
    const candidates = new Map();
    const existingEntries = reuseExisting ? await loadExistingEntries(outDir) : new Map();
    const previousMeta = reuseExisting ? await (0, metaStore_1.loadMeta)(outDir) : {};
    const totalFiles = files.length;
    let currentFile = 0;
    for (const absolutePath of files) {
        currentFile += 1;
        const relativePath = path_1.default.relative(projectRoot, absolutePath);
        const code = await (0, promises_1.readFile)(absolutePath, "utf8");
        fileHashes[relativePath] = hashContent(code);
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
            const baseTags = (0, tagUtils_1.inferBaseTagsForSymbol)({
                pathModuleHint,
                filePath: relativePath,
                symbolId,
                brief: ""
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
        const canReuse = reuseExisting &&
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
async function writeV3Outputs(outDir, symbols, fileHashes) {
    const groups = await (0, moduleGrouper_1.groupSymbolsToModulesWithLLM)(symbols, { maxSymbolsForLLM: 300 });
    const modulesDir = path_1.default.join(outDir, "modules");
    await (0, promises_1.mkdir)(modulesDir, { recursive: true });
    const desiredModules = new Set(groups.map((group) => `${group.clusterId}.md`));
    const existingModules = await (0, fast_glob_1.default)("**/*.md", { cwd: modulesDir, onlyFiles: true });
    const routingModules = {};
    for (const relPath of existingModules) {
        if (!desiredModules.has(relPath)) {
            const fullPath = path_1.default.join(modulesDir, relPath);
            try {
                await (0, promises_1.unlink)(fullPath);
            }
            catch {
                // ignore delete errors
            }
        }
    }
    for (const group of groups) {
        const modulePath = path_1.default.join(modulesDir, `${group.clusterId}.md`);
        await (0, promises_1.writeFile)(modulePath, renderModuleGroup(group), "utf8");
        routingModules[group.clusterId] = group.symbols.map((symbol) => ({
            id: symbol.symbolId,
            declHash: symbol.declHash,
            declLine: symbol.declLine,
            implLine: symbol.implLine,
            filePath: symbol.filePath,
            tagsBase: symbol.baseTags,
            tagsSemantic: symbol.semanticTags
        }));
    }
    const routing = (0, routingStore_1.buildRoutingFromModules)(routingModules);
    await (0, routingStore_1.saveRouting)(outDir, routing);
    const meta = buildMeta(fileHashes);
    await (0, metaStore_1.saveMeta)(outDir, meta);
}
async function updateModuleIndexV3(projectRoot, outDir, options) {
    const adapter = (0, language_1.getLanguageAdapter)(options?.languageId);
    const previousMeta = await (0, metaStore_1.loadMeta)(outDir);
    const { fileHashes, symbols, briefTasks } = await collectSymbolsForV3(projectRoot, outDir, true, adapter, options);
    const changedFiles = getChangedFiles(previousMeta, fileHashes);
    if (changedFiles.size === 0) {
        return;
    }
    await resolveBriefsForV3(projectRoot, adapter, briefTasks, symbols, options);
    await writeV3Outputs(outDir, symbols, fileHashes);
}
