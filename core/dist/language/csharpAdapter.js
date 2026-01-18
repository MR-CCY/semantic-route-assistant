"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.csharpAdapter = void 0;
const path_1 = __importDefault(require("path"));
const promises_1 = require("fs/promises");
const utils_1 = require("./utils");
const csharpTags_1 = require("./csharpTags");
const scanSourceFiles = (0, utils_1.createScanner)(["**/*.cs"]);
/**
 * Extract C# symbols using regex.
 */
function extractSymbolsFromCode(code, filePath) {
    const symbols = [];
    // Extract namespace
    let namespace = "";
    const nsMatch = code.match(/namespace\s+([\w.]+)/);
    if (nsMatch)
        namespace = nsMatch[1];
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
        if (baseTypes)
            signature += ` : ${baseTypes}`;
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
async function extractImplementationForSymbol(input) {
    try {
        const absolutePath = path_1.default.isAbsolute(input.filePath)
            ? input.filePath
            : path_1.default.join(input.projectRoot, input.filePath);
        const code = await (0, promises_1.readFile)(absolutePath, "utf8");
        const impl = (0, utils_1.extractImplementationGeneric)(code, input.signature);
        return { implementation: impl };
    }
    catch {
        return { implementation: null };
    }
}
exports.csharpAdapter = {
    id: "csharp",
    displayName: "C#",
    fileExtensions: ["cs"],
    scanSourceFiles,
    extractSymbolsFromCode,
    extractImplementationFromCode: utils_1.extractImplementationGeneric,
    extractImplementationForSymbol,
    inferPathModuleHint: utils_1.inferPathModuleHintGeneric,
    inferBaseTags: csharpTags_1.inferCsharpBaseTags
};
