import path from "path";
import type { BaseTagsInput } from "./adapterRegistry";

const STOP_WORDS = new Set([
    "def", "end", "class", "module", "self", "attr", "require", "lib"
]);

function splitSnakeCase(value: string): string[] {
    return value
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
 * Ruby specific base tag inference.
 */
export function inferRubyBaseTags(input: BaseTagsInput): string[] {
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
    pushTokens(tags, splitSnakeCase(base), 2);

    const symbolParts = symbolId.split("::");
    for (const part of symbolParts) {
        pushTokens(tags, splitSnakeCase(part), 3);
    }

    if (signature) {
        if (/\bclass\b/.test(signature)) tags.add("class");
        if (/\bmodule\b/.test(signature)) tags.add("module");
        if (/\bdef\b/.test(signature)) tags.add("method");
        if (/\bself\.\w+/.test(signature)) tags.add("classmethod");
        if (/\bprivate\b/.test(signature)) tags.add("private");
        if (/\bprotected\b/.test(signature)) tags.add("protected");

        // Rails specific
        if (/\bhas_many\b/.test(signature)) tags.add("association");
        if (/\bbelongs_to\b/.test(signature)) tags.add("association");
        if (/\bhas_one\b/.test(signature)) tags.add("association");
        if (/\bvalidates\b/.test(signature)) tags.add("validation");
        if (/\bbefore_action\b/.test(signature)) tags.add("callback");
        if (/\bafter_action\b/.test(signature)) tags.add("callback");

        const inheritMatch = signature.match(/class\s+\w+\s*<\s*(\w+)/);
        if (inheritMatch) {
            tags.add(inheritMatch[1].toLowerCase());
        }
    }

    return Array.from(tags);
}
