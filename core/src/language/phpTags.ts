import path from "path";
import type { BaseTagsInput } from "./adapterRegistry";

const STOP_WORDS = new Set([
    "php", "use", "namespace", "public", "private", "protected", "function"
]);

function splitCamelAndSnake(value: string): string[] {
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
 * PHP specific base tag inference.
 */
export function inferPhpBaseTags(input: BaseTagsInput): string[] {
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
    pushTokens(tags, splitCamelAndSnake(base), 2);

    const symbolParts = symbolId.split("\\");
    for (const part of symbolParts) {
        pushTokens(tags, splitCamelAndSnake(part), 3);
    }

    if (signature) {
        if (/\bclass\b/.test(signature)) tags.add("class");
        if (/\binterface\b/.test(signature)) tags.add("interface");
        if (/\btrait\b/.test(signature)) tags.add("trait");
        if (/\babstract\b/.test(signature)) tags.add("abstract");
        if (/\bstatic\b/.test(signature)) tags.add("static");

        const extendsMatch = signature.match(/extends\s+(\w+)/);
        if (extendsMatch) {
            tags.add(extendsMatch[1].toLowerCase());
        }

        const implementsMatch = signature.match(/implements\s+([\w,\s\\]+)/);
        if (implementsMatch) {
            const interfaces = implementsMatch[1].split(",").map((s) => s.trim().split("\\").pop() || "");
            for (const iface of interfaces) {
                if (iface.length >= 3) tags.add(iface.toLowerCase());
            }
        }
    }

    return Array.from(tags);
}
