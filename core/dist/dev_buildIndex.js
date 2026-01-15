"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const path_1 = __importDefault(require("path"));
const index_1 = require("./index");
const scanFiles_1 = require("./scanFiles");
async function main() {
    const projectRoot = process.argv[2];
    const outDirArg = process.argv[3];
    if (!projectRoot) {
        console.error("Usage: npx ts-node src/dev_buildIndex.ts <projectRoot> [outDir]");
        process.exit(1);
    }
    const outDir = outDirArg ?? path_1.default.join(projectRoot, "llm_index");
    console.log(`[buildIndex] start projectRoot=${projectRoot} outDir=${outDir}`);
    const files = await (0, scanFiles_1.scanSourceFiles)(projectRoot);
    console.log(`[buildIndex] found ${files.length} source files`);
    await (0, index_1.buildIndex)(projectRoot, outDir);
    console.log("[buildIndex] done");
}
main().catch((error) => {
    console.error("[buildIndex] failed", error);
    process.exit(1);
});
