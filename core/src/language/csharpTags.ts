import path from "path";
import type { BaseTagsInput } from "./adapterRegistry";

const STOP_WORDS = new Set([
    "get", "set", "using", "system", "namespace", "var", "public", "private"
]);

function splitCamelCase(value: string): string[] {
    return value
        .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
        .replace(/[_\-]+/g, " ")
        .split(" ")
        .map((t) => t.trim())
        .filter(Boolean);
}

function pushTokens(set: Set<string>, tokens: string[], minLen: number): void {
    for (const token of tokens) {
        const normalized = token.toLowerCase();
        if (normalized.length < minLen) continue;
        if (STOP_WORDS.has(normalized)) continue;
        set.add(normalized);
    }
}

/**
 * C# specific base tag inference.
 */
export function inferCsharpBaseTags(input: BaseTagsInput): string[] {
    const { symbolId, signature, filePath, pathModuleHint } = input;
    const tags = new Set<string>();

    if (pathModuleHint) {
        pushTokens(tags, pathModuleHint.split(/[\\/]+/), 2);
    }

    const dir = path.dirname(filePath);
    if (dir && dir !== ".") {
        pushTokens(tags, dir.split(/[\\/]+/), 2);
    }

    const base = path.basename(filePath, path.extname(filePath));
    pushTokens(tags, splitCamelCase(base), 2);

    const symbolParts = symbolId.split(".");
    for (const part of symbolParts) {
        pushTokens(tags, splitCamelCase(part), 3);
    }

    if (symbolParts.length >= 2) {
        const classPart = symbolParts[symbolParts.length - 2];
        if (classPart && /^[A-Z]/.test(classPart)) {
            tags.add(classPart.toLowerCase());
        }
    }

    if (signature) {
        if (/\bclass\b/.test(signature)) tags.add("class");
        if (/\binterface\b/.test(signature)) tags.add("interface");
        if (/\bstruct\b/.test(signature)) tags.add("struct");
        if (/\benum\b/.test(signature)) tags.add("enum");
        if (/\babstract\b/.test(signature)) tags.add("abstract");
        if (/\bstatic\b/.test(signature)) tags.add("static");
        if (/\basync\b/.test(signature)) tags.add("async");

        const extendsMatch = signature.match(/:\s*(\w+)/);
        if (extendsMatch) {
            tags.add(extendsMatch[1].toLowerCase());
        }

        // Extract attributes [Attribute]
        const attrs = signature.match(/\[(\w+)/g);
        if (attrs) {
            for (const attr of attrs) {
                const name = attr.slice(1).toLowerCase();
                if (name.length >= 3) tags.add(name);
            }
        }
    }

    return Array.from(tags);
}
