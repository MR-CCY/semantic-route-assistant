import path from "path";
import { readFile, access } from "fs/promises";
import fg from "fast-glob";
import ignore from "ignore";

async function loadIgnore(projectRoot: string): Promise<ReturnType<typeof ignore>> {
    const ig = ignore();
    const gitignorePath = path.join(projectRoot, ".gitignore");

    try {
        await access(gitignorePath);
        const content = await readFile(gitignorePath, "utf8");
        ig.add(content);
    } catch (error: any) {
        if (error?.code !== "ENOENT") {
            throw error;
        }
    }

    return ig;
}

/**
 * Create a source file scanner for specific file patterns.
 */
export function createScanner(patterns: string[]) {
    return async function scanSourceFiles(projectRoot: string): Promise<string[]> {
        const ig = await loadIgnore(projectRoot);

        const matches = await fg(patterns, {
            cwd: projectRoot,
            onlyFiles: true,
            dot: false,
            absolute: true
        });

        const filtered = matches.filter((filePath) => {
            const relative = path.relative(projectRoot, filePath);
            return !ig.ignores(relative);
        });

        return filtered;
    };
}

/**
 * Infer path module hint from file path.
 * Works for any language by extracting directory structure.
 */
export function inferPathModuleHintGeneric(filePath: string): string {
    const dir = path.dirname(filePath);
    const parts = dir.split(/[\\/]+/).filter(Boolean);
    // Remove common prefixes like src, lib, app
    const skipPrefixes = new Set(["src", "lib", "app", "pkg", "cmd", "internal"]);
    const filtered = parts.filter((part) => !skipPrefixes.has(part.toLowerCase()));
    return filtered.slice(-2).join("/") || path.basename(filePath, path.extname(filePath));
}

/**
 * Extract implementation snippet by finding function/method body.
 * Generic regex-based implementation.
 */
export function extractImplementationGeneric(code: string, signature: string): string | null {
    // Try to find the signature in the code
    const escapedSig = signature.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const pattern = new RegExp(escapedSig.split(/\s+/).join("\\s*"), "g");
    const match = pattern.exec(code);
    if (!match) {
        return null;
    }

    // Find the opening brace and extract the body
    const startIndex = match.index + match[0].length;
    const afterSig = code.slice(startIndex);
    const braceIndex = afterSig.indexOf("{");
    if (braceIndex === -1) {
        return null;
    }

    // Simple brace matching
    let depth = 0;
    let endIndex = -1;
    for (let i = braceIndex; i < afterSig.length; i++) {
        if (afterSig[i] === "{") {
            depth++;
        } else if (afterSig[i] === "}") {
            depth--;
            if (depth === 0) {
                endIndex = i + 1;
                break;
            }
        }
    }

    if (endIndex === -1) {
        return afterSig.slice(braceIndex, Math.min(braceIndex + 500, afterSig.length));
    }

    return afterSig.slice(braceIndex, endIndex);
}
