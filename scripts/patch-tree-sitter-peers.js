const fs = require("fs");
const path = require("path");

const repoRoot = path.resolve(__dirname, "..");
const targets = [
  path.join(repoRoot, "core", "node_modules", "tree-sitter-cpp", "package.json"),
  path.join(repoRoot, "vscode-extension", "node_modules", "tree-sitter-cpp", "package.json"),
  path.join(
    repoRoot,
    "vscode-extension",
    "node_modules",
    "semantic-route-assistant-core",
    "node_modules",
    "tree-sitter-cpp",
    "package.json"
  ),
  path.join(
    repoRoot,
    "vscode-extension",
    "node_modules",
    "semantic-route-core",
    "node_modules",
    "tree-sitter-cpp",
    "package.json"
  )
];

const desiredPeer = "^0.22.1";
let patched = 0;

for (const target of targets) {
  if (!fs.existsSync(target)) {
    continue;
  }

  const raw = fs.readFileSync(target, "utf8");
  let data;
  try {
    data = JSON.parse(raw);
  } catch {
    continue;
  }

  if (!data.peerDependencies) {
    data.peerDependencies = {};
  }

  if (data.peerDependencies["tree-sitter"] !== desiredPeer) {
    data.peerDependencies["tree-sitter"] = desiredPeer;
    fs.writeFileSync(target, JSON.stringify(data, null, 2), "utf8");
    patched += 1;
    console.log(`[patch-tree-sitter] updated ${target}`);
  }
}

if (patched === 0) {
  console.log("[patch-tree-sitter] no updates needed");
}
