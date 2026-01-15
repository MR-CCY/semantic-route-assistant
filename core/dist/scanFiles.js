"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.scanSourceFiles = scanSourceFiles;
const promises_1 = require("fs/promises");
const path_1 = __importDefault(require("path"));
const fast_glob_1 = __importDefault(require("fast-glob"));
const ignore_1 = __importDefault(require("ignore"));
async function loadIgnore(projectRoot) {
    const ig = (0, ignore_1.default)();
    const gitignorePath = path_1.default.join(projectRoot, ".gitignore");
    try {
        await (0, promises_1.access)(gitignorePath);
        const content = await (0, promises_1.readFile)(gitignorePath, "utf8");
        ig.add(content);
    }
    catch (error) {
        if (error?.code !== "ENOENT") {
            throw error;
        }
    }
    return ig;
}
async function scanSourceFiles(projectRoot) {
    const ig = await loadIgnore(projectRoot);
    const matches = await (0, fast_glob_1.default)(["**/*.h", "**/*.hpp", "**/*.cpp"], {
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
