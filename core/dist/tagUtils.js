"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.inferBaseTagsForSymbol = inferBaseTagsForSymbol;
exports.filterSemanticTags = filterSemanticTags;
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
    "helpers",
    "src",
    "core",
    "server",
    "client",
    "common",
    "base",
    "async",
    "await",
    "sync",
    "promise",
    "promises",
    "callback",
    "callbacks",
    "try",
    "catch",
    "try_catch",
    "module",
    "modules",
    "config",
    "configuration",
    "method",
    "methods",
    "get",
    "post",
    "put",
    "delete",
    "request",
    "response",
    "header",
    "headers",
    "body",
    "http",
    "api",
    "url",
    "uri",
    "query",
    "params",
    "service",
    "handler",
    "handlers",
    "manager",
    "managers",
    "data"
]);
function splitCamelAndSnake(value) {
    return value
        .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
        .replace(/[_\-\s]+/g, " ")
        .split(" ")
        .map((token) => token.trim())
        .filter(Boolean);
}
function pushTokens(set, tokens, minLen, options) {
    for (const token of tokens) {
        const normalized = token.toLowerCase();
        if (normalized.length < minLen) {
            continue;
        }
        if (!options?.allowStopWords && STOP_WORDS.has(normalized)) {
            continue;
        }
        set.add(normalized);
    }
}
function collectLowInfoTags(filePath, symbolId, baseTags) {
    const lowInfo = new Set();
    for (const tag of baseTags) {
        const normalized = tag.trim().toLowerCase();
        if (normalized) {
            lowInfo.add(normalized);
        }
    }
    const pathParts = filePath.split(/[\\/]+/);
    for (const part of pathParts) {
        const normalized = part.replace(/\.[a-z0-9]+$/i, "");
        for (const token of splitCamelAndSnake(normalized)) {
            if (token) {
                lowInfo.add(token.toLowerCase());
            }
        }
    }
    const symbolParts = symbolId.split("::");
    for (const part of symbolParts) {
        for (const token of splitCamelAndSnake(part)) {
            if (token) {
                lowInfo.add(token.toLowerCase());
            }
        }
    }
    return lowInfo;
}
/**
 * @deprecated Use adapter.inferBaseTags() instead for language-specific tag inference.
 * This function is kept for backward compatibility but delegates to a basic implementation.
 */
function inferBaseTagsForSymbol(params) {
    const { pathModuleHint, filePath, symbolId } = params;
    const tags = new Set();
    // Basic path-based tags only
    if (pathModuleHint) {
        const parts = pathModuleHint.split(/[\\/]+/);
        pushTokens(tags, parts, 2);
    }
    const dir = path_1.default.dirname(filePath);
    if (dir && dir !== ".") {
        const dirParts = dir.split(/[\\/]+/);
        pushTokens(tags, dirParts, 2);
    }
    const base = path_1.default.basename(filePath, path_1.default.extname(filePath));
    pushTokens(tags, splitCamelAndSnake(base), 2);
    // Basic symbol ID splitting (language-agnostic: split by common delimiters)
    const symbolParts = symbolId.split(/[:.]+/);
    for (const part of symbolParts) {
        pushTokens(tags, splitCamelAndSnake(part), 3);
    }
    return Array.from(tags);
}
function filterSemanticTags(params) {
    const { semanticTags, baseTags, filePath, symbolId } = params;
    console.log(`[filterSemanticTags] before file=${filePath} symbol=${symbolId} semanticTags=${JSON.stringify(semanticTags)} baseTags=${JSON.stringify(baseTags)}`);
    const lowInfo = collectLowInfoTags(filePath, symbolId, baseTags);
    const filtered = [];
    const seen = new Set();
    for (const tag of semanticTags) {
        const normalized = tag.trim().toLowerCase();
        if (!normalized || normalized.length < 3) {
            continue;
        }
        if (STOP_WORDS.has(normalized)) {
            continue;
        }
        if (lowInfo.has(normalized)) {
            continue;
        }
        if (seen.has(normalized)) {
            continue;
        }
        seen.add(normalized);
        filtered.push(normalized);
    }
    return filtered;
}
