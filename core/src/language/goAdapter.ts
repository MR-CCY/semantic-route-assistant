import path from "path";
import { readFile } from "fs/promises";
import type { ExtractedSymbol } from "../symbolExtractor";
import type { ImplementationInput, ImplementationResult } from "../extract/implementationExtractor";
import type { LanguageAdapter } from "./adapterRegistry";
import { createScanner, inferPathModuleHintGeneric, extractImplementationGeneric } from "./utils";
import { inferGoBaseTags } from "./goTags";

const scanSourceFiles = createScanner(["**/*.go"]);

/**
 * Extract Go symbols using regex (func, struct, interface).
 */
function extractSymbolsFromCode(code: string, filePath: string): ExtractedSymbol[] {
    const symbols: ExtractedSymbol[] = [];

    // Extract package name
    let packageName = "";
    const packageMatch = code.match(/^package\s+(\w+)/m);
    if (packageMatch) {
        packageName = packageMatch[1];
    }

    // Struct pattern
    const structPattern = /^type\s+(\w+)\s+struct\s*\{/gm;
    let match;

    while ((match = structPattern.exec(code)) !== null) {
        const structName = match[1];
        const lineNum = code.slice(0, match.index).split("\n").length;

        symbols.push({
            id: packageName ? `${packageName}.${structName}` : structName,
            kind: "class",
            signature: `type ${structName} struct`,
            declHash: "",
            filePath,
            declLine: lineNum
        });
    }

    // Interface pattern
    const interfacePattern = /^type\s+(\w+)\s+interface\s*\{/gm;

    while ((match = interfacePattern.exec(code)) !== null) {
        const interfaceName = match[1];
        const lineNum = code.slice(0, match.index).split("\n").length;

        symbols.push({
            id: packageName ? `${packageName}.${interfaceName}` : interfaceName,
            kind: "class",
            signature: `type ${interfaceName} interface`,
            declHash: "",
            filePath,
            declLine: lineNum
        });
    }

    // Function pattern (with receiver)
    const funcPattern = /^func\s+(?:\((\w+)\s+\*?(\w+)\)\s+)?(\w+)\s*\(([^)]*)\)(?:\s*\(([^)]*)\)|\s*(\w+))?\s*\{/gm;

    while ((match = funcPattern.exec(code)) !== null) {
        const receiverVar = match[1];
        const receiverType = match[2];
        const funcName = match[3];
        const params = match[4].trim();
        const multiReturn = match[5]?.trim();
        const singleReturn = match[6]?.trim();

        let signature = "func ";
        if (receiverType) {
            signature += `(${receiverVar} *${receiverType}) `;
        }
        signature += `${funcName}(${params})`;
        if (multiReturn) {
            signature += ` (${multiReturn})`;
        } else if (singleReturn) {
            signature += ` ${singleReturn}`;
        }

        const lineNum = code.slice(0, match.index).split("\n").length;

        const id = receiverType
            ? packageName
                ? `${packageName}.${receiverType}.${funcName}`
                : `${receiverType}.${funcName}`
            : packageName
                ? `${packageName}.${funcName}`
                : funcName;

        symbols.push({
            id,
            kind: "function",
            signature: signature.trim(),
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

export const goAdapter: LanguageAdapter = {
    id: "go",
    displayName: "Go",
    fileExtensions: ["go"],
    scanSourceFiles,
    extractSymbolsFromCode,
    extractImplementationFromCode: extractImplementationGeneric,
    extractImplementationForSymbol,
    inferPathModuleHint: inferPathModuleHintGeneric,
    inferBaseTags: inferGoBaseTags
};
