"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.inferCppBaseTags = inferCppBaseTags;
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
    "base"
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
 * C++ specific base tag inference.
 * Handles class/struct, inheritance, namespace (::) etc.
 */
function inferCppBaseTags(input) {
    const { symbolId, signature, filePath, pathModuleHint } = input;
    const tags = new Set();
    // Tags from path module hint
    if (pathModuleHint) {
        const parts = pathModuleHint.split(/[\\/]+/);
        pushTokens(tags, parts, 2);
    }
    // Tags from directory path
    const dir = path_1.default.dirname(filePath);
    if (dir && dir !== ".") {
        const dirParts = dir.split(/[\\/]+/);
        pushTokens(tags, dirParts, 2);
    }
    // Tags from file name
    const base = path_1.default.basename(filePath, path_1.default.extname(filePath));
    pushTokens(tags, splitCamelAndSnake(base), 2);
    // Tags from symbol ID (namespace::class::method)
    const symbolParts = symbolId.split("::");
    for (const part of symbolParts) {
        pushTokens(tags, splitCamelAndSnake(part), 3);
    }
    // Rule 1: If function belongs to a class, add the class name as a tag
    if (symbolParts.length >= 2) {
        const classPart = symbolParts[symbolParts.length - 2];
        if (classPart) {
            tags.add(classPart.toLowerCase());
            pushTokens(tags, splitCamelAndSnake(classPart), 2, { allowStopWords: true });
        }
    }
    // Rule 2 & 3: Handle class/struct signatures
    if (signature) {
        const isClass = /^class\b/.test(signature);
        const isStruct = /^struct\b/.test(signature);
        // Rule 2: Add "class" or "struct" tag for class types
        if (isClass) {
            tags.add("class");
        }
        else if (isStruct) {
            tags.add("struct");
        }
        // Rule 3: For class/struct, add own class name and base class names as tags
        if (isClass || isStruct) {
            // Add own class name as tag
            const ownClassName = symbolParts[symbolParts.length - 1];
            if (ownClassName) {
                tags.add(ownClassName.toLowerCase());
                pushTokens(tags, splitCamelAndSnake(ownClassName), 2, { allowStopWords: true });
            }
            // Parse inheritance: "class Foo : public Bar, private Baz"
            const colonIndex = signature.indexOf(":");
            if (colonIndex !== -1) {
                const afterColon = signature.slice(colonIndex + 1);
                const beforeBrace = afterColon.split("{")[0];
                const baseList = beforeBrace
                    .split(",")
                    .map((entry) => entry
                    .replace(/\b(public|private|protected|virtual|final)\b/g, "")
                    .trim())
                    .filter(Boolean);
                for (const baseEntry of baseList) {
                    const parts = baseEntry.split("::");
                    const baseClassName = parts[parts.length - 1];
                    if (baseClassName) {
                        tags.add(baseClassName.toLowerCase());
                    }
                    for (const part of parts) {
                        pushTokens(tags, splitCamelAndSnake(part), 2, { allowStopWords: true });
                    }
                }
            }
        }
    }
    return Array.from(tags);
}
