import path from "path";
import type { BaseTagsInput } from "./adapterRegistry";

const STOP_WORDS = new Set([
    "mod", "pub", "use", "crate", "self", "super", "src", "lib"
]);

function splitSnakeCase(value: string): string[] {
    return value
        .replace(/[_\-]+/g, " ")
        .split(" ")
        .map((token) => token.trim())
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
 * Rust specific base tag inference.
 */
export function inferRustBaseTags(input: BaseTagsInput): string[] {
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
    if (base !== "mod" && base !== "lib" && base !== "main") {
        pushTokens(tags, splitSnakeCase(base), 2);
    }

    const symbolParts = symbolId.split("::");
    for (const part of symbolParts) {
        pushTokens(tags, splitSnakeCase(part), 3);
    }

    if (signature) {
        if (/\bstruct\b/.test(signature)) tags.add("struct");
        if (/\benum\b/.test(signature)) tags.add("enum");
        if (/\btrait\b/.test(signature)) tags.add("trait");
        if (/\bimpl\b/.test(signature)) tags.add("impl");
        if (/\bfn\b/.test(signature)) tags.add("function");
        if (/\basync\b/.test(signature)) tags.add("async");
        if (/\bpub\b/.test(signature)) tags.add("public");
        if (/\bunsafe\b/.test(signature)) tags.add("unsafe");

        // Extract trait impl: impl Trait for Type
        const implMatch = signature.match(/impl\s+(\w+)\s+for\s+(\w+)/);
        if (implMatch) {
            tags.add(implMatch[1].toLowerCase());
            tags.add(implMatch[2].toLowerCase());
        }

        // Extract derive macros
        const deriveMatch = signature.match(/#\[derive\(([^)]+)\)\]/);
        if (deriveMatch) {
            const derives = deriveMatch[1].split(",").map((s) => s.trim());
            for (const d of derives) {
                if (d.length >= 3) tags.add(d.toLowerCase());
            }
        }
    }

    return Array.from(tags);
}
