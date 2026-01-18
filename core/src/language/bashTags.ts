import path from "path";
import type { BaseTagsInput } from "./adapterRegistry";

const STOP_WORDS = new Set([
    "bin", "bash", "sh", "zsh", "usr", "local", "env"
]);

function splitSnakeCase(value: string): string[] {
    return value
        .replace(/[_\-]+/g, " ")
        .split(" ")
        .map((token) => token.trim())
        .filter(Boolean);
}

function pushTokens(
    set: Set<string>,
    tokens: string[],
    minLen: number
): void {
    for (const token of tokens) {
        const normalized = token.toLowerCase();
        if (normalized.length < minLen) continue;
        if (STOP_WORDS.has(normalized)) continue;
        set.add(normalized);
    }
}

/**
 * Bash/Shell specific base tag inference.
 */
export function inferBashBaseTags(input: BaseTagsInput): string[] {
    const { symbolId, signature, filePath, pathModuleHint } = input;
    const tags = new Set<string>();

    tags.add("shell");
    tags.add("script");

    if (pathModuleHint) {
        pushTokens(tags, pathModuleHint.split(/[\\/]+/), 2);
    }

    const dir = path.dirname(filePath);
    if (dir && dir !== ".") {
        pushTokens(tags, dir.split(/[\\/]+/), 2);
    }

    const base = path.basename(filePath, path.extname(filePath));
    pushTokens(tags, splitSnakeCase(base), 2);

    // Split function name
    const funcParts = symbolId.split(/[_\-]+/);
    pushTokens(tags, funcParts, 3);

    if (signature) {
        if (/\bfunction\b/.test(signature)) {
            tags.add("function");
        }
        if (/\bexport\b/.test(signature)) {
            tags.add("export");
        }
        if (/\blocal\b/.test(signature)) {
            tags.add("local");
        }
    }

    return Array.from(tags);
}
