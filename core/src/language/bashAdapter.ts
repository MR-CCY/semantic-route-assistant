import path from "path";
import { readFile } from "fs/promises";
import type { ExtractedSymbol } from "../symbolExtractor";
import type { ImplementationInput, ImplementationResult } from "../extract/implementationExtractor";
import type { LanguageAdapter } from "./adapterRegistry";
import { createScanner, inferPathModuleHintGeneric } from "./utils";
import { inferBashBaseTags } from "./bashTags";

const scanSourceFiles = createScanner(["**/*.sh", "**/*.bash", "**/*.zsh"]);

/**
 * Extract Bash symbols using regex (function declarations).
 */
function extractSymbolsFromCode(code: string, filePath: string): ExtractedSymbol[] {
    const symbols: ExtractedSymbol[] = [];

    // Function pattern: function name() or name()
    const funcPattern = /^(\s*)(function\s+)?(\w+)\s*\(\s*\)\s*\{/gm;
    let match;

    while ((match = funcPattern.exec(code)) !== null) {
        const hasKeyword = !!match[2];
        const funcName = match[3];
        const lineNum = code.slice(0, match.index).split("\n").length;

        const signature = hasKeyword ? `function ${funcName}()` : `${funcName}()`;

        symbols.push({
            id: funcName,
            kind: "function",
            signature,
            declHash: "",
            filePath,
            declLine: lineNum
        });
    }

    return symbols;
}

function extractImplementationFromCode(code: string, signature: string): string | null {
    const funcMatch = signature.match(/(?:function\s+)?(\w+)\s*\(\)/);
    if (!funcMatch) return null;
    const funcName = funcMatch[1];

    const pattern = new RegExp(`(?:function\\s+)?${funcName}\\s*\\(\\s*\\)\\s*\\{`, "g");
    const match = pattern.exec(code);
    if (!match) return null;

    const startIndex = match.index + match[0].length;
    let depth = 1;
    let endIndex = -1;
    for (let i = startIndex; i < code.length; i++) {
        if (code[i] === "{") depth++;
        else if (code[i] === "}") {
            depth--;
            if (depth === 0) {
                endIndex = i;
                break;
            }
        }
    }

    if (endIndex === -1) return code.slice(startIndex, Math.min(startIndex + 500, code.length));
    return code.slice(startIndex, endIndex).trim();
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

export const bashAdapter: LanguageAdapter = {
    id: "bash",
    displayName: "Bash/Shell",
    fileExtensions: ["sh", "bash", "zsh"],
    scanSourceFiles,
    extractSymbolsFromCode,
    extractImplementationFromCode,
    extractImplementationForSymbol,
    inferPathModuleHint: inferPathModuleHintGeneric,
    inferBaseTags: inferBashBaseTags
};
