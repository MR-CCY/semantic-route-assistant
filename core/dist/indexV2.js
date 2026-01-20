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
exports.buildIndexV2 = buildIndexV2;
exports.updateIndexV2 = updateIndexV2;
const path_1 = __importDefault(require("path"));
const promises_1 = require("fs/promises");
const crypto_1 = require("crypto");
const scanFiles_1 = require("./scanFiles");
const moduleMapper_1 = require("./moduleMapper");
const moduleMdStore_1 = require("./moduleMdStore");
const routingStore_1 = require("./routingStore");
const generateBriefForSymbol_1 = require("./llm/generateBriefForSymbol");
const metaStore_1 = require("./metaStore");
const implementationExtractor_1 = require("./extract/implementationExtractor");
function mergeSymbol(existing, incoming) {
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
function hashContent(content) {
    return (0, crypto_1.createHash)("sha1").update(content).digest("hex");
}
async function collectSymbols(projectRoot) {
    const files = await (0, scanFiles_1.scanSourceFiles)(projectRoot);
    const moduleSymbols = new Map();
    const moduleSymbolMaps = new Map();
    const fileHashes = {};
    for (const absolutePath of files) {
        const relativePath = path_1.default.relative(projectRoot, absolutePath);
        const code = await (0, promises_1.readFile)(absolutePath, "utf8");
        const fileHash = hashContent(code);
        fileHashes[relativePath] = fileHash;
        // 特殊处理：C++ 文件使用 WASM 异步版本
        const isCppFile = /\.(c|cpp|cc|cxx|h|hpp|hxx|hh)$/i.test(relativePath);
        const extracted = isCppFile
            ? await (await Promise.resolve().then(() => __importStar(require("./symbolExtractor")))).extractSymbolsFromCodeAsync(code, relativePath)
            : [];
        const moduleName = (0, moduleMapper_1.mapModuleName)(relativePath);
        for (const symbol of extracted) {
            const symbolId = `${moduleName}::${symbol.id}`;
            const indexed = {
                ...symbol,
                id: symbolId,
                moduleName
            };
            if (!moduleSymbolMaps.has(moduleName)) {
                moduleSymbolMaps.set(moduleName, new Map());
            }
            const map = moduleSymbolMaps.get(moduleName);
            const existing = map.get(symbolId);
            map.set(symbolId, mergeSymbol(existing, indexed));
        }
    }
    for (const [moduleName, map] of moduleSymbolMaps.entries()) {
        moduleSymbols.set(moduleName, Array.from(map.values()));
    }
    return { moduleSymbols, fileHashes };
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
async function buildIndexV2(projectRoot, outDir) {
    console.log(`[buildIndexV2] ts=${new Date().toISOString()}`);
    try {
        const { moduleSymbols, fileHashes } = await collectSymbols(projectRoot);
        console.log(`[buildIndexV2] files=${Object.keys(fileHashes).length}`);
        console.log(`[buildIndexV2] modules=${moduleSymbols.size}`);
        const moduleEntries = {};
        for (const [moduleName, symbols] of moduleSymbols.entries()) {
            console.log(`[buildIndexV2] module=${moduleName} symbols=${symbols.length}`);
            const modulePath = path_1.default.join(outDir, "modules", `${moduleName}.md`);
            const entries = await (0, moduleMdStore_1.updateModuleMarkdown)({
                moduleName,
                modulePath,
                symbols,
                generateBrief: async ({ moduleName: name, symbol }) => {
                    const impl = await (0, implementationExtractor_1.extractImplementationForSymbol)({
                        projectRoot,
                        filePath: symbol.filePath,
                        signature: symbol.signature
                    });
                    return (0, generateBriefForSymbol_1.generateBriefForSymbol)({
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
        const routingModules = {};
        for (const [moduleName, symbols] of moduleSymbols.entries()) {
            routingModules[moduleName] = symbols.map((symbol) => ({
                id: symbol.id,
                declHash: symbol.declHash,
                declLine: symbol.declLine,
                implLine: symbol.implLine
            }));
        }
        const routing = (0, routingStore_1.buildRoutingFromModules)(routingModules);
        await (0, routingStore_1.saveRouting)(outDir, routing);
        console.log("[buildIndexV2] saving .meta.json");
        const meta = buildMeta(fileHashes);
        await (0, metaStore_1.saveMeta)(outDir, meta);
        console.log("[buildIndexV2] done");
    }
    catch (error) {
        const err = error;
        console.error("[buildIndexV2] failed", err?.message);
        if (err?.stack) {
            console.error(err.stack);
        }
        throw error;
    }
}
async function updateIndexV2(projectRoot, outDir) {
    console.log(`[updateIndexV2] version=v2.2.1 ts=${new Date().toISOString()}`);
    try {
        const previousMeta = await (0, metaStore_1.loadMeta)(outDir);
        const { moduleSymbols, fileHashes } = await collectSymbols(projectRoot);
        const changedFiles = getChangedFiles(previousMeta, fileHashes);
        console.log(`[updateIndexV2] files=${Object.keys(fileHashes).length}`);
        if (changedFiles.size === 0) {
            console.log("[updateIndexV2] No changed files detected.");
            return;
        }
        console.log("[updateIndexV2] Changed files:", Array.from(changedFiles));
        const impactedModules = new Set();
        for (const relativePath of changedFiles) {
            impactedModules.add((0, moduleMapper_1.mapModuleName)(relativePath));
        }
        console.log("[updateIndexV2] Impacted modules:", Array.from(impactedModules));
        const moduleEntries = {};
        for (const moduleName of impactedModules) {
            const symbols = moduleSymbols.get(moduleName) ?? [];
            console.log(`[updateIndexV2] Module ${moduleName} symbols: ${symbols.length}`);
            const modulePath = path_1.default.join(outDir, "modules", `${moduleName}.md`);
            const entries = await (0, moduleMdStore_1.updateModuleMarkdown)({
                moduleName,
                modulePath,
                symbols,
                generateBrief: async ({ moduleName: name, symbol }) => {
                    const impl = await (0, implementationExtractor_1.extractImplementationForSymbol)({
                        projectRoot,
                        filePath: symbol.filePath,
                        signature: symbol.signature
                    });
                    return (0, generateBriefForSymbol_1.generateBriefForSymbol)({
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
        const routingModules = {};
        for (const [moduleName, symbols] of moduleSymbols.entries()) {
            routingModules[moduleName] = symbols.map((symbol) => ({
                id: symbol.id,
                declHash: symbol.declHash,
                declLine: symbol.declLine,
                implLine: symbol.implLine
            }));
        }
        const routing = (0, routingStore_1.buildRoutingFromModules)(routingModules);
        await (0, routingStore_1.saveRouting)(outDir, routing);
        console.log("[updateIndexV2] saving .meta.json");
        const meta = buildMeta(fileHashes);
        await (0, metaStore_1.saveMeta)(outDir, meta);
        console.log("[updateIndexV2] done");
    }
    catch (error) {
        const err = error;
        console.error("[updateIndexV2] failed", err?.message);
        if (err?.stack) {
            console.error(err.stack);
        }
        throw error;
    }
}
