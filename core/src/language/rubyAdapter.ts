import path from "path";
import { readFile } from "fs/promises";
import type { ExtractedSymbol } from "../symbolExtractor";
import type { ImplementationInput, ImplementationResult } from "../extract/implementationExtractor";
import type { LanguageAdapter } from "./adapterRegistry";
import { createScanner, inferPathModuleHintGeneric } from "./utils";
import { inferRubyBaseTags } from "./rubyTags";

const scanSourceFiles = createScanner(["**/*.rb", "**/*.rake"]);

/**
 * Extract Ruby symbols using regex.
 */
function extractSymbolsFromCode(code: string, filePath: string): ExtractedSymbol[] {
    const symbols: ExtractedSymbol[] = [];

    // Class pattern
    const classPattern = /^(\s*)class\s+(\w+)(?:\s*<\s*(\w+))?\s*$/gm;
    let match;

    while ((match = classPattern.exec(code)) !== null) {
        const className = match[2];
        const superClass = match[3] || "";
        const lineNum = code.slice(0, match.index).split("\n").length;

        let signature = `class ${className}`;
        if (superClass) signature += ` < ${superClass}`;

        symbols.push({
            id: className,
            kind: "class",
            signature,
            declHash: "",
            filePath,
            declLine: lineNum
        });
    }

    // Module pattern
    const modulePattern = /^(\s*)module\s+(\w+)\s*$/gm;
    while ((match = modulePattern.exec(code)) !== null) {
        const moduleName = match[2];
        const lineNum = code.slice(0, match.index).split("\n").length;

        symbols.push({
            id: moduleName,
            kind: "class",
            signature: `module ${moduleName}`,
            declHash: "",
            filePath,
            declLine: lineNum
        });
    }

    // Method pattern: def method_name or def self.method_name
    const defPattern = /^(\s*)def\s+(self\.)?(\w+[?!=]?)\s*(?:\(([^)]*)\))?\s*$/gm;
    while ((match = defPattern.exec(code)) !== null) {
        const indent = match[1];
        const isSelf = !!match[2];
        const methodName = match[3];
        const params = match[4]?.trim() || "";
        const lineNum = code.slice(0, match.index).split("\n").length;

        const signature = isSelf
            ? `def self.${methodName}(${params})`
            : `def ${methodName}(${params})`;

        // Try to find enclosing class/module
        let enclosingClass = "";
        const beforeDef = code.slice(0, match.index);
        const classMatches = [...beforeDef.matchAll(/^(\s*)(?:class|module)\s+(\w+)/gm)];
        for (const cm of classMatches.reverse()) {
            if (cm[1].length < indent.length) {
                enclosingClass = cm[2];
                break;
            }
        }

        const id = enclosingClass ? `${enclosingClass}::${methodName}` : methodName;

        symbols.push({
            id,
            kind: "function",
            signature,
            declHash: "",
            filePath,
            declLine: lineNum
        });
    }

    return symbols;
}

/**
 * Extract Ruby method body (end-based).
 */
function extractImplementationFromCode(code: string, signature: string): string | null {
    const defMatch = signature.match(/def\s+(self\.)?(\w+[?!=]?)/);
    if (!defMatch) return null;
    const isSelf = !!defMatch[1];
    const methodName = defMatch[2];

    const pattern = isSelf
        ? new RegExp(`^(\\s*)def\\s+self\\.${methodName.replace(/[?!=]/g, "\\$&")}`, "m")
        : new RegExp(`^(\\s*)def\\s+${methodName.replace(/[?!=]/g, "\\$&")}`, "m");

    const match = pattern.exec(code);
    if (!match) return null;

    const startIndex = match.index;
    const baseIndent = match[1].length;
    const lines = code.slice(startIndex).split("\n").slice(1);
    const bodyLines: string[] = [];

    for (const line of lines) {
        const lineIndent = line.match(/^\s*/)?.[0].length || 0;
        const trimmed = line.trim();
        if (trimmed === "end" && lineIndent === baseIndent) {
            break;
        }
        bodyLines.push(line);
    }

    return bodyLines.join("\n").trim() || null;
}

async function extractImplementationForSymbol(
    input: ImplementationInput
): Promise<ImplementationResult> {
    try {
        const absolutePath = path.isAbsolute(input.filePath)
            ? input.filePath
            : path.join(input.projectRoot, input.filePath);
        const code = await readFile(absolutePath, "utf8");
        const impl = extractImplementationFromCode(code, input.signature);
        return { implementation: impl };
    } catch {
        return { implementation: null };
    }
}

export const rubyAdapter: LanguageAdapter = {
    id: "ruby",
    displayName: "Ruby",
    fileExtensions: ["rb", "rake"],
    scanSourceFiles,
    extractSymbolsFromCode,
    extractImplementationFromCode,
    extractImplementationForSymbol,
    inferPathModuleHint: inferPathModuleHintGeneric,
    inferBaseTags: inferRubyBaseTags
};
