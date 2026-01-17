import path from "path";
import type { BaseTagsInput } from "./adapterRegistry";

const STOP_WORDS = new Set([
    "get", "set", "do", "run", "ctx", "impl", "mgr", "mgrs",
    "util", "utils", "helper", "helpers", "src", "core",
    "server", "client", "common", "base", "main", "app"
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
 * Java-specific base tag inference.
 * Handles class, interface, extends, implements, annotations.
 */
export function inferJavaBaseTags(input: BaseTagsInput): string[] {
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

    // Tags from symbol ID (package.Class.method)
    const symbolParts = symbolId.split(".");
    for (const part of symbolParts) {
        pushTokens(tags, splitCamelAndSnake(part), 3);
    }

    // Add class name if method belongs to a class
    if (symbolParts.length >= 2) {
        const classPart = symbolParts[symbolParts.length - 2];
        if (classPart && /^[A-Z]/.test(classPart)) {
            tags.add(classPart.toLowerCase());
        }
    }

    // Parse Java-specific keywords from signature
    if (signature) {
        if (/\bclass\b/.test(signature)) {
            tags.add("class");
        }
        if (/\binterface\b/.test(signature)) {
            tags.add("interface");
        }
        if (/\benum\b/.test(signature)) {
            tags.add("enum");
        }
        if (/\babstract\b/.test(signature)) {
            tags.add("abstract");
        }
        if (/\bstatic\b/.test(signature)) {
            tags.add("static");
        }

        // Extract extends/implements
        const extendsMatch = signature.match(/\bextends\s+(\w+)/);
        if (extendsMatch) {
            tags.add(extendsMatch[1].toLowerCase());
            pushTokens(tags, splitCamelAndSnake(extendsMatch[1]), 2, { allowStopWords: true });
        }

        const implementsMatch = signature.match(/\bimplements\s+([\w,\s]+)/);
        if (implementsMatch) {
            const interfaces = implementsMatch[1].split(",").map((s) => s.trim());
            for (const iface of interfaces) {
                tags.add(iface.toLowerCase());
                pushTokens(tags, splitCamelAndSnake(iface), 2, { allowStopWords: true });
            }
        }

        // Extract annotations
        const annotations = signature.match(/@(\w+)/g);
        if (annotations) {
            for (const ann of annotations) {
                const name = ann.slice(1).toLowerCase();
                if (name.length >= 3) {
                    tags.add(name);
                }
            }
        }
    }

    return Array.from(tags);
}
