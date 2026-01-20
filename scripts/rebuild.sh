#!/usr/bin/env bash
set -euo pipefail

repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
do_package=false

while [[ $# -gt 0 ]]; do
  case "$1" in
    --package|-p)
      do_package=true
      shift
      ;;
    *)
      echo "Usage: $(basename "$0") [--package|-p]"
      exit 1
      ;;
  esac
done

if $do_package; then
  echo "[rebuild] installing core dependencies..."
  (cd "${repo_root}/core" && npm install --legacy-peer-deps)
fi

echo "[rebuild] building core..."
(cd "${repo_root}/core" && npm run build)

echo "[rebuild] refreshing local core dependency..."
(
  cd "${repo_root}/vscode-extension"
  rm -rf node_modules/semantic-route-assistant-core
  npm install --install-links=false --legacy-peer-deps semantic-route-assistant-core@file:../core
)

if $do_package; then
  echo "[rebuild] installing vscode-extension dependencies..."
  (cd "${repo_root}/vscode-extension" && npm install --legacy-peer-deps)
fi

echo "[rebuild] building vscode-extension..."
(cd "${repo_root}/vscode-extension" && npm run compile)

if $do_package; then
  echo "[rebuild] packaging vscode-extension..."
  (
    cd "${repo_root}/vscode-extension"
    node "${repo_root}/scripts/patch-tree-sitter-peers.js"
    npx @vscode/vsce package --allow-missing-repository
    ls -la *.vsix
  )
fi

echo "[rebuild] done"
