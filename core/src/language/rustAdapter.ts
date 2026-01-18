import path from "path";
import { readFile } from "fs/promises";
import type { ExtractedSymbol } from "../symbolExtractor";
import type { ImplementationInput, ImplementationResult } from "../extract/implementationExtractor";
import type { LanguageAdapter } from "./adapterRegistry";
import { createScanner, inferPathModuleHintGeneric, extractImplementationGeneric } from "./utils";
import { inferRustBaseTags } from "./rustTags";

const scanSourceFiles = createScanner(["**/*.rs"]);

/**
 * Extract Rust symbols using regex.
 */
function extractSymbolsFromCode(code: string, filePath: string): ExtractedSymbol[] {
    const symbols: ExtractedSymbol[] = [];

    // Struct pattern
    const structPattern = /^(\s*)(pub\s+)?struct\s+(\w+)/gm;
    let match;

    while ((match = structPattern.exec(code)) !== null) {
        const isPub = !!match[2];
        const structName = match[3];
        const lineNum = code.slice(0, match.index).split("\n").length;
        const signature = (isPub ? "pub " : "") + `struct ${structName}`;

        symbols.push({
            id: structName,
            kind: "class",
            signature,
            declHash: "",
            filePath,
            declLine: lineNum
        });
    }

    // Enum pattern
    const enumPattern = /^(\s*)(pub\s+)?enum\s+(\w+)/gm;
    while ((match = enumPattern.exec(code)) !== null) {
        const isPub = !!match[2];
        const enumName = match[3];
        const lineNum = code.slice(0, match.index).split("\n").length;
        const signature = (isPub ? "pub " : "") + `enum ${enumName}`;

        symbols.push({
            id: enumName,
            kind: "class",
            signature,
            declHash: "",
            filePath,
            declLine: lineNum
        });
    }

    // Trait pattern
    const traitPattern = /^(\s*)(pub\s+)?trait\s+(\w+)/gm;
    while ((match = traitPattern.exec(code)) !== null) {
        const isPub = !!match[2];
        const traitName = match[3];
        const lineNum = code.slice(0, match.index).split("\n").length;
        const signature = (isPub ? "pub " : "") + `trait ${traitName}`;

        symbols.push({
            id: traitName,
            kind: "class",
            signature,
            declHash: "",
            filePath,
            declLine: lineNum
        });
    }

    // Function pattern
    const fnPattern = /^(\s*)(pub\s+)?(async\s+)?fn\s+(\w+)\s*(<[^>]*>)?\s*\(([^)]*)\)(?:\s*->\s*([^\{]+))?\s*\{/gm;
    while ((match = fnPattern.exec(code)) !== null) {
        const isPub = !!match[2];
        const isAsync = !!match[3];
        const fnName = match[4];
        const generics = match[5] || "";
        const params = match[6].trim();
        const returnType = match[7]?.trim() || "";
        const lineNum = code.slice(0, match.index).split("\n").length;

        let signature = "";
        if (isPub) signature += "pub ";
        if (isAsync) signature += "async ";
        signature += `fn ${fnName}${generics}(${params})`;
        if (returnType) signature += ` -> ${returnType}`;

        symbols.push({
            id: fnName,
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

export const rustAdapter: LanguageAdapter = {
    id: "rust",
    displayName: "Rust",
    fileExtensions: ["rs"],
    scanSourceFiles,
    extractSymbolsFromCode,
    extractImplementationFromCode: extractImplementationGeneric,
    extractImplementationForSymbol,
    inferPathModuleHint: inferPathModuleHintGeneric,
    inferBaseTags: inferRustBaseTags
};
