"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.buildStubIndex = void 0;
exports.buildIndex = buildIndex;
const path_1 = __importDefault(require("path"));
const promises_1 = require("fs/promises");
const scanFiles_1 = require("./scanFiles");
const llmClient_1 = require("./llmClient");
async function buildIndex(projectRoot, outDir) {
    const files = await (0, scanFiles_1.scanSourceFiles)(projectRoot);
    for (const absolutePath of files) {
        const relativePath = path_1.default.relative(projectRoot, absolutePath);
        const { dir, name } = path_1.default.parse(relativePath);
        const targetDir = path_1.default.join(outDir, "domains", dir);
        const targetPath = path_1.default.join(targetDir, `${name}_api.md`);
        await (0, promises_1.mkdir)(targetDir, { recursive: true });
        const code = await (0, promises_1.readFile)(absolutePath, "utf8");
        const markdown = await (0, llmClient_1.summarizeFile)(code, relativePath);
        await (0, promises_1.writeFile)(targetPath, markdown, "utf8");
    }
}
// Backward-compatible alias for callers still using the old name.
exports.buildStubIndex = buildIndex;
