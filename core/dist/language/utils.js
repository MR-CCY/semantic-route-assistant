"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.createScanner = createScanner;
exports.inferPathModuleHintGeneric = inferPathModuleHintGeneric;
exports.extractImplementationGeneric = extractImplementationGeneric;
const path_1 = __importDefault(require("path"));
const promises_1 = require("fs/promises");
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
    ig.add(["node_modules/", "**/node_modules/**"]);
    return ig;
}
/**
 * Create a source file scanner for specific file patterns.
 */
function createScanner(patterns) {
    return async function scanSourceFiles(projectRoot) {
        const ig = await loadIgnore(projectRoot);
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
    };
}
/**
 * Infer path module hint from file path.
 * Works for any language by extracting directory structure.
 */
function inferPathModuleHintGeneric(filePath) {
    const dir = path_1.default.dirname(filePath);
    const parts = dir.split(/[\\/]+/).filter(Boolean);
    // Remove common prefixes like src, lib, app
    const skipPrefixes = new Set(["src", "lib", "app", "pkg", "cmd", "internal"]);
    const filtered = parts.filter((part) => !skipPrefixes.has(part.toLowerCase()));
    return filtered.slice(-2).join("/") || path_1.default.basename(filePath, path_1.default.extname(filePath));
}
/**
 * Extract implementation snippet by finding function/method body.
 * Generic regex-based implementation.
 */
function extractImplementationGeneric(code, signature) {
    // Try to find the signature in the code
    const escapedSig = signature.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const pattern = new RegExp(escapedSig.split(/\s+/).join("\\s*"), "g");
    const match = pattern.exec(code);
    if (!match) {
        return null;
    }
    // Find the opening brace and extract the body
    const startIndex = match.index + match[0].length;
    const afterSig = code.slice(startIndex);
    const braceIndex = afterSig.indexOf("{");
    if (braceIndex === -1) {
        return null;
    }
    // Simple brace matching
    let depth = 0;
    let endIndex = -1;
    for (let i = braceIndex; i < afterSig.length; i++) {
        if (afterSig[i] === "{") {
            depth++;
        }
        else if (afterSig[i] === "}") {
            depth--;
            if (depth === 0) {
                endIndex = i + 1;
                break;
            }
        }
    }
    if (endIndex === -1) {
        return afterSig.slice(braceIndex, Math.min(braceIndex + 500, afterSig.length));
    }
    return afterSig.slice(braceIndex, endIndex);
}
