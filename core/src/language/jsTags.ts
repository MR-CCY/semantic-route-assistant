import path from "path";
import type { BaseTagsInput } from "./adapterRegistry";

const STOP_WORDS = new Set([
    "get", "set", "do", "run", "ctx", "impl", "mgr", "mgrs",
    "util", "utils", "helper", "helpers", "src", "core",
    "server", "client", "common", "base", "main", "app", "index"
]);

function splitCamelAndSnake(value: string): string[] {
    return value
        .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
        .replace(/[_\-\s]+/g, " ")
        .split(" ")
        .map((token) => token.trim())
        .filter(Boolean);
}

function pushTokens(
    set: Set<string>,
    tokens: string[],
    minLen: number,
    options?: { allowStopWords?: boolean }
): void {
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
 * JavaScript/TypeScript/Vue specific base tag inference.
 * Handles class, function, arrow functions, exports, async.
 */
export function inferJsBaseTags(input: BaseTagsInput): string[] {
    const { symbolId, signature, filePath, pathModuleHint } = input;
    const tags = new Set<string>();

    // Tags from path
    if (pathModuleHint) {
        pushTokens(tags, pathModuleHint.split(/[\\/]+/), 2);
    }

    const dir = path.dirname(filePath);
    if (dir && dir !== ".") {
        pushTokens(tags, dir.split(/[\\/]+/), 2);
    }

    const base = path.basename(filePath, path.extname(filePath));
    pushTokens(tags, splitCamelAndSnake(base), 2);

    // Vue file gets vue tag
    const ext = path.extname(filePath).toLowerCase();
    if (ext === ".vue") {
        tags.add("vue");
        tags.add("component");
    }
    if (ext === ".tsx" || ext === ".jsx") {
        tags.add("jsx");
        tags.add("component");
    }
    if (ext === ".ts" || ext === ".tsx") {
        tags.add("typescript");
    }

    // Tags from symbol ID
    const symbolParts = symbolId.split(".");
    for (const part of symbolParts) {
        pushTokens(tags, splitCamelAndSnake(part), 3);
    }

    // Add class/component name
    if (symbolParts.length >= 2) {
        const classPart = symbolParts[symbolParts.length - 2];
        if (classPart && /^[A-Z]/.test(classPart)) {
            tags.add(classPart.toLowerCase());
        }
    }

    // Parse JS-specific keywords from signature
    if (signature) {
        if (/\bclass\b/.test(signature)) {
            tags.add("class");
        }
        if (/\bfunction\b/.test(signature)) {
            tags.add("function");
        }
        if (/\basync\b/.test(signature)) {
            tags.add("async");
        }
        if (/\bexport\b/.test(signature)) {
            tags.add("export");
        }
        if (/\bdefault\b/.test(signature)) {
            tags.add("default");
        }
        if (/\bconst\b/.test(signature) && /=>/.test(signature)) {
            tags.add("arrow");
        }

        // Extract extends
        const extendsMatch = signature.match(/\bextends\s+(\w+)/);
        if (extendsMatch) {
            tags.add(extendsMatch[1].toLowerCase());
            pushTokens(tags, splitCamelAndSnake(extendsMatch[1]), 2, { allowStopWords: true });
        }

        // Extract decorators (TypeScript/Vue)
        const decorators = signature.match(/@(\w+)/g);
        if (decorators) {
            for (const dec of decorators) {
                const name = dec.slice(1).toLowerCase();
                if (name.length >= 3) {
                    tags.add(name);
                }
            }
        }
    }

    return Array.from(tags);
}
