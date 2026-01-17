"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.jsAdapter = void 0;
const path_1 = __importDefault(require("path"));
const promises_1 = require("fs/promises");
const utils_1 = require("./utils");
const jsTags_1 = require("./jsTags");
const scanSourceFiles = (0, utils_1.createScanner)([
    "**/*.js",
    "**/*.jsx",
    "**/*.ts",
    "**/*.tsx",
    "**/*.mjs",
    "**/*.cjs",
    "**/*.vue"
]);
/**
 * Extract JavaScript/TypeScript/Vue symbols using regex.
 */
function extractSymbolsFromCode(code, filePath) {
    const symbols = [];
    const ext = path_1.default.extname(filePath).toLowerCase();
    // For Vue files, extract script content
    let scriptCode = code;
    if (ext === ".vue") {
        const scriptMatch = code.match(/<script[^>]*>([\s\S]*?)<\/script>/);
        if (scriptMatch) {
            scriptCode = scriptMatch[1];
        }
    }
    // Class pattern
    const classPattern = /^(\s*)(export\s+)?(default\s+)?(abstract\s+)?class\s+(\w+)(?:\s+extends\s+(\w+))?(?:\s+implements\s+([\w,\s]+))?\s*\{/gm;
    let match;
    while ((match = classPattern.exec(scriptCode)) !== null) {
        const isExport = !!match[2];
        const isDefault = !!match[3];
        const isAbstract = !!match[4];
        const className = match[5];
        const extendsClass = match[6] || "";
        let signature = "";
        if (isExport)
            signature += "export ";
        if (isDefault)
            signature += "default ";
        if (isAbstract)
            signature += "abstract ";
        signature += `class ${className}`;
        if (extendsClass) {
            signature += ` extends ${extendsClass}`;
        }
        const lineNum = scriptCode.slice(0, match.index).split("\n").length;
        symbols.push({
            id: className,
            kind: "class",
            signature: signature.trim(),
            declHash: "",
            filePath,
            declLine: lineNum
        });
    }
    // Function pattern (including async, generator)
    const funcPattern = /^(\s*)(export\s+)?(default\s+)?(async\s+)?function\s*(\*)?\s*(\w+)\s*\(([^)]*)\)/gm;
    while ((match = funcPattern.exec(scriptCode)) !== null) {
        const isExport = !!match[2];
        const isDefault = !!match[3];
        const isAsync = !!match[4];
        const isGenerator = !!match[5];
        const funcName = match[6];
        const params = match[7].trim();
        let signature = "";
        if (isExport)
            signature += "export ";
        if (isDefault)
            signature += "default ";
        if (isAsync)
            signature += "async ";
        signature += "function ";
        if (isGenerator)
            signature += "* ";
        signature += `${funcName}(${params})`;
        const lineNum = scriptCode.slice(0, match.index).split("\n").length;
        symbols.push({
            id: funcName,
            kind: "function",
            signature: signature.trim(),
            declHash: "",
            filePath,
            declLine: lineNum
        });
    }
    // Arrow function / const pattern
    const arrowPattern = /^(\s*)(export\s+)?(const|let|var)\s+(\w+)\s*=\s*(async\s*)?\([^)]*\)\s*=>/gm;
    while ((match = arrowPattern.exec(scriptCode)) !== null) {
        const isExport = !!match[2];
        const keyword = match[3];
        const funcName = match[4];
        const isAsync = !!match[5];
        let signature = "";
        if (isExport)
            signature += "export ";
        signature += `${keyword} ${funcName} = `;
        if (isAsync)
            signature += "async ";
        signature += "() => ...";
        const lineNum = scriptCode.slice(0, match.index).split("\n").length;
        symbols.push({
            id: funcName,
            kind: "function",
            signature: signature.trim(),
            declHash: "",
            filePath,
            declLine: lineNum
        });
    }
    // Vue component (defineComponent or export default)
    if (ext === ".vue") {
        const componentMatch = scriptCode.match(/export\s+default\s+(?:defineComponent\s*\()?/);
        if (componentMatch) {
            const componentName = path_1.default.basename(filePath, ext);
            symbols.push({
                id: componentName,
                kind: "class",
                signature: `Vue Component: ${componentName}`,
                declHash: "",
                filePath,
                declLine: 1
            });
        }
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
exports.jsAdapter = {
    id: "js",
    displayName: "JavaScript/TypeScript",
    fileExtensions: ["js", "jsx", "ts", "tsx", "mjs", "cjs", "vue"],
    scanSourceFiles,
    extractSymbolsFromCode,
    extractImplementationFromCode: utils_1.extractImplementationGeneric,
    extractImplementationForSymbol,
    inferPathModuleHint: utils_1.inferPathModuleHintGeneric,
    inferBaseTags: jsTags_1.inferJsBaseTags
};
