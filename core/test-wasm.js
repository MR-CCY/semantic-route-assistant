/**
 * 正确的 web-tree-sitter 使用方式测试
 */

const { Parser, Language } = require('web-tree-sitter');
const path = require('path');

(async () => {
    console.log("Testing web-tree-sitter (正确方式)...\n");

    try {
        // 1. 初始化 - 必须先调用 Parser.init()
        console.log("1. Initializing Parser...");
        await Parser.init();
        console.log("   ✅ Parser initialized\n");

        // 2. 创建 parser 实例
        console.log("2. Creating parser...");
        const parser = new Parser();
        console.log("   ✅ Parser created\n");

        // 3. 加载 C++ 语言
        console.log("3. Loading C++ language...");
        const wasmPath = path.join(__dirname, 'wasm', 'tree-sitter-cpp.wasm');
        const Cpp = await Language.load(wasmPath);
        parser.setLanguage(Cpp);
        console.log("   ✅ C++ language loaded\n");

        // 4. 测试解析
        const testCode = `
int add(int a, int b) {
  return a + b;
}

class Calculator {
public:
  int multiply(int x, int y) {
    return x * y;
  }
};
    `;

        console.log("4. Parsing C++ code...");
        const tree = parser.parse(testCode);
        console.log(`   ✅ Parsed! Root: ${tree.rootNode.type}`);
        console.log(`   Children: ${tree.rootNode.namedChildCount}\n`);

        // 5. 分析语法树
        console.log("5. Analyzing syntax tree...");
        const functions = [];
        const classes = [];

        function walk(node) {
            if (node.type === "function_definition") {
                const decl = node.childForFieldName("declarator");
                if (decl) functions.push(decl.text.split('(')[0].trim());
            }
            if (node.type === "class_specifier") {
                const name = node.childForFieldName("name");
                if (name) classes.push(name.text);
            }
            for (const child of node.namedChildren) {
                walk(child);
            }
        }

        walk(tree.rootNode);
        console.log(`   ✅ Found ${functions.length} functions: ${functions.join(', ')}`);
        console.log(`   ✅ Found ${classes.length} classes: ${classes.join(', ')}\n`);

        // 6. 性能测试
        console.log("6. Performance test (100 iterations)...");
        const start = Date.now();
        for (let i = 0; i < 100; i++) {
            parser.parse(testCode);
        }
        const elapsed = Date.now() - start;
        console.log(`   ✅ ${elapsed}ms total (${(elapsed / 100).toFixed(2)}ms avg)\n`);

        console.log("═".repeat(60));
        console.log("✅ ALL TESTS PASSED!");
        console.log("═".repeat(60));
        console.log("\n🎉 web-tree-sitter 验证成功!");
        console.log("\n📋 API 要点:");
        console.log("   • const { Parser, Language } = require('web-tree-sitter')");
        console.log("   • await Parser.init() - 必须先调用");
        console.log("   • const parser = new Parser()");
        console.log("   • const Lang = await Language.load(wasmPath)");
        console.log("   • parser.setLanguage(Lang)");
        console.log("   • const tree = parser.parse(code) - 与native相同\n");

        process.exit(0);
    } catch (error) {
        console.error("\n❌ Test failed:", error.message);
        console.error(error.stack);
        process.exit(1);
    }
})();
