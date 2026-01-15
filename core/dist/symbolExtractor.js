"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.extractSymbolsFromCode = extractSymbolsFromCode;
const crypto_1 = require("crypto");
const tree_sitter_1 = __importDefault(require("tree-sitter"));
const tree_sitter_cpp_1 = __importDefault(require("tree-sitter-cpp"));
const parser = new tree_sitter_1.default();
parser.setLanguage(tree_sitter_cpp_1.default);
function normalizeSignature(signature) {
    return signature
        .replace(/\s+/g, " ")
        .replace(/\s*([(),*&<>:=])\s*/g, "$1")
        .trim();
}
function hashSignature(signature) {
    const normalized = normalizeSignature(signature);
    return (0, crypto_1.createHash)("sha1").update(normalized).digest("hex");
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
    const signature = normalizeSignature(params.signature);
    if (!signature) {
        return;
    }
    params.symbols.push({
        id: params.id,
        kind: "function",
        signature,
        declHash: hashSignature(signature),
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
    const normalizedSignature = normalizeSignature(withClassNameInSignature(finalized, name, className));
    return {
        id,
        kind: "function",
        signature: normalizedSignature,
        declHash: hashSignature(normalizedSignature),
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
function extractSymbolsFromCode(code, filePath) {
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
    let tree;
    try {
        tree = parser.parse(code);
    }
    catch (error) {
        const err = error;
        console.warn(`[symbolExtractor] parse failed: ${filePath} (${err?.message ?? "unknown error"})`);
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
            const signature = `${node.type === "class_specifier" ? "class" : "struct"} ${className}`;
            symbols.push({
                id: className,
                kind: "class",
                signature: normalizeSignature(signature),
                declHash: hashSignature(signature),
                filePath,
                declLine: node.startPosition.row + 1
            });
            const body = node.childForFieldName("body") || findNamedChild(node, ["field_declaration_list"]);
            if (!body) {
                return;
            }
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
