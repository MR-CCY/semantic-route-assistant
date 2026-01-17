"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.goAdapter = void 0;
const path_1 = __importDefault(require("path"));
const promises_1 = require("fs/promises");
const utils_1 = require("./utils");
const goTags_1 = require("./goTags");
const scanSourceFiles = (0, utils_1.createScanner)(["**/*.go"]);
/**
 * Extract Go symbols using regex (func, struct, interface).
 */
function extractSymbolsFromCode(code, filePath) {
    const symbols = [];
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
        }
        else if (singleReturn) {
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
exports.goAdapter = {
    id: "go",
    displayName: "Go",
    fileExtensions: ["go"],
    scanSourceFiles,
    extractSymbolsFromCode,
    extractImplementationFromCode: utils_1.extractImplementationGeneric,
    extractImplementationForSymbol,
    inferPathModuleHint: utils_1.inferPathModuleHintGeneric,
    inferBaseTags: goTags_1.inferGoBaseTags
};
