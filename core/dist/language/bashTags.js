"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.inferBashBaseTags = inferBashBaseTags;
const path_1 = __importDefault(require("path"));
const STOP_WORDS = new Set([
    "bin", "bash", "sh", "zsh", "usr", "local", "env"
]);
function splitSnakeCase(value) {
    return value
        .replace(/[_\-]+/g, " ")
        .split(" ")
        .map((token) => token.trim())
        .filter(Boolean);
}
function pushTokens(set, tokens, minLen) {
    for (const token of tokens) {
        const normalized = token.toLowerCase();
        if (normalized.length < minLen)
            continue;
        if (STOP_WORDS.has(normalized))
            continue;
        set.add(normalized);
    }
}
/**
 * Bash/Shell specific base tag inference.
 */
function inferBashBaseTags(input) {
    const { symbolId, signature, filePath, pathModuleHint } = input;
    const tags = new Set();
    tags.add("shell");
    tags.add("script");
    if (pathModuleHint) {
        pushTokens(tags, pathModuleHint.split(/[\\/]+/), 2);
    }
    const dir = path_1.default.dirname(filePath);
    if (dir && dir !== ".") {
        pushTokens(tags, dir.split(/[\\/]+/), 2);
    }
    const base = path_1.default.basename(filePath, path_1.default.extname(filePath));
    pushTokens(tags, splitSnakeCase(base), 2);
    // Split function name
    const funcParts = symbolId.split(/[_\-]+/);
    pushTokens(tags, funcParts, 3);
    if (signature) {
        if (/\bfunction\b/.test(signature)) {
            tags.add("function");
        }
        if (/\bexport\b/.test(signature)) {
            tags.add("export");
        }
        if (/\blocal\b/.test(signature)) {
            tags.add("local");
        }
    }
    return Array.from(tags);
}
