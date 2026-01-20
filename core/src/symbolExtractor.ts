import { Parser, Language, Node, Tree } from "web-tree-sitter";
import * as path from "path";
import { hashSignature, normalizeSignature } from "./signatureUtils";

export type ExtractedSymbol = {
  id: string;
  kind: "function" | "class";
  signature: string;
  declHash: string;
  filePath: string;
  declLine?: number;
  implLine?: number;
};

// Parser 实例和初始化状态
let parser: Parser | null = null;
let isInitialized = false;

/**
 * 初始化 web-tree-sitter parser
 * 必须在使用前调用一次
 */
export async function initSymbolExtractor(): Promise<void> {
  if (isInitialized) {
    return;
  }

  try {
    // 1. 初始化 WASM runtime
    await Parser.init({
      locateFile: (fileName: string) => path.join(__dirname, fileName)
    });

    // 2. 创建 Parser 实例
    parser = new Parser();

    // 3. 加载 C++ 语言 WASM
    const wasmPath = path.join(__dirname, "wasm", "tree-sitter-cpp.wasm");
    const Cpp = await Language.load(wasmPath);
    parser.setLanguage(Cpp);

    isInitialized = true;
  } catch (error) {
    console.error("Failed to initialize symbol extractor:", error);
    throw error;
  }
}

/**
 * 同步占位符 - 保持向后兼容
 * 其他语言适配器使用各自的实现
 * C++ 应使用 extractSymbolsFromCodeAsync
 */
export function extractSymbolsFromCode(_code: string, _filePath: string): ExtractedSymbol[] {
  throw new Error(
    "extractSymbolsFromCode is not implemented for C++. Use extractSymbolsFromCodeAsync instead."
  );
}

function getText(code: string, node: Node): string {
  return code.slice(node.startIndex, node.endIndex);
}

function isHeaderFile(filePath: string): boolean {
  const lower = filePath.toLowerCase();
  return lower.endsWith(".h") || lower.endsWith(".hpp") || lower.endsWith(".hh") || lower.endsWith(".hxx");
}

function escapeRegExp(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function hasErrorNode(node: Node): boolean {
  if (node.type === "ERROR") {
    return true;
  }
  return node.namedChildren.some((child) => hasErrorNode(child));
}

function findNamedChild(node: Node, types: string[]): Node | null {
  for (const child of node.namedChildren) {
    if (types.includes(child.type)) {
      return child;
    }
  }
  return null;
}

function findDescendant(node: Node, types: string[]): Node | null {
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

function getClassName(node: Node, code: string): string | null {
  const nameNode = node.childForFieldName("name") || findDescendant(node, ["type_identifier"]);
  if (!nameNode) {
    return null;
  }
  return getText(code, nameNode).trim();
}

function getFunctionDeclarator(node: Node): Node | null {
  if (node.type === "function_declarator") {
    return node;
  }
  return findDescendant(node, ["function_declarator"]);
}

function findNameInDeclarator(
  declarator: Node,
  code: string
): Node | null {
  if (
    [
      "qualified_identifier",
      "scoped_identifier",
      "identifier",
      "field_identifier",
      "destructor_name",
      "operator_name",
      "type_identifier"
    ].includes(declarator.type)
  ) {
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

function getFunctionName(declarator: Node, code: string): string | null {
  const nameNode = findNameInDeclarator(declarator, code);
  if (!nameNode) {
    return null;
  }
  return getText(code, nameNode).trim();
}

function buildSignature(
  code: string,
  typeNode: Node | null,
  declarator: Node | null
): string | null {
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

function appendQualifiers(
  signature: string,
  code: string,
  node: Node
): string {
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

function isProbablyInvalidSignature(signature: string): boolean {
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

function withClassNameInSignature(signature: string, name: string, className?: string): string {
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

function addFunctionSymbol(params: {
  symbols: ExtractedSymbol[];
  id: string;
  signature: string;
  filePath: string;
}): void {
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

function handleFunctionNode(
  node: Node,
  code: string,
  filePath: string,
  className?: string
): ExtractedSymbol | null {
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

function handleFieldDeclaration(
  node: Node,
  code: string,
  filePath: string,
  className: string
): ExtractedSymbol | null {
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

function walk(node: Node, fn: (node: Node) => void): void {
  fn(node);
  for (const child of node.namedChildren) {
    walk(child, fn);
  }
}

/**
 * 异步版本 - 用于 C++ 的 WASM 实现
 */
export async function extractSymbolsFromCodeAsync(code: string, filePath: string): Promise<ExtractedSymbol[]> {
  if (!code) {
    return [];
  }
  if (code.length > 2_000_000) {
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

  let tree: Tree | null;
  try {
    tree = parser!.parse(code);
  } catch (error) {
    const err = error as Error;
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

  const symbols: ExtractedSymbol[] = [];

  walk(root, (node) => {
    if (node.type === "class_specifier" || node.type === "struct_specifier") {
      const className = getClassName(node, code);
      if (!className) {
        return;
      }

      // Skip forward declarations (no body)
      const body =
        node.childForFieldName("body") || findNamedChild(node, ["field_declaration_list"]);
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
        signature: normalizeSignature(signature),
        declHash: hashSignature(signature),
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
