#!/bin/bash

# VS Code Extension 打包脚本
# 用法: ./package.sh

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$SCRIPT_DIR"

echo "🧹 清理旧文件..."
rm -rf node_modules || true
rm -f *.vsix 2>/dev/null || true

echo "📦 安装依赖..."
npm install

echo "🔨 编译 TypeScript..."
npm run compile

echo "📦 打包扩展..."
yes | npx @vscode/vsce package --allow-missing-repository

echo ""
echo "✅ 打包完成！"
ls -la *.vsix
