"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.bashAdapter = void 0;
const path_1 = __importDefault(require("path"));
const promises_1 = require("fs/promises");
const utils_1 = require("./utils");
const bashTags_1 = require("./bashTags");
const scanSourceFiles = (0, utils_1.createScanner)(["**/*.sh", "**/*.bash", "**/*.zsh"]);
/**
 * Extract Bash symbols using regex (function declarations).
 */
function extractSymbolsFromCode(code, filePath) {
    const symbols = [];
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
function extractImplementationFromCode(code, signature) {
    const funcMatch = signature.match(/(?:function\s+)?(\w+)\s*\(\)/);
    if (!funcMatch)
        return null;
    const funcName = funcMatch[1];
    const pattern = new RegExp(`(?:function\\s+)?${funcName}\\s*\\(\\s*\\)\\s*\\{`, "g");
    const match = pattern.exec(code);
    if (!match)
        return null;
    const startIndex = match.index + match[0].length;
    let depth = 1;
    let endIndex = -1;
    for (let i = startIndex; i < code.length; i++) {
        if (code[i] === "{")
            depth++;
        else if (code[i] === "}") {
            depth--;
            if (depth === 0) {
                endIndex = i;
                break;
            }
        }
    }
    if (endIndex === -1)
        return code.slice(startIndex, Math.min(startIndex + 500, code.length));
    return code.slice(startIndex, endIndex).trim();
}
async function extractImplementationForSymbol(input) {
    try {
        const absolutePath = path_1.default.isAbsolute(input.filePath)
            ? input.filePath
            : path_1.default.join(input.projectRoot, input.filePath);
        const code = await (0, promises_1.readFile)(absolutePath, "utf8");
        const impl = extractImplementationFromCode(code, input.signature);
        return { implementation: impl };
    }
    catch {
        return { implementation: null };
    }
}
exports.bashAdapter = {
    id: "bash",
    displayName: "Bash/Shell",
    fileExtensions: ["sh", "bash", "zsh"],
    scanSourceFiles,
    extractSymbolsFromCode,
    extractImplementationFromCode,
    extractImplementationForSymbol,
    inferPathModuleHint: utils_1.inferPathModuleHintGeneric,
    inferBaseTags: bashTags_1.inferBashBaseTags
};
