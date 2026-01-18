"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.phpAdapter = void 0;
const path_1 = __importDefault(require("path"));
const promises_1 = require("fs/promises");
const utils_1 = require("./utils");
const phpTags_1 = require("./phpTags");
const scanSourceFiles = (0, utils_1.createScanner)(["**/*.php"]);
/**
 * Extract PHP symbols using regex.
 */
function extractSymbolsFromCode(code, filePath) {
    const symbols = [];
    // Extract namespace
    let namespace = "";
    const nsMatch = code.match(/namespace\s+([\w\\]+)\s*;/);
    if (nsMatch)
        namespace = nsMatch[1];
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
        if (extendsClass)
            signature += ` extends ${extendsClass}`;
        if (implementsList)
            signature += ` implements ${implementsList}`;
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
        if (returnType)
            signature += `: ${returnType}`;
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
exports.phpAdapter = {
    id: "php",
    displayName: "PHP",
    fileExtensions: ["php"],
    scanSourceFiles,
    extractSymbolsFromCode,
    extractImplementationFromCode: utils_1.extractImplementationGeneric,
    extractImplementationForSymbol,
    inferPathModuleHint: utils_1.inferPathModuleHintGeneric,
    inferBaseTags: phpTags_1.inferPhpBaseTags
};
