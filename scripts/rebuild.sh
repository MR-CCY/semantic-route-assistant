#!/usr/bin/env bash
set -euo pipefail

repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

echo "[rebuild] building core..."
(cd "${repo_root}/core" && npm run build)

echo "[rebuild] refreshing local core dependency..."
(
  cd "${repo_root}/vscode-extension"
  rm -rf node_modules/semantic-route-assistant-core
  npm install --install-links=false semantic-route-assistant-core@file:../core
)

echo "[rebuild] building vscode-extension..."
(cd "${repo_root}/vscode-extension" && npm run compile)

echo "[rebuild] done"
