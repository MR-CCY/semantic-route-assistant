"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.inferBaseTagsForSymbol = inferBaseTagsForSymbol;
const path_1 = __importDefault(require("path"));
const STOP_WORDS = new Set([
    "get",
    "set",
    "do",
    "run",
    "ctx",
    "impl",
    "mgr",
    "mgrs",
    "util",
    "utils",
    "helper",
    "helpers"
]);
function splitCamelAndSnake(value) {
    return value
        .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
        .replace(/[_\-\s]+/g, " ")
        .split(" ")
        .map((token) => token.trim())
        .filter(Boolean);
}
function pushTokens(set, tokens, minLen) {
    for (const token of tokens) {
        const normalized = token.toLowerCase();
        if (normalized.length < minLen) {
            continue;
        }
        if (STOP_WORDS.has(normalized)) {
            continue;
        }
        set.add(normalized);
    }
}
function inferBaseTagsForSymbol(params) {
    const { moduleId, pathModuleHint, filePath, symbolId } = params;
    const tags = new Set();
    if (pathModuleHint) {
        const parts = pathModuleHint.split(/[\\/]+/);
        pushTokens(tags, parts, 2);
    }
    if (moduleId) {
        pushTokens(tags, splitCamelAndSnake(moduleId), 2);
    }
    const dir = path_1.default.dirname(filePath);
    if (dir && dir !== ".") {
        const dirParts = dir.split(/[\\/]+/);
        pushTokens(tags, dirParts, 2);
    }
    const base = path_1.default.basename(filePath, path_1.default.extname(filePath));
    pushTokens(tags, splitCamelAndSnake(base), 2);
    const symbolParts = symbolId.split("::");
    for (const part of symbolParts) {
        pushTokens(tags, splitCamelAndSnake(part), 3);
    }
    const limited = Array.from(tags);
    return limited.slice(0, 8);
}
