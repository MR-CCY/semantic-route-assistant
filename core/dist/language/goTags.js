"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.inferGoBaseTags = inferGoBaseTags;
const path_1 = __importDefault(require("path"));
const STOP_WORDS = new Set([
    "get", "set", "do", "run", "ctx", "impl", "mgr", "mgrs",
    "util", "utils", "helper", "helpers", "src", "core",
    "server", "client", "common", "base", "main", "app", "cmd", "pkg"
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
/**
 * Go-specific base tag inference.
 * Handles func, struct, interface, package.
 */
function inferGoBaseTags(input) {
    const { symbolId, signature, filePath, pathModuleHint } = input;
    const tags = new Set();
    // Tags from path
    if (pathModuleHint) {
        pushTokens(tags, pathModuleHint.split(/[\\/]+/), 2);
    }
    const dir = path_1.default.dirname(filePath);
    if (dir && dir !== ".") {
        pushTokens(tags, dir.split(/[\\/]+/), 2);
    }
    const base = path_1.default.basename(filePath, path_1.default.extname(filePath));
    if (base !== "main" && !base.endsWith("_test")) {
        pushTokens(tags, splitCamelAndSnake(base), 2);
    }
    // Tags from symbol ID (package.Type.Method)
    const symbolParts = symbolId.split(".");
    for (const part of symbolParts) {
        pushTokens(tags, splitCamelAndSnake(part), 3);
    }
    // Add type name if method belongs to a type
    if (symbolParts.length >= 2) {
        const typePart = symbolParts[symbolParts.length - 2];
        if (typePart && /^[A-Z]/.test(typePart)) {
            tags.add(typePart.toLowerCase());
        }
    }
    // Parse Go-specific keywords from signature
    if (signature) {
        if (/\bfunc\b/.test(signature)) {
            tags.add("func");
        }
        if (/\btype\s+\w+\s+struct\b/.test(signature)) {
            tags.add("struct");
        }
        if (/\btype\s+\w+\s+interface\b/.test(signature)) {
            tags.add("interface");
        }
        if (/\bpackage\b/.test(signature)) {
            tags.add("package");
        }
        // Check if it's an exported symbol (starts with uppercase)
        const funcMatch = signature.match(/\bfunc\s+(?:\([^)]+\)\s+)?(\w+)/);
        if (funcMatch) {
            const funcName = funcMatch[1];
            if (/^[A-Z]/.test(funcName)) {
                tags.add("exported");
            }
        }
        // Extract receiver type for methods
        const receiverMatch = signature.match(/\bfunc\s+\((\w+)\s+\*?(\w+)\)/);
        if (receiverMatch) {
            tags.add("method");
            const typeName = receiverMatch[2];
            tags.add(typeName.toLowerCase());
            pushTokens(tags, splitCamelAndSnake(typeName), 2, { allowStopWords: true });
        }
        // Extract embedded types in struct
        const structMatch = signature.match(/type\s+\w+\s+struct\s*\{([^}]*)\}/);
        if (structMatch) {
            const fields = structMatch[1];
            // Look for embedded types (lines with just a type name)
            const embedded = fields.match(/^\s*(\w+)\s*$/gm);
            if (embedded) {
                for (const emb of embedded) {
                    const name = emb.trim();
                    if (name && /^[A-Z]/.test(name)) {
                        tags.add(name.toLowerCase());
                    }
                }
            }
        }
    }
    return Array.from(tags);
}
