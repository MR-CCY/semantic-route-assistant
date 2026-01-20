/**
 * 测试 web-tree-sitter 基本功能
 * 用于验证 API 和确认迁移可行性
 */

import Parser from "web-tree-sitter";

async function testWebTreeSitter() {
    console.log("Testing web-tree-sitter...");

    try {
        // 1. 初始化 Parser（一次性操作）
        console.log("Initializing Parser...");
        await Parser.init();
        console.log("✓ Parser initialized");

        // 2. 创建 parser 实例
        const parser = new Parser();
        console.log("✓ Parser instance created");

        // 3. TODO: 加载 C++ 语言 WASM
        // 需要下载 tree-sitter-cpp.wasm 文件
        // const Cpp = await Parser.Language.load('./wasm/tree-sitter-cpp.wasm');
        // parser.setLanguage(Cpp);

        // 4. 测试解析简单代码
        const testCode = `
      int main() {
        return 0;
      }
    `;

        // const tree = parser.parse(testCode);
        // console.log("✓ Code parsed successfully");
        // console.log("Root node type:", tree.rootNode.type);

        console.log("\n✓ All basic tests passed!");
        console.log("\nNext steps:");
        console.log("1. Download tree-sitter-cpp.wasm file");
        console.log("2. Test parsing with actual C++ code");
        console.log("3. Compare performance with native tree-sitter");

    } catch (error) {
        console.error("✗ Test failed:", error);
        throw error;
    }
}

// 运行测试
testWebTreeSitter().catch(console.error);
