"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.inferPythonBaseTags = inferPythonBaseTags;
const path_1 = __importDefault(require("path"));
const STOP_WORDS = new Set([
    "get", "set", "do", "run", "ctx", "impl", "mgr", "mgrs",
    "util", "utils", "helper", "helpers", "src", "core",
    "server", "client", "common", "base", "main", "app"
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
 * Python-specific base tag inference.
 * Handles class, def, async, decorators, inheritance.
 */
function inferPythonBaseTags(input) {
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
    if (base !== "__init__") {
        pushTokens(tags, splitCamelAndSnake(base), 2);
    }
    // Tags from symbol ID (module.Class.method)
    const symbolParts = symbolId.split(".");
    for (const part of symbolParts) {
        if (part !== "__init__") {
            pushTokens(tags, splitCamelAndSnake(part), 3);
        }
    }
    // Add class name if method belongs to a class
    if (symbolParts.length >= 2) {
        const classPart = symbolParts[symbolParts.length - 2];
        if (classPart && /^[A-Z]/.test(classPart)) {
            tags.add(classPart.toLowerCase());
        }
    }
    // Parse Python-specific keywords from signature
    if (signature) {
        if (/\bclass\b/.test(signature)) {
            tags.add("class");
        }
        if (/\bdef\b/.test(signature)) {
            tags.add("function");
        }
        if (/\basync\s+def\b/.test(signature)) {
            tags.add("async");
        }
        if (/\b__init__\b/.test(signature)) {
            tags.add("constructor");
        }
        if (/\b__\w+__\b/.test(signature)) {
            tags.add("dunder");
        }
        if (/\bself\b/.test(signature)) {
            tags.add("method");
        }
        if (/\bcls\b/.test(signature)) {
            tags.add("classmethod");
        }
        if (/\b@staticmethod\b/.test(signature)) {
            tags.add("staticmethod");
        }
        if (/\b@classmethod\b/.test(signature)) {
            tags.add("classmethod");
        }
        if (/\b@property\b/.test(signature)) {
            tags.add("property");
        }
        // Extract inheritance
        const classMatch = signature.match(/class\s+\w+\s*\(([^)]+)\)/);
        if (classMatch) {
            const bases = classMatch[1].split(",").map((s) => s.trim());
            for (const base of bases) {
                const baseName = base.split(".").pop() || base;
                if (baseName && baseName !== "object") {
                    tags.add(baseName.toLowerCase());
                    pushTokens(tags, splitCamelAndSnake(baseName), 2, { allowStopWords: true });
                }
            }
        }
        // Extract decorators
        const decorators = signature.match(/@(\w+)/g);
        if (decorators) {
            for (const dec of decorators) {
                const name = dec.slice(1).toLowerCase();
                if (name.length >= 3 && !["staticmethod", "classmethod", "property"].includes(name)) {
                    tags.add(name);
                }
            }
        }
    }
    return Array.from(tags);
}
