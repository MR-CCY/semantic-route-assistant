"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.rustAdapter = void 0;
const path_1 = __importDefault(require("path"));
const promises_1 = require("fs/promises");
const utils_1 = require("./utils");
const rustTags_1 = require("./rustTags");
const scanSourceFiles = (0, utils_1.createScanner)(["**/*.rs"]);
/**
 * Extract Rust symbols using regex.
 */
function extractSymbolsFromCode(code, filePath) {
    const symbols = [];
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
        if (isPub)
            signature += "pub ";
        if (isAsync)
            signature += "async ";
        signature += `fn ${fnName}${generics}(${params})`;
        if (returnType)
            signature += ` -> ${returnType}`;
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
exports.rustAdapter = {
    id: "rust",
    displayName: "Rust",
    fileExtensions: ["rs"],
    scanSourceFiles,
    extractSymbolsFromCode,
    extractImplementationFromCode: utils_1.extractImplementationGeneric,
    extractImplementationForSymbol,
    inferPathModuleHint: utils_1.inferPathModuleHintGeneric,
    inferBaseTags: rustTags_1.inferRustBaseTags
};
