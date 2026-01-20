/**
 * 测试 web-tree-sitter - 使用 ES module 导入
 */

import Parser from "web-tree-sitter";
import path from "path";
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.url));

async function testWebTreeSitter() {
    console.log("Testing web-tree-sitter...\n");

    try {
        // await Parser自身可能是初始化过程
        console.log("1. Initializing Parser...");
        await Parser.init();
        console.log("   ✓ Initialized\n");

        const parser = new Parser();
        console.log("2. Parser created\n");

        const cppWasmPath = path.join(__dirname, "wasm", "tree-sitter-cpp.wasm");
        const Cpp = await Parser.Language.load(cppWasmPath);
        parser.setLanguage(Cpp);
        console.log("3. C++ language loaded\n");

        const tree = parser.parse("int main() { return 0; }");
        console.log("4. Code parsed!");
        console.log(`   Root: ${tree.rootNode.type}\n`);

        console.log("✅ SUCCESS!");
        return true;
    } catch (error) {
        console.error("❌ Failed:", error.message);
        return false;
    }
}

testWebTreeSitter().then(success => process.exit(success ? 0 : 1));
