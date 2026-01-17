"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.pythonAdapter = void 0;
const path_1 = __importDefault(require("path"));
const promises_1 = require("fs/promises");
const utils_1 = require("./utils");
const pythonTags_1 = require("./pythonTags");
const scanSourceFiles = (0, utils_1.createScanner)(["**/*.py", "**/*.pyw"]);
/**
 * Extract Python symbols using regex (class, def).
 */
function extractSymbolsFromCode(code, filePath) {
    const symbols = [];
    const lines = code.split("\n");
    // Class pattern
    const classPattern = /^(\s*)class\s+(\w+)\s*(?:\(([^)]*)\))?\s*:/gm;
    let match;
    while ((match = classPattern.exec(code)) !== null) {
        const indent = match[1];
        const className = match[2];
        const bases = match[3] || "";
        let signature = `class ${className}`;
        if (bases) {
            signature += `(${bases})`;
        }
        const lineNum = code.slice(0, match.index).split("\n").length;
        symbols.push({
            id: className,
            kind: "class",
            signature,
            declHash: "",
            filePath,
            declLine: lineNum
        });
    }
    // Function/method pattern (including async)
    const defPattern = /^(\s*)(async\s+)?def\s+(\w+)\s*\(([^)]*)\)\s*(?:->([^:]+))?\s*:/gm;
    while ((match = defPattern.exec(code)) !== null) {
        const indent = match[1];
        const isAsync = !!match[2];
        const funcName = match[3];
        const params = match[4].trim();
        const returnType = match[5]?.trim() || "";
        let signature = "";
        if (isAsync)
            signature += "async ";
        signature += `def ${funcName}(${params})`;
        if (returnType) {
            signature += ` -> ${returnType}`;
        }
        const lineNum = code.slice(0, match.index).split("\n").length;
        // Try to find enclosing class
        let enclosingClass = "";
        const beforeFunc = code.slice(0, match.index);
        // Find last class at lower indentation
        const classMatches = [...beforeFunc.matchAll(/^(\s*)class\s+(\w+)/gm)];
        for (const cm of classMatches.reverse()) {
            if (cm[1].length < indent.length) {
                enclosingClass = cm[2];
                break;
            }
        }
        const id = enclosingClass ? `${enclosingClass}.${funcName}` : funcName;
        // Check for decorators above the function
        const linesBeforeFunc = code.slice(0, match.index).split("\n");
        const decorators = [];
        for (let i = linesBeforeFunc.length - 1; i >= 0; i--) {
            const line = linesBeforeFunc[i].trim();
            if (line.startsWith("@")) {
                decorators.unshift(line);
            }
            else if (line && !line.startsWith("#")) {
                break;
            }
        }
        if (decorators.length > 0) {
            signature = decorators.join("\n") + "\n" + signature;
        }
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
/**
 * Extract Python function body (indentation-based).
 */
function extractImplementationFromCode(code, signature) {
    // Find def or class line matching the signature
    const funcMatch = signature.match(/(?:async\s+)?def\s+(\w+)/);
    if (!funcMatch) {
        return null;
    }
    const funcName = funcMatch[1];
    const pattern = new RegExp(`^(\\s*)(?:async\\s+)?def\\s+${funcName}\\s*\\([^)]*\\)[^:]*:`, "m");
    const match = pattern.exec(code);
    if (!match) {
        return null;
    }
    const startIndex = match.index + match[0].length;
    const baseIndent = match[1].length;
    const lines = code.slice(startIndex).split("\n");
    const bodyLines = [];
    for (const line of lines) {
        // Empty line or comment is part of body
        if (line.trim() === "" || line.trim().startsWith("#")) {
            bodyLines.push(line);
            continue;
        }
        // Check indentation
        const lineIndent = line.match(/^\s*/)?.[0].length || 0;
        if (lineIndent > baseIndent) {
            bodyLines.push(line);
        }
        else {
            break;
        }
    }
    return bodyLines.join("\n").trim() || null;
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
exports.pythonAdapter = {
    id: "python",
    displayName: "Python",
    fileExtensions: ["py", "pyw"],
    scanSourceFiles,
    extractSymbolsFromCode,
    extractImplementationFromCode,
    extractImplementationForSymbol,
    inferPathModuleHint: utils_1.inferPathModuleHintGeneric,
    inferBaseTags: pythonTags_1.inferPythonBaseTags
};
