import path from "path";
import { readFile } from "fs/promises";
import type { ExtractedSymbol } from "../symbolExtractor";
import type { ImplementationInput, ImplementationResult } from "../extract/implementationExtractor";
import type { LanguageAdapter } from "./adapterRegistry";
import { createScanner, inferPathModuleHintGeneric, extractImplementationGeneric } from "./utils";
import { inferPhpBaseTags } from "./phpTags";

const scanSourceFiles = createScanner(["**/*.php"]);

/**
 * Extract PHP symbols using regex.
 */
function extractSymbolsFromCode(code: string, filePath: string): ExtractedSymbol[] {
    const symbols: ExtractedSymbol[] = [];

    // Extract namespace
    let namespace = "";
    const nsMatch = code.match(/namespace\s+([\w\\]+)\s*;/);
    if (nsMatch) namespace = nsMatch[1];

    // Class/Interface/Trait pattern
    const classPattern = /^(\s*)((?:abstract|final|\s)*)(class|interface|trait)\s+(\w+)(?:\s+extends\s+(\w+))?(?:\s+implements\s+([^\{]+))?\s*\{/gm;
    let match;

    while ((match = classPattern.exec(code)) !== null) {
        const modifiers = match[2].trim();
        const kind = match[3];
        const className = match[4];
        const extendsClass = match[5] || "";
        const implementsList = match[6]?.trim() || "";
        const lineNum = code.slice(0, match.index).split("\n").length;

        let signature = `${modifiers} ${kind} ${className}`.trim().replace(/\s+/g, " ");
        if (extendsClass) signature += ` extends ${extendsClass}`;
        if (implementsList) signature += ` implements ${implementsList}`;

        const id = namespace ? `${namespace}\\${className}` : className;

        symbols.push({
            id,
            kind: "class",
            signature,
            declHash: "",
            filePath,
            declLine: lineNum
        });
    }

    // Function pattern
    const fnPattern = /^(\s*)((?:public|private|protected|static|final|abstract|\s)*)\s*function\s+(\w+)\s*\(([^)]*)\)(?:\s*:\s*(\??\w+))?\s*[{;]/gm;

    while ((match = fnPattern.exec(code)) !== null) {
        const modifiers = match[2].trim();
        const fnName = match[3];
        const params = match[4].trim();
        const returnType = match[5] || "";
        const lineNum = code.slice(0, match.index).split("\n").length;

        let signature = `${modifiers} function ${fnName}(${params})`.trim().replace(/\s+/g, " ");
        if (returnType) signature += `: ${returnType}`;

        symbols.push({
            id: fnName,
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

export const phpAdapter: LanguageAdapter = {
    id: "php",
    displayName: "PHP",
    fileExtensions: ["php"],
    scanSourceFiles,
    extractSymbolsFromCode,
    extractImplementationFromCode: extractImplementationGeneric,
    extractImplementationForSymbol,
    inferPathModuleHint: inferPathModuleHintGeneric,
    inferBaseTags: inferPhpBaseTags
};
