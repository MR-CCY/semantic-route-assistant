import path from "path";
import { readFile } from "fs/promises";
import type { ExtractedSymbol } from "../symbolExtractor";
import type { ImplementationInput, ImplementationResult } from "../extract/implementationExtractor";
import type { LanguageAdapter } from "./adapterRegistry";
import { createScanner, inferPathModuleHintGeneric, extractImplementationGeneric } from "./utils";
import { inferJavaBaseTags } from "./javaTags";

const scanSourceFiles = createScanner(["**/*.java"]);

/**
 * Extract Java symbols using regex (class, interface, method declarations).
 */
function extractSymbolsFromCode(code: string, filePath: string): ExtractedSymbol[] {
    const symbols: ExtractedSymbol[] = [];
    const lines = code.split("\n");

    // Extract package name
    let packageName = "";
    const packageMatch = code.match(/^\s*package\s+([\w.]+)\s*;/m);
    if (packageMatch) {
        packageName = packageMatch[1];
    }

    // Class/Interface/Enum pattern
    const classPattern = /^(\s*)((?:public|private|protected|abstract|final|static|\s)*)(class|interface|enum)\s+(\w+)(?:\s+extends\s+(\w+))?(?:\s+implements\s+([\w,\s]+))?\s*\{?/gm;
    let match;

    while ((match = classPattern.exec(code)) !== null) {
        const modifiers = match[2].trim();
        const kind = match[3];
        const className = match[4];
        const extendsClass = match[5] || "";
        const implementsList = match[6] || "";

        let signature = `${modifiers} ${kind} ${className}`.trim();
        if (extendsClass) {
            signature += ` extends ${extendsClass}`;
        }
        if (implementsList) {
            signature += ` implements ${implementsList.trim()}`;
        }

        const lineNum = code.slice(0, match.index).split("\n").length;
        const id = packageName ? `${packageName}.${className}` : className;

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
    const methodPattern = /^\s*((?:public|private|protected|static|final|abstract|synchronized|native|\s)*)\s*(?:<[\w,\s?]+>\s*)?(\w+(?:<[\w,\s?]+>)?)\s+(\w+)\s*\(([^)]*)\)\s*(?:throws\s+[\w,\s]+)?\s*[{;]/gm;

    while ((match = methodPattern.exec(code)) !== null) {
        const modifiers = match[1].trim();
        const returnType = match[2];
        const methodName = match[3];
        const params = match[4].trim();

        // Skip constructors (return type same as class name)
        const signature = `${modifiers} ${returnType} ${methodName}(${params})`.trim().replace(/\s+/g, " ");
        const lineNum = code.slice(0, match.index).split("\n").length;

        // Try to find enclosing class
        let enclosingClass = "";
        const beforeMethod = code.slice(0, match.index);
        const classMatch = beforeMethod.match(/(?:class|interface)\s+(\w+)[^{]*\{[^}]*$/);
        if (classMatch) {
            enclosingClass = classMatch[1];
        }

        const id = packageName
            ? enclosingClass
                ? `${packageName}.${enclosingClass}.${methodName}`
                : `${packageName}.${methodName}`
            : enclosingClass
                ? `${enclosingClass}.${methodName}`
                : methodName;

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

export const javaAdapter: LanguageAdapter = {
    id: "java",
    displayName: "Java",
    fileExtensions: ["java"],
    scanSourceFiles,
    extractSymbolsFromCode,
    extractImplementationFromCode: extractImplementationGeneric,
    extractImplementationForSymbol,
    inferPathModuleHint: inferPathModuleHintGeneric,
    inferBaseTags: inferJavaBaseTags
};
