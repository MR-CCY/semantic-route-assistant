"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.updateSymbolTags = exports.removeSymbolTag = exports.addSymbolTag = exports.updateSymbolDescription = exports.incrementTagScore = exports.saveRouting = exports.loadRouting = exports.ROUTING_SCHEMA_VERSION = exports.searchSkills = exports.summarizeFile = exports.removeSkillsFiles = exports.generateSkillsFiles = exports.updateModuleIndexV3 = exports.buildModuleIndexV3 = exports.updateIndexV2 = exports.buildIndexV2 = void 0;
exports.buildIndex = buildIndex;
exports.updateIndex = updateIndex;
const path_1 = __importDefault(require("path"));
const promises_1 = require("fs/promises");
const crypto_1 = require("crypto");
const buildStubIndex_1 = require("./buildStubIndex");
const scanFiles_1 = require("./scanFiles");
const llmClient_1 = require("./llmClient");
const metaStore_1 = require("./metaStore");
const searchSkills_1 = require("./searchSkills");
Object.defineProperty(exports, "searchSkills", { enumerable: true, get: function () { return searchSkills_1.searchSkills; } });
// v2: per-module md + routing.json (incremental)
var indexV2_1 = require("./indexV2");
Object.defineProperty(exports, "buildIndexV2", { enumerable: true, get: function () { return indexV2_1.buildIndexV2; } });
Object.defineProperty(exports, "updateIndexV2", { enumerable: true, get: function () { return indexV2_1.updateIndexV2; } });
// v3: in-memory clustering -> modules/*.md
var indexV3_1 = require("./indexV3");
Object.defineProperty(exports, "buildModuleIndexV3", { enumerable: true, get: function () { return indexV3_1.buildModuleIndexV3; } });
Object.defineProperty(exports, "updateModuleIndexV3", { enumerable: true, get: function () { return indexV3_1.updateModuleIndexV3; } });
var skillsGenerator_1 = require("./skillsGenerator");
Object.defineProperty(exports, "generateSkillsFiles", { enumerable: true, get: function () { return skillsGenerator_1.generateSkillsFiles; } });
Object.defineProperty(exports, "removeSkillsFiles", { enumerable: true, get: function () { return skillsGenerator_1.removeSkillsFiles; } });
// Skills generation config (Removed)
// export { setSkillsConfig, getSkillsConfig, DEFAULT_WHITELIST_TAGS } from "./skillsGenerator";
// export type { SkillsConfig } from "./skillsGenerator";
var llmClient_2 = require("./llmClient");
Object.defineProperty(exports, "summarizeFile", { enumerable: true, get: function () { return llmClient_2.summarizeFile; } });
async function buildIndex(projectRoot, outDir) {
    await (0, buildStubIndex_1.buildIndex)(projectRoot, outDir);
}
async function updateIndex(projectRoot, outDir) {
    const meta = await (0, metaStore_1.loadMeta)(outDir);
    const files = await (0, scanFiles_1.scanSourceFiles)(projectRoot);
    const seenPaths = new Set();
    for (const absolutePath of files) {
        const relativePath = path_1.default.relative(projectRoot, absolutePath);
        seenPaths.add(relativePath);
        const code = await (0, promises_1.readFile)(absolutePath, "utf8");
        const hash = (0, crypto_1.createHash)("sha1").update(code).digest("hex");
        const metaEntry = meta[relativePath];
        const isChanged = !metaEntry || metaEntry.hash !== hash;
        if (!isChanged) {
            continue;
        }
        const { dir, name } = path_1.default.parse(relativePath);
        const targetDir = path_1.default.join(outDir, "domains", dir);
        const targetPath = path_1.default.join(targetDir, `${name}_api.md`);
        await (0, promises_1.mkdir)(targetDir, { recursive: true });
        const markdown = await (0, llmClient_1.summarizeFile)(code, relativePath);
        await (0, promises_1.writeFile)(targetPath, markdown, "utf8");
        meta[relativePath] = {
            hash,
            skillDoc: markdown,
            lastUpdated: new Date().toISOString()
        };
    }
    // Clean up meta entries for files that no longer exist
    for (const relativePath of Object.keys(meta)) {
        if (!seenPaths.has(relativePath)) {
            delete meta[relativePath];
        }
    }
    await (0, metaStore_1.saveMeta)(outDir, meta);
}
// Routing Store
var routingStore_1 = require("./routingStore");
Object.defineProperty(exports, "ROUTING_SCHEMA_VERSION", { enumerable: true, get: function () { return routingStore_1.ROUTING_SCHEMA_VERSION; } });
Object.defineProperty(exports, "loadRouting", { enumerable: true, get: function () { return routingStore_1.loadRouting; } });
Object.defineProperty(exports, "saveRouting", { enumerable: true, get: function () { return routingStore_1.saveRouting; } });
Object.defineProperty(exports, "incrementTagScore", { enumerable: true, get: function () { return routingStore_1.incrementTagScore; } });
Object.defineProperty(exports, "updateSymbolDescription", { enumerable: true, get: function () { return routingStore_1.updateSymbolDescription; } });
Object.defineProperty(exports, "addSymbolTag", { enumerable: true, get: function () { return routingStore_1.addSymbolTag; } });
Object.defineProperty(exports, "removeSymbolTag", { enumerable: true, get: function () { return routingStore_1.removeSymbolTag; } });
Object.defineProperty(exports, "updateSymbolTags", { enumerable: true, get: function () { return routingStore_1.updateSymbolTags; } });
