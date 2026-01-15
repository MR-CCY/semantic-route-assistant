"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.searchSkills = exports.summarizeFile = exports.updateIndexV2 = exports.buildIndexV2 = void 0;
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
var indexV2_1 = require("./indexV2");
Object.defineProperty(exports, "buildIndexV2", { enumerable: true, get: function () { return indexV2_1.buildIndexV2; } });
Object.defineProperty(exports, "updateIndexV2", { enumerable: true, get: function () { return indexV2_1.updateIndexV2; } });
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
