import path from "path";
import { readFile } from "fs/promises";
import type { ExtractedSymbol } from "../symbolExtractor";
import type { ImplementationInput, ImplementationResult } from "../extract/implementationExtractor";
import type { LanguageAdapter } from "./adapterRegistry";
import { createScanner, inferPathModuleHintGeneric, extractImplementationGeneric } from "./utils";
import { inferCsharpBaseTags } from "./csharpTags";

const scanSourceFiles = createScanner(["**/*.cs"]);

/**
 * Extract C# symbols using regex.
 */
function extractSymbolsFromCode(code: string, filePath: string): ExtractedSymbol[] {
    const symbols: ExtractedSymbol[] = [];

    // Extract namespace
    let namespace = "";
    const nsMatch = code.match(/namespace\s+([\w.]+)/);
    if (nsMatch) namespace = nsMatch[1];

    // Class/Interface/Struct/Enum pattern
    const classPattern = /^(\s*)((?:public|private|protected|internal|abstract|sealed|static|partial|\s)*)(class|interface|struct|enum)\s+(\w+)(?:\s*:\s*([^\{]+))?\s*\{/gm;
    let match;

    while ((match = classPattern.exec(code)) !== null) {
        const modifiers = match[2].trim();
        const kind = match[3];
        const className = match[4];
        const baseTypes = match[5]?.trim() || "";
        const lineNum = code.slice(0, match.index).split("\n").length;

        let signature = `${modifiers} ${kind} ${className}`.trim().replace(/\s+/g, " ");
        if (baseTypes) signature += ` : ${baseTypes}`;

        const id = namespace ? `${namespace}.${className}` : className;

        symbols.push({
            id,
            kind: "class",
            signature,
            declHash: "",
            filePath,
            declLine: lineNum
        });
    }

    // Method pattern
    const methodPattern = /^(\s*)((?:public|private|protected|internal|static|virtual|override|abstract|async|\s)*)\s*(\w+(?:<[\w,\s]+>)?)\s+(\w+)\s*\(([^)]*)\)\s*[{;]/gm;

    while ((match = methodPattern.exec(code)) !== null) {
        const modifiers = match[2].trim();
        const returnType = match[3];
        const methodName = match[4];
        const params = match[5].trim();
        const lineNum = code.slice(0, match.index).split("\n").length;

        // Skip constructors (same name as class)
        const signature = `${modifiers} ${returnType} ${methodName}(${params})`.trim().replace(/\s+/g, " ");

        symbols.push({
            id: methodName,
            kind: "function",
            signature,
            declHash: "",
            filePath,
            declLine: lineNum
        });
    }

    return symbols;
}

async function extractImplementationForSymbol(
    input: ImplementationInput
): Promise<ImplementationResult> {
    try {
        const absolutePath = path.isAbsolute(input.filePath)
            ? input.filePath
            : path.join(input.projectRoot, input.filePath);
        const code = await readFile(absolutePath, "utf8");
        const impl = extractImplementationGeneric(code, input.signature);
        return { implementation: impl };
    } catch {
        return { implementation: null };
    }
}

export const csharpAdapter: LanguageAdapter = {
    id: "csharp",
    displayName: "C#",
    fileExtensions: ["cs"],
    scanSourceFiles,
    extractSymbolsFromCode,
    extractImplementationFromCode: extractImplementationGeneric,
    extractImplementationForSymbol,
    inferPathModuleHint: inferPathModuleHintGeneric,
    inferBaseTags: inferCsharpBaseTags
};
