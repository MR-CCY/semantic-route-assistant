"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
Object.defineProperty(exports, "__esModule", { value: true });
exports.initSymbolExtractor = initSymbolExtractor;
exports.extractSymbolsFromCode = extractSymbolsFromCode;
exports.extractSymbolsFromCodeAsync = extractSymbolsFromCodeAsync;
const web_tree_sitter_1 = require("web-tree-sitter");
const path = __importStar(require("path"));
const signatureUtils_1 = require("./signatureUtils");
// Parser 实例和初始化状态
let parser = null;
let isInitialized = false;
/**
 * 初始化 web-tree-sitter parser
 * 必须在使用前调用一次
 */
async function initSymbolExtractor() {
    if (isInitialized) {
        return;
    }
    try {
        // 1. 初始化 WASM runtime
        await web_tree_sitter_1.Parser.init({
            locateFile: (fileName) => path.join(__dirname, fileName)
        });
        // 2. 创建 Parser 实例
        parser = new web_tree_sitter_1.Parser();
        // 3. 加载 C++ 语言 WASM
        const wasmPath = path.join(__dirname, "wasm", "tree-sitter-cpp.wasm");
        const Cpp = await web_tree_sitter_1.Language.load(wasmPath);
        parser.setLanguage(Cpp);
        isInitialized = true;
    }
    catch (error) {
        console.error("Failed to initialize symbol extractor:", error);
        throw error;
    }
}
/**
 * 同步占位符 - 保持向后兼容
 * 其他语言适配器使用各自的实现
 * C++ 应使用 extractSymbolsFromCodeAsync
 */
function extractSymbolsFromCode(_code, _filePath) {
    throw new Error("extractSymbolsFromCode is not implemented for C++. Use extractSymbolsFromCodeAsync instead.");
}
function getText(code, node) {
    return code.slice(node.startIndex, node.endIndex);
}
function isHeaderFile(filePath) {
    const lower = filePath.toLowerCase();
    return lower.endsWith(".h") || lower.endsWith(".hpp") || lower.endsWith(".hh") || lower.endsWith(".hxx");
}
function escapeRegExp(text) {
    return text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
function hasErrorNode(node) {
    if (node.type === "ERROR") {
        return true;
    }
    return node.namedChildren.some((child) => hasErrorNode(child));
}
function findNamedChild(node, types) {
    for (const child of node.namedChildren) {
        if (types.includes(child.type)) {
            return child;
        }
    }
    return null;
}
function findDescendant(node, types) {
    for (const child of node.namedChildren) {
        if (types.includes(child.type)) {
            return child;
        }
        const found = findDescendant(child, types);
        if (found) {
            return found;
        }
    }
    return null;
}
function getClassName(node, code) {
    const nameNode = node.childForFieldName("name") || findDescendant(node, ["type_identifier"]);
    if (!nameNode) {
        return null;
    }
    return getText(code, nameNode).trim();
}
function getFunctionDeclarator(node) {
    if (node.type === "function_declarator") {
        return node;
    }
    return findDescendant(node, ["function_declarator"]);
}
function findNameInDeclarator(declarator, code) {
    if ([
        "qualified_identifier",
        "scoped_identifier",
        "identifier",
        "field_identifier",
        "destructor_name",
        "operator_name",
        "type_identifier"
    ].includes(declarator.type)) {
        return declarator;
    }
    if (declarator.type === "function_declarator") {
        const inner = declarator.childForFieldName("declarator");
        if (inner) {
            const found = findNameInDeclarator(inner, code);
            if (found) {
                return found;
            }
        }
    }
    for (const child of declarator.namedChildren) {
        if (child.type === "parameter_list") {
            continue;
        }
        const found = findNameInDeclarator(child, code);
        if (found) {
            return found;
        }
    }
    return null;
}
function getFunctionName(declarator, code) {
    const nameNode = findNameInDeclarator(declarator, code);
    if (!nameNode) {
        return null;
    }
    return getText(code, nameNode).trim();
}
function buildSignature(code, typeNode, declarator) {
    if (!declarator) {
        return null;
    }
    const declText = getText(code, declarator).trim();
    if (typeNode) {
        const typeText = getText(code, typeNode).trim();
        return `${typeText} ${declText}`.trim();
    }
    return declText;
}
function appendQualifiers(signature, code, node) {
    const qualifierTypes = [
        "type_qualifier",
        "ref_qualifier",
        "noexcept",
        "virtual_specifier",
        "override",
        "final",
        "pure_virtual_clause"
    ];
    const qualifiers = node.namedChildren
        .filter((child) => qualifierTypes.includes(child.type))
        .map((child) => getText(code, child).trim())
        .filter(Boolean);
    if (qualifiers.length === 0) {
        return signature;
    }
    return `${signature} ${qualifiers.join(" ")}`.trim();
}
function isProbablyInvalidSignature(signature) {
    if (!signature) {
        return true;
    }
    if (/[{}]/.test(signature)) {
        return true;
    }
    if (/^\s*(else|if|for|while|switch|catch)\b/.test(signature)) {
        return true;
    }
    if (/\belse\s+if\b/.test(signature)) {
        return true;
    }
    return false;
}
function withClassNameInSignature(signature, name, className) {
    if (!className || name.includes("::")) {
        return signature;
    }
    const escaped = escapeRegExp(name);
    const pattern = new RegExp(`\\b${escaped}\\b`);
    if (!pattern.test(signature)) {
        return signature;
    }
    return signature.replace(pattern, `${className}::${name}`);
}
function addFunctionSymbol(params) {
    const signature = (0, signatureUtils_1.normalizeSignature)(params.signature);
    if (!signature) {
        return;
    }
    params.symbols.push({
        id: params.id,
        kind: "function",
        signature,
        declHash: (0, signatureUtils_1.hashSignature)(signature),
        filePath: params.filePath
    });
}
function handleFunctionNode(node, code, filePath, className) {
    if (hasErrorNode(node)) {
        return null;
    }
    const declarator = getFunctionDeclarator(node) || node.childForFieldName("declarator");
    const typeNode = node.childForFieldName("type");
    const signature = buildSignature(code, typeNode, declarator);
    if (!signature) {
        return null;
    }
    const isDefinition = node.type === "function_definition";
    const headerFile = isHeaderFile(filePath);
    const line = node.startPosition.row + 1;
    const finalized = appendQualifiers(signature, code, node);
    if (isProbablyInvalidSignature(finalized)) {
        return null;
    }
    const name = declarator ? getFunctionName(declarator, code) : null;
    if (!name) {
        return null;
    }
    let id = name;
    if (className) {
        id = name.includes("::") ? name : `${className}::${name}`;
    }
    const normalizedSignature = (0, signatureUtils_1.normalizeSignature)(withClassNameInSignature(finalized, name, className));
    return {
        id,
        kind: "function",
        signature: normalizedSignature,
        declHash: (0, signatureUtils_1.hashSignature)(normalizedSignature),
        filePath,
        declLine: !isDefinition || headerFile ? line : undefined,
        implLine: isDefinition ? line : undefined
    };
}
function handleFieldDeclaration(node, code, filePath, className) {
    if (hasErrorNode(node)) {
        return null;
    }
    const declarator = getFunctionDeclarator(node);
    if (!declarator) {
        return null;
    }
    const hasFunctionDeclarator = declarator.type === "function_declarator";
    if (!hasFunctionDeclarator) {
        return null;
    }
    return handleFunctionNode(node, code, filePath, className);
}
function walk(node, fn) {
    fn(node);
    for (const child of node.namedChildren) {
        walk(child, fn);
    }
}
/**
 * 异步版本 - 用于 C++ 的 WASM 实现
 */
async function extractSymbolsFromCodeAsync(code, filePath) {
    if (!code) {
        return [];
    }
    if (code.length > 2000000) {
        console.warn(`[symbolExtractor] skip large file: ${filePath}`);
        return [];
    }
    if (code.includes("\0")) {
        console.warn(`[symbolExtractor] skip binary-like file: ${filePath}`);
        return [];
    }
    // 确保已初始化
    if (!isInitialized || !parser) {
        await initSymbolExtractor();
    }
    let tree;
    try {
        tree = parser.parse(code);
    }
    catch (error) {
        const err = error;
        console.warn(`[symbolExtractor] parse failed: ${filePath} (${err?.message ?? "unknown error"})`);
        return [];
    }
    if (!tree) {
        return [];
    }
    const root = tree.rootNode;
    if (!root || root.childCount === 0) {
        return [];
    }
    const symbols = [];
    walk(root, (node) => {
        if (node.type === "class_specifier" || node.type === "struct_specifier") {
            const className = getClassName(node, code);
            if (!className) {
                return;
            }
            // Skip forward declarations (no body)
            const body = node.childForFieldName("body") || findNamedChild(node, ["field_declaration_list"]);
            if (!body) {
                return;
            }
            // Build signature with inheritance info
            const keyword = node.type === "class_specifier" ? "class" : "struct";
            let signature = `${keyword} ${className}`;
            // Find base_class_clause to include inheritance info
            const baseClause = findNamedChild(node, ["base_class_clause"]);
            if (baseClause) {
                const baseText = getText(code, baseClause).trim();
                signature = `${signature} ${baseText}`;
            }
            symbols.push({
                id: className,
                kind: "class",
                signature: (0, signatureUtils_1.normalizeSignature)(signature),
                declHash: (0, signatureUtils_1.hashSignature)(signature),
                filePath,
                declLine: node.startPosition.row + 1
            });
            // body is already checked above, no need to check again
            for (const child of body.namedChildren) {
                if (child.type !== "field_declaration") {
                    continue;
                }
                const method = handleFieldDeclaration(child, code, filePath, className);
                if (method) {
                    symbols.push(method);
                }
            }
            return;
        }
        if (node.type === "function_definition" || node.type === "function_declaration") {
            const symbol = handleFunctionNode(node, code, filePath);
            if (!symbol) {
                return;
            }
            symbols.push(symbol);
        }
    });
    return symbols;
}
