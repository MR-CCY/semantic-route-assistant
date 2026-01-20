const esbuild = require("esbuild");
const fs = require("fs/promises");
const path = require("path");

const production = process.argv.includes("--production");
const watch = process.argv.includes("--watch");

/**
 * @type {import('esbuild').Plugin}
 */
const esbuildProblemMatcherPlugin = {
    name: "esbuild-problem-matcher",
    setup(build) {
        build.onStart(() => {
            console.log("[watch] build started");
        });
        build.onEnd(async (result) => {
            result.errors.forEach(({ text, location }) => {
                console.error(`✘ [ERROR] ${text}`);
                console.error(`    ${location.file}:${location.line}:${location.column}:`);
            });
            await copyWasmAssets();
            console.log("[watch] build finished");
        });
    },
};

async function copyWasmAssets() {
    const distDir = path.join(__dirname, "dist");
    const wasmDir = path.join(distDir, "wasm");
    const coreDist = path.join(__dirname, "..", "core", "dist");
    await fs.mkdir(wasmDir, { recursive: true });

    const copies = [
        {
            src: path.join(coreDist, "web-tree-sitter.wasm"),
            dest: path.join(distDir, "web-tree-sitter.wasm"),
        },
        {
            src: path.join(coreDist, "wasm", "tree-sitter-cpp.wasm"),
            dest: path.join(wasmDir, "tree-sitter-cpp.wasm"),
        },
    ];

    for (const { src, dest } of copies) {
        try {
            await fs.copyFile(src, dest);
        } catch (error) {
            console.warn(`[watch] wasm asset missing: ${src}`);
        }
    }
}

async function main() {
    const ctx = await esbuild.context({
        entryPoints: ["src/extension.ts"],
        bundle: true,
        format: "cjs",
        minify: production,
        sourcemap: !production,
        sourcesContent: false,
        platform: "node",
        outfile: "dist/extension.js",
        external: ["vscode", "tree-sitter", "tree-sitter-cpp"],
        logLevel: "silent",
        plugins: [esbuildProblemMatcherPlugin],
    });

    if (watch) {
        await ctx.watch();
    } else {
        await ctx.rebuild();
        await ctx.dispose();
    }
}

main().catch((e) => {
    console.error(e);
    process.exit(1);
});
