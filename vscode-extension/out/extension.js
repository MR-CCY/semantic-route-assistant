"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.activate = activate;
exports.deactivate = deactivate;
const vscode = __importStar(require("vscode"));
const path_1 = __importDefault(require("path"));
const promises_1 = require("fs/promises");
const fs_1 = require("fs");
const core = __importStar(require("semantic-route-assistant-core"));
const crypto_1 = require("crypto");
const CONFIG_SECTION = "semanticRoute";
const SECRET_KEY = "semanticRoute.llm.apiKey";
const PROFILE_SECRET_PREFIX = "semanticRoute.llm.apiKey.profile.";
const OUTPUT_CHANNEL = vscode.window.createOutputChannel("Semantic Route");
const PROVIDERS = ["openai", "qwen", "gemini", "other", "disable"];
const PROFILE_PROVIDERS = ["openai", "qwen", "gemini", "other"];
const MODEL_PRESETS = {
    openai: ["gpt-4o-mini", "gpt-4.1-mini", "gpt-4o"],
    qwen: ["qwen-flash", "qwen-turbo", "qwen-plus", "qwen-max"],
    gemini: ["gemini-1.5-flash", "gemini-1.5-pro"]
};
function getProfileSecretKey(profileId) {
    return `${PROFILE_SECRET_PREFIX}${profileId}`;
}
function sanitizeProfileId(label) {
    const slug = label
        .trim()
        .toLowerCase()
        .replace(/[^a-z0-9_-]+/g, "-")
        .replace(/^-+|-+$/g, "");
    return slug || `profile-${Date.now()}`;
}
function countOccurrences(haystack, needle) {
    if (!needle)
        return 0;
    let count = 0;
    let index = 0;
    while (index !== -1) {
        index = haystack.indexOf(needle, index);
        if (index !== -1) {
            count += 1;
            index += needle.length || 1;
        }
    }
    return count;
}
function normalizeFilePath(filePath) {
    return filePath.replace(/\\/g, "/").replace(/^\.\//, "");
}
async function hasModuleIndex(indexRoot) {
    const modulesDir = path_1.default.join(indexRoot, "modules");
    try {
        const entries = await (0, promises_1.readdir)(modulesDir, { withFileTypes: true });
        return entries.some((entry) => entry.isFile() && entry.name.endsWith(".md"));
    }
    catch {
        return false;
    }
}
function parseModuleEntries(content) {
    const entries = new Map();
    const lines = content.split("\n");
    const entryRegex = /^\s*-\s+`([^`]+)`\s*<!--\s*id:\s*([^|]+)\s*\|\s*hash:\s*([^\s|]+)(?:\s*\|\s*impl:\s*([^\s|]+))?(?:\s*\|\s*file:\s*([^|]+))?(?:\s*\|\s*tags_base:\s*\[([^\]]*)\])?(?:\s*\|\s*tags_sem:\s*\[([^\]]*)\])?(?:\s*\|\s*tags:\s*\[([^\]]*)\])?\s*-->/;
    for (let i = 0; i < lines.length; i += 1) {
        const line = lines[i];
        const match = line.match(entryRegex);
        if (!match) {
            continue;
        }
        const signature = match[1].trim();
        const id = match[2].trim();
        let brief = "";
        let j = i + 1;
        while (j < lines.length && !lines[j].startsWith("## ") && !entryRegex.test(lines[j])) {
            if (lines[j].trim()) {
                brief = lines[j].trim();
            }
            j += 1;
        }
        entries.set(id, { signature, brief });
        i = j - 1;
    }
    return entries;
}
async function snapshotModuleFiles(modulesDir) {
    const snapshot = new Map();
    try {
        await (0, promises_1.access)(modulesDir, fs_1.constants.F_OK);
    }
    catch {
        return snapshot;
    }
    const uris = await vscode.workspace.findFiles(new vscode.RelativePattern(modulesDir, "**/*.md"));
    for (const uri of uris) {
        try {
            const buffer = await (0, promises_1.readFile)(uri.fsPath);
            const hash = (0, crypto_1.createHash)("sha1").update(buffer).digest("hex");
            snapshot.set(uri.fsPath, hash);
        }
        catch {
            // ignore read errors
        }
    }
    return snapshot;
}
function diffModuleSnapshots(before, after) {
    const created = [];
    const updated = [];
    for (const [filePath, hash] of after.entries()) {
        const prevHash = before.get(filePath);
        if (!prevHash) {
            created.push(filePath);
        }
        else if (prevHash !== hash) {
            updated.push(filePath);
        }
    }
    created.sort();
    updated.sort();
    return { created, updated };
}
function reportModuleChanges(actionLabel, projectRoot, created, updated) {
    OUTPUT_CHANNEL.appendLine(`[V3] ${actionLabel}完成：新增 ${created.length}，更新 ${updated.length}`);
    if (created.length > 0) {
        OUTPUT_CHANNEL.appendLine("新增:");
        for (const filePath of created) {
            const rel = path_1.default.relative(projectRoot, filePath) || filePath;
            OUTPUT_CHANNEL.appendLine(`  - ${rel}`);
        }
    }
    if (updated.length > 0) {
        OUTPUT_CHANNEL.appendLine("更新:");
        for (const filePath of updated) {
            const rel = path_1.default.relative(projectRoot, filePath) || filePath;
            OUTPUT_CHANNEL.appendLine(`  - ${rel}`);
        }
    }
    if (created.length === 0 && updated.length === 0) {
        OUTPUT_CHANNEL.appendLine("[V3] 未发现模块文件变更。");
    }
    OUTPUT_CHANNEL.appendLine("");
    if (created.length > 0 || updated.length > 0) {
        OUTPUT_CHANNEL.show(true);
    }
}
async function loadRouting(indexRoot) {
    const loadFromCore = core.loadRouting;
    if (loadFromCore) {
        try {
            return await loadFromCore(indexRoot);
        }
        catch (error) {
            const message = error?.message ? ` ${error.message}` : "";
            vscode.window.showErrorMessage(`Semantic Route: 索引数据版本不兼容。${message}`);
            return null;
        }
    }
    const routingPath = path_1.default.join(indexRoot, "routing.json");
    try {
        const content = await (0, promises_1.readFile)(routingPath, "utf8");
        return JSON.parse(content);
    }
    catch {
        return null;
    }
}
async function searchSkillsV2(indexRoot, query) {
    const routing = await loadRouting(indexRoot);
    if (!routing) {
        return [];
    }
    const entryMap = new Map();
    for (const modulePath of Object.values(routing.modules)) {
        const resolvedPath = path_1.default.join(indexRoot, modulePath);
        try {
            const content = await (0, promises_1.readFile)(resolvedPath, "utf8");
            const parsed = parseModuleEntries(content);
            for (const [id, entry] of parsed.entries()) {
                entryMap.set(id, entry);
            }
        }
        catch {
            // ignore missing module files
        }
    }
    const tokens = query
        .split(/\s+/)
        .map((token) => token.trim())
        .filter(Boolean);
    const tagFilters = tokens
        .filter((token) => token.startsWith("#"))
        .map((token) => token.slice(1).toLowerCase())
        .filter(Boolean);
    const keywords = tokens.filter((token) => !token.startsWith("#")).map((token) => token.toLowerCase());
    const results = [];
    for (const [symbolId, info] of Object.entries(routing.symbols)) {
        const entry = entryMap.get(symbolId);
        const signature = entry?.signature ?? symbolId;
        const brief = entry?.brief ?? "";
        const tagsBase = (info.tagsBase || info.tags || []).map((tag) => tag.toLowerCase());
        const tagsSemantic = (info.tagsSemantic || []).map((tag) => tag.toLowerCase());
        const tagsCustom = (info.tagsCustom || []).map((tag) => tag.toLowerCase());
        const allTags = Array.from(new Set([...tagsSemantic, ...tagsBase, ...tagsCustom]));
        const filePath = info.filePath;
        if (tagFilters.length > 0) {
            const allMatch = tagFilters.every((tag) => allTags.includes(tag));
            if (!allMatch) {
                continue;
            }
        }
        let score = 0;
        if (tagFilters.length > 0) {
            score += 5 * tagFilters.length;
        }
        for (const keyword of keywords) {
            if (info.module.toLowerCase().includes(keyword)) {
                score += 2;
            }
            if (symbolId.toLowerCase().includes(keyword)) {
                score += 3;
            }
            if (filePath && filePath.toLowerCase().includes(keyword)) {
                score += 1;
            }
            if (tagsSemantic.some((tag) => tag.includes(keyword))) {
                score += 4;
            }
            if (tagsBase.some((tag) => tag.includes(keyword))) {
                score += 1;
            }
            if (tagsCustom.some((tag) => tag.includes(keyword))) {
                score += 1;
            }
            if (signature.toLowerCase().includes(keyword)) {
                score += 1;
            }
            if (brief) {
                score += countOccurrences(brief.toLowerCase(), keyword) * 2;
            }
        }
        if (score > 0 || tagFilters.length > 0) {
            results.push({
                id: symbolId,
                module: info.module,
                signature,
                brief,
                tags: allTags,
                filePath,
                score
            });
        }
    }
    results.sort((a, b) => b.score - a.score);
    return results;
}
function getSelectedText(editor) {
    if (!editor) {
        return "";
    }
    return editor.selection.isEmpty ? "" : editor.document.getText(editor.selection);
}
function getCodeSnippet(editor) {
    if (!editor) {
        return "";
    }
    return editor.selection.isEmpty
        ? editor.document.getText()
        : editor.document.getText(editor.selection);
}
function getAutoQuery(editor) {
    const selected = getSelectedText(editor).trim();
    if (selected) {
        return selected;
    }
    if (editor) {
        const lineText = editor.document.lineAt(editor.selection.active.line).text.trim();
        if (lineText) {
            return lineText;
        }
        return path_1.default.basename(editor.document.fileName);
    }
    return "";
}
function buildApiPrompt(items, codeSnippet) {
    const apiLines = [];
    for (const item of items) {
        apiLines.push(`- \`${item.signature}\``);
        if (item.brief) {
            apiLines.push(`  ${item.brief}`);
        }
        else {
            apiLines.push(`  TODO: brief description`);
        }
        apiLines.push("");
    }
    return [
        "# Relevant APIs",
        "",
        ...apiLines,
        "# Current Code",
        "",
        "```cpp",
        codeSnippet,
        "```"
    ].join("\n");
}
async function resolveIndexRoot(root) {
    const v3Root = path_1.default.join(root, ".ai_context");
    const v2Root = path_1.default.join(root, "llm_index");
    try {
        await (0, promises_1.access)(v3Root, fs_1.constants.R_OK);
        return v3Root;
    }
    catch {
        try {
            await (0, promises_1.access)(v2Root, fs_1.constants.R_OK);
            return v2Root;
        }
        catch {
            return null;
        }
    }
}
async function buildEntryMapForRouting(indexRoot, routing) {
    const entryMap = new Map();
    // Get signature and brief directly from routing.json
    for (const [symbolId, info] of Object.entries(routing.symbols)) {
        entryMap.set(symbolId, {
            signature: info.signature || symbolId,
            brief: info.brief || ""
        });
    }
    return entryMap;
}
async function buildTagGraphData(indexRoot) {
    const routing = await loadRouting(indexRoot);
    if (!routing) {
        return [];
    }
    const entryMap = await buildEntryMapForRouting(indexRoot, routing);
    const tagMap = new Map();
    const tagPriority = {
        semantic: 3,
        base: 2,
        custom: 1
    };
    for (const [symbolId, info] of Object.entries(routing.symbols)) {
        const semanticTags = (info.tagsSemantic || []).map((tag) => tag.toLowerCase());
        const baseTags = (info.tagsBase || info.tags || []).map((tag) => tag.toLowerCase());
        const customTags = (info.tagsCustom || []).map((tag) => tag.toLowerCase());
        const allTags = Array.from(new Set([...semanticTags, ...baseTags, ...customTags].filter(Boolean)));
        const tags = semanticTags.length > 0
            ? semanticTags
            : baseTags.length > 0
                ? baseTags
                : customTags;
        if (tags.length === 0) {
            continue;
        }
        const entry = entryMap.get(symbolId);
        const signature = entry?.signature ?? symbolId;
        const brief = entry?.brief ?? "";
        const line = info.declLine || info.implLine;
        const item = {
            id: symbolId,
            signature,
            brief,
            tags: allTags,
            filePath: info.filePath,
            line,
            module: info.module,
            tagsBase: baseTags,
            tagsSemantic: semanticTags,
            tagsCustom: customTags
        };
        const ensureTag = (tag, tagType) => {
            if (!tag) {
                return;
            }
            const existing = tagMap.get(tag);
            if (!existing) {
                tagMap.set(tag, { tagType, items: [item] });
                return;
            }
            if (tagPriority[tagType] > tagPriority[existing.tagType]) {
                existing.tagType = tagType;
            }
            existing.items.push(item);
        };
        for (const tag of semanticTags) {
            ensureTag(tag, "semantic");
        }
        for (const tag of baseTags) {
            ensureTag(tag, "base");
        }
        for (const tag of customTags) {
            ensureTag(tag, "custom");
        }
    }
    const nodes = [];
    for (const [tag, entry] of tagMap.entries()) {
        nodes.push({ tag, tagType: entry.tagType, count: entry.items.length, items: entry.items });
    }
    nodes.sort((a, b) => b.count - a.count);
    return nodes;
}
function getNonce() {
    let text = "";
    const possible = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";
    for (let i = 0; i < 16; i += 1) {
        text += possible.charAt(Math.floor(Math.random() * possible.length));
    }
    return text;
}
function getTagGraphHtml() {
    const nonce = getNonce();
    return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <style>
    :root {
      --bg: radial-gradient(1200px circle at 20% 10%, #2b1b4b 0%, #1b1032 40%, #120924 100%);
      --panel: rgba(18, 9, 36, 0.6);
      --text: #f7f4ff;
      --muted: rgba(247, 244, 255, 0.65);
      --accent: #7f5bff;
      --bubble: rgba(102, 72, 200, 0.35);
      --bubble-border: rgba(155, 120, 255, 0.7);
      --list-height: 38%;
    }
    body {
      margin: 0;
      padding: 0;
      font-family: "Avenir Next", "PingFang SC", "Noto Sans CJK SC", sans-serif;
      color: var(--text);
      background: var(--bg);
      height: 100vh;
      overflow: hidden;
    }
    .layout {
      display: grid;
      grid-template-rows: 1fr var(--list-height);
      height: 100%;
    }
    .bubble-zone {
      position: relative;
      overflow: hidden;
      padding: 0;
    }
    #bubble-canvas {
      width: 100%;
      height: 100%;
      display: block;
      touch-action: none;
      cursor: grab;
    }
    #bubble-canvas.panning {
      cursor: grabbing;
    }
    .empty-hint {
      position: absolute;
      inset: 0;
      display: flex;
      align-items: center;
      justify-content: center;
      color: var(--muted);
      font-size: 12px;
      pointer-events: none;
    }
    .search-bar {
      position: absolute;
      left: 50%;
      top: 14px;
      transform: translateX(-50%);
      display: flex;
      flex-direction: column;
      align-items: center;
      gap: 10px;
      z-index: 2;
      width: min(860px, 92vw);
      min-width: 0;
      pointer-events: none;
    }
    .refresh-btn {
      background: rgba(20, 12, 36, 0.85);
      border-radius: 999px;
      padding: 4px 12px;
      border: 1px solid rgba(255, 255, 255, 0.12);
      color: var(--text);
      font-size: 11px;
      cursor: pointer;
      white-space: nowrap;
      flex-shrink: 0;
    }
    .refresh-btn:hover {
      border-color: var(--accent);
    }
    .search-row {
      display: flex;
      align-items: center;
      gap: 10px;
      background: rgba(20, 12, 36, 0.85);
      border-radius: 999px;
      padding: 6px 12px;
      border: 1px solid rgba(255, 255, 255, 0.12);
      pointer-events: auto;
      width: 100%;
      box-sizing: border-box;
    }
    .search-row input {
      flex: 1 1 auto;
      min-width: 120px;
      background: transparent;
      border: none;
      color: var(--text);
      font-size: 13px;
      outline: none;
    }
    .search-actions {
      display: flex;
      gap: 6px;
      flex-shrink: 0;
    }
    .search-actions button {
      padding: 4px 12px;
      min-width: 56px;
      border-radius: 999px;
      border: 1px solid rgba(255, 255, 255, 0.15);
      background: rgba(127, 91, 255, 0.2);
      color: var(--text);
      font-size: 11px;
      cursor: pointer;
    }
    .search-actions button.active {
      background: rgba(255, 211, 107, 0.2);
      border-color: rgba(255, 211, 107, 0.7);
    }
    .suggestions {
      width: 100%;
      max-height: 180px;
      overflow: auto;
      background: rgba(20, 12, 36, 0.95);
      border-radius: 12px;
      border: 1px solid rgba(255, 255, 255, 0.12);
      display: none;
      pointer-events: auto;
    }
    .suggestions.active {
      display: block;
    }
    .suggestion {
      padding: 8px 12px;
      cursor: pointer;
      display: flex;
      justify-content: space-between;
      font-size: 12px;
    }
    .suggestion.active {
      background: rgba(127, 91, 255, 0.25);
    }
    .suggestion:hover {
      background: rgba(127, 91, 255, 0.2);
    }
    .list-zone {
      position: relative;
      background: var(--panel);
      border-top: 1px solid rgba(255, 255, 255, 0.08);
      display: flex;
      flex-direction: column;
      padding: 8px 18px 14px;
      gap: 8px;
      overflow: hidden;
    }
    .list-header {
      display: flex;
      flex-direction: column;
      gap: 6px;
    }
    .list-meta {
      font-size: 12px;
      color: var(--muted);
      text-align: center;
    }
    .selected-tags {
      display: flex;
      gap: 6px;
      flex-wrap: wrap;
      justify-content: center;
    }
    .tag-chip {
      padding: 2px 8px;
      border-radius: 999px;
      font-size: 11px;
      border: 1px solid rgba(255,255,255,0.2);
      color: var(--muted);
      cursor: pointer;
      transition: all 0.2s ease;
      background: rgba(255,255,255,0.04);
    }
    .tag-chip:hover {
      color: var(--text);
      border-color: var(--accent);
    }
    /* Base tag style - purple */
    .tag-chip.base {
      background: rgba(139, 92, 246, 0.15);
      border-color: rgba(167, 139, 250, 0.5);
      color: #c4b5fd;
    }
    .tag-chip.base:hover {
      background: rgba(139, 92, 246, 0.25);
      border-color: #a78bfa;
      color: #f7f4ff;
    }
    /* Semantic tag style - gold/yellow */
    .tag-chip.semantic {
      background: rgba(251, 191, 36, 0.15);
      border-color: rgba(251, 191, 36, 0.5);
      color: #fcd34d;
    }
    .tag-chip.semantic:hover {
      background: rgba(251, 191, 36, 0.25);
      border-color: #fbbf24;
      color: #fef3c7;
    }
    /* Custom tag style - teal */
    .tag-chip.custom {
      background: rgba(56, 189, 248, 0.15);
      border-color: rgba(56, 189, 248, 0.5);
      color: #7dd3fc;
    }
    .tag-chip.custom:hover {
      background: rgba(56, 189, 248, 0.25);
      border-color: #38bdf8;
      color: #e0f2fe;
    }
    .list {
      overflow: auto;
      display: grid;
      gap: 10px;
      padding-bottom: 6px;
      justify-items: center;
    }
    .item {
      padding: 10px 12px;
      background: rgba(255,255,255,0.06);
      border-radius: 12px;
      border: 1px solid rgba(255,255,255,0.08);
      cursor: pointer;
      transition: border 0.2s ease;
      width: 100%;
      max-width: 920px;
      box-sizing: border-box;
    }
    .item:hover {
      border-color: var(--accent);
    }
    .item .signature {
      font-size: 13px;
      font-weight: 600;
      line-height: 1.35;
      white-space: normal;
      overflow-wrap: anywhere;
      word-break: break-word;
    }
    .item .brief {
      margin-top: 4px;
      font-size: 12px;
      color: var(--muted);
    }
    .tag-row {
      margin-top: 6px;
      display: flex;
      gap: 6px;
      flex-wrap: wrap;
      align-items: center;
    }
    @media (max-width: 900px) {
      .layout { grid-template-rows: 1fr 45%; }
    }
    /* Edit Description */
    .edit-box-container {
      display: flex;
      align-items: center;
      gap: 6px;
      margin-bottom: 4px;
    }
    .edit-box {
      flex: 1;
      background: rgba(0,0,0,0.2);
      border: 1px solid var(--bubble-border);
      color: var(--text);
      font-size: 13px;
      padding: 4px;
      border-radius: 4px;
      outline: none;
    }
    .edit-btns {
      display: flex;
      gap: 4px;
    }
    .btn-icon {
      cursor: pointer;
      padding: 2px;
      border-radius: 3px;
      display: flex;
      align-items: center;
      justify-content: center;
      width: 20px;
      height: 20px;
      font-size: 12px;
      background: rgba(255,255,255,0.1);
    }
    .btn-icon:hover {
      background: rgba(255,255,255,0.2);
    }
    .btn-check { color: #4caf50; }
    .btn-cross { color: #f44336; }

    /* Add Tag Button */
    .add-tag-btn {
      display: inline-flex;
      align-items: center;
      justify-content: center;
      width: 16px;
      height: 16px;
      border-radius: 50%;
      background: rgba(255,255,255,0.1);
      color: var(--text);
      font-size: 12px;
      line-height: 1;
      cursor: pointer;
      margin-left: 4px;
      user-select: none;
      align-self: center;
    }
    .add-tag-btn:hover {
      background: var(--accent);
    }

    /* Tag Popup */
    .tag-popup-overlay {
      position: fixed;
      inset: 0;
      background: rgba(0,0,0,0.5);
      z-index: 100;
      display: none;
    }
    .tag-popup-overlay.active {
      display: block;
    }
    .tag-popup {
      position: absolute;
      top: 50%;
      left: 50%;
      transform: translate(-50%, -50%);
      width: 400px;
      background: #1b1032;
      border: 1px solid var(--bubble-border);
      border-radius: 8px;
      padding: 16px;
      box-shadow: 0 4px 20px rgba(0,0,0,0.5);
      display: flex;
      flex-direction: column;
      gap: 12px;
    }
    .popup-search-row {
      display: flex;
      gap: 6px;
    }
    .popup-filter-actions {
      display: flex;
      gap: 6px;
      flex-wrap: wrap;
    }
    .popup-filter-actions button {
      padding: 4px 10px;
      border-radius: 999px;
      border: 1px solid rgba(255, 255, 255, 0.15);
      background: rgba(127, 91, 255, 0.2);
      color: var(--text);
      font-size: 11px;
      cursor: pointer;
    }
    .popup-filter-actions button.active {
      background: rgba(255, 211, 107, 0.2);
      border-color: rgba(255, 211, 107, 0.7);
    }
    .popup-search {
      flex: 1;
      background: rgba(0,0,0,0.2);
      border: 1px solid rgba(255,255,255,0.1);
      padding: 8px;
      color: var(--text);
      border-radius: 4px;
      box-sizing: border-box;
      outline: none;
    }
    .popup-add-btn {
      width: 32px;
      background: rgba(255,255,255,0.1);
      border: none;
      color: var(--text);
      border-radius: 4px;
      cursor: pointer;
      display: flex;
      align-items: center;
      justify-content: center;
    }
    .popup-add-btn:hover {
      background: var(--accent);
    }
    .popup-list {
      max-height: 200px;
      overflow-y: auto;
      border: 1px solid rgba(255,255,255,0.05);
      border-radius: 4px;
      padding: 4px;
    }
    .popup-item {
      padding: 4px 8px;
      cursor: pointer;
      border-radius: 3px;
      display: flex;
      justify-content: space-between;
    }
    .popup-item:hover {
      background: rgba(255,255,255,0.1);
    }
    .popup-tags-selected {
        display: flex;
        flex-wrap: wrap;
        gap: 6px;
        min-height: 30px;
        padding: 4px;
        background: rgba(0,0,0,0.2);
        border-radius: 4px;
    }
    .popup-actions {
      display: flex;
      justify-content: flex-end;
      gap: 8px;
    }
    .popup-btn {
      padding: 4px 12px;
      border-radius: 4px;
      cursor: pointer;
      font-size: 12px;
      border: none;
    }
    .btn-save { background: var(--accent); color: white; }
    .btn-cancel { background: rgba(255,255,255,0.1); color: var(--text); }
  </style>
</head>
<body>
  <div class="layout">
    <div class="bubble-zone">
      <canvas id="bubble-canvas"></canvas>
      <div class="empty-hint" id="empty-hint">暂无标签数据，请先构建索引。</div>
      <div class="search-bar">
      <div class="search-row">
        <input id="search-input" placeholder="搜索标签…" />
        <div class="search-actions" id="filter-actions">
          <button data-filter="all" class="active">全部</button>
          <button data-filter="base">基础</button>
          <button data-filter="semantic">语义</button>
          <button data-filter="custom">自定义</button>
        </div>
        <button class="refresh-btn" id="refresh-btn">刷新</button>
      </div>
      <div class="suggestions" id="suggestions"></div>
    </div>
    </div>
    <div class="list-zone">
      <div class="list-header">
        <div class="list-meta" id="panel-meta">请选择一个或多个标签</div>
        <div class="selected-tags" id="selected-tags"></div>
      </div>
      <div class="list" id="list"></div>
    </div>
  </div>
  <div class="tag-popup-overlay" id="tag-popup-overlay">
    <div class="tag-popup">
      <div class="popup-search-row">
        <input type="text" class="popup-search" id="popup-search" placeholder="搜索或创建标签..." />
        <button class="popup-add-btn" id="popup-add-new" title="作为新标签添加">+</button>
      </div>
      <div class="popup-filter-actions" id="popup-filter-actions">
        <button data-filter="all" class="active">全部</button>
        <button data-filter="base">基础</button>
        <button data-filter="semantic">语义</button>
        <button data-filter="custom">自定义</button>
      </div>
      <div class="popup-list" id="popup-list"></div>
      <div class="popup-tags-selected" id="popup-tags-selected"></div>
      <div class="popup-actions">
        <button class="popup-btn btn-cancel" id="popup-cancel">取消</button>
        <button class="popup-btn btn-save" id="popup-save">保存</button>
      </div>
    </div>
  </div>
  <script nonce="${nonce}">
    const vscode = acquireVsCodeApi();
    const bubbleZone = document.querySelector('.bubble-zone');
    const canvas = document.getElementById('bubble-canvas');
    const ctx = canvas.getContext('2d');
    const emptyHint = document.getElementById('empty-hint');
    const refreshBtn = document.getElementById('refresh-btn');
    const list = document.getElementById('list');
    const panelMeta = document.getElementById('panel-meta');
    const selectedTagsEl = document.getElementById('selected-tags');
    const searchInput = document.getElementById('search-input');
    const suggestions = document.getElementById('suggestions');
    const filterActions = document.getElementById('filter-actions');
    let tagData = [];
    let selectedTags = [];
    let activeFilter = 'all';
    let pendingSelection = null;
    let layout = null;
    let hoverTag = null;
    let suggestionIndex = -1;
    let suggestionItems = [];
    
    // Popup state
    const tagPopupOverlay = document.getElementById('tag-popup-overlay');
    const popupSearch = document.getElementById('popup-search');
    const popupFilterActions = document.getElementById('popup-filter-actions');
    const popupList = document.getElementById('popup-list');
    const popupTagsSelected = document.getElementById('popup-tags-selected');
    const popupSave = document.getElementById('popup-save');
    const popupCancel = document.getElementById('popup-cancel');
    const popupAddNew = document.getElementById('popup-add-new');
    let popupSelectedTags = [];
    let popupCurrentSymbolId = null;
    let popupActiveFilter = 'all';
    
    let rafId = 0;
    let canvasWidth = 0;
    let canvasHeight = 0;
    const view = {
      scale: 1,
      offsetX: 0,
      offsetY: 0
    };
    const pointers = new Map();
    let isPanning = false;
    let dragStart = null;
    let pressedTag = null;
    let dragged = false;
    let pinchStart = null;

    function requestRender() {
      if (rafId) return;
      rafId = requestAnimationFrame(draw);
    }

    function resizeCanvas() {
      const rect = bubbleZone.getBoundingClientRect();
      if (!rect.width || !rect.height) return;
      const dpr = window.devicePixelRatio || 1;
      canvas.width = rect.width * dpr;
      canvas.height = rect.height * dpr;
      canvas.style.width = rect.width + 'px';
      canvas.style.height = rect.height + 'px';
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      canvasWidth = rect.width;
      canvasHeight = rect.height;
      if (layout) {
        centerView();
      }
      requestRender();
    }

    function getFilteredTags() {
      if (activeFilter === 'all') {
        return tagData;
      }
      return tagData.filter((item) => item.tagType === activeFilter);
    }

    function buildLayout() {
      const filtered = getFilteredTags();
      if (!filtered.length) {
        layout = null;
        requestRender();
        return;
      }
      const counts = filtered.map((item) => item.count);
      const min = Math.min(...counts);
      const max = Math.max(...counts);
      const minDiameter = 70;
      const maxDiameter = 190;
      const diameterFor = (item) => {
        const raw = max === min ? 0.5 : (item.count - min) / (max - min);
        const scaled = Math.pow(raw, 1.15);
        return minDiameter + scaled * (maxDiameter - minDiameter);
      };
      const nodes = filtered.map((item) => ({
        ...item,
        radius: diameterFor(item) / 2,
        x: 0,
        y: 0,
        angle: 0
      }));
      nodes.sort((a, b) => b.radius - a.radius);
      const maxRadius = nodes[0]?.radius || 60;
      const gap = Math.max(4, maxRadius * 0.03);
      const cellSize = (maxRadius + gap) * 2;
      const grid = new Map();
      const placed = [];
      const map = new Map();
      const cellKey = (x, y) =>
        String(Math.floor(x / cellSize)) + "," + String(Math.floor(y / cellSize));
      const addToGrid = (index) => {
        const node = placed[index];
        const key = cellKey(node.x, node.y);
        node._cellKey = key;
        let list = grid.get(key);
        if (!list) {
          list = [];
          grid.set(key, list);
        }
        list.push(index);
      };
      const removeFromGrid = (index) => {
        const node = placed[index];
        const key = node._cellKey;
        if (!key) return;
        const list = grid.get(key);
        if (!list) return;
        const pos = list.indexOf(index);
        if (pos >= 0) list.splice(pos, 1);
        if (!list.length) grid.delete(key);
      };
      const updateGrid = (index) => {
        removeFromGrid(index);
        addToGrid(index);
      };
      const collides = (x, y, r, ignoreIndex) => {
        const cx = Math.floor(x / cellSize);
        const cy = Math.floor(y / cellSize);
        for (let dx = -1; dx <= 1; dx += 1) {
          for (let dy = -1; dy <= 1; dy += 1) {
            const list = grid.get(String(cx + dx) + "," + String(cy + dy));
            if (!list) continue;
            for (const idx of list) {
              if (idx === ignoreIndex) continue;
              const other = placed[idx];
              const dist = Math.hypot(x - other.x, y - other.y);
              if (dist < r + other.radius + gap) {
                return true;
              }
            }
          }
        }
        return false;
      };

      const phi = 2.399963229728653;
      const baseStep = (maxRadius + gap) * 0.85;

      nodes.forEach((node, index) => {
        node.angle = index * phi;
        if (index === 0) {
          node.x = 0;
          node.y = 0;
          placed.push(node);
          map.set(node.tag, node);
          addToGrid(placed.length - 1);
          return;
        }
        let radius = baseStep * Math.sqrt(index);
        let placedOk = false;
        for (let attempt = 0; attempt < 2400; attempt += 1) {
          const x = Math.cos(node.angle) * radius;
          const y = Math.sin(node.angle) * radius;
          if (!collides(x, y, node.radius)) {
            node.x = x;
            node.y = y;
            placedOk = true;
            break;
          }
          radius += Math.max(4, node.radius * 0.18);
        }
        if (!placedOk) {
          node.x = Math.cos(node.angle) * radius;
          node.y = Math.sin(node.angle) * radius;
        }
        placed.push(node);
        map.set(node.tag, node);
        addToGrid(placed.length - 1);
      });

      const compressPasses = 6;
      for (let pass = 0; pass < compressPasses; pass += 1) {
        for (let i = 1; i < placed.length; i += 1) {
          const node = placed[i];
          let radius = Math.hypot(node.x, node.y);
          const step = Math.max(3, node.radius * 0.15);
          for (let attempt = 0; attempt < 6; attempt += 1) {
            const nextRadius = radius - step;
            if (nextRadius <= node.radius * 0.5) {
              break;
            }
            const nx = Math.cos(node.angle) * nextRadius;
            const ny = Math.sin(node.angle) * nextRadius;
            if (collides(nx, ny, node.radius, i)) {
              break;
            }
            node.x = nx;
            node.y = ny;
            radius = nextRadius;
            updateGrid(i);
          }
        }
      }

      let minX = Infinity;
      let minY = Infinity;
      let maxX = -Infinity;
      let maxY = -Infinity;
      placed.forEach((node) => {
        minX = Math.min(minX, node.x - node.radius);
        maxX = Math.max(maxX, node.x + node.radius);
        minY = Math.min(minY, node.y - node.radius);
        maxY = Math.max(maxY, node.y + node.radius);
      });
      layout = {
        nodes: placed,
        map,
        grid,
        gap,
        cellSize,
        bounds: { minX, minY, maxX, maxY }
      };
      centerView();
      requestRender();
    }

    function centerView() {
      if (!layout) return;
      const { bounds } = layout;
      const centerX = (bounds.minX + bounds.maxX) / 2;
      const centerY = (bounds.minY + bounds.maxY) / 2;
      view.offsetX = canvasWidth / 2 - centerX * view.scale;
      view.offsetY = canvasHeight / 2 - centerY * view.scale;
    }

    function screenToWorld(clientX, clientY) {
      const rect = canvas.getBoundingClientRect();
      const x = (clientX - rect.left - view.offsetX) / view.scale;
      const y = (clientY - rect.top - view.offsetY) / view.scale;
      return { x, y };
    }

    function findNodeAt(clientX, clientY) {
      if (!layout) return null;
      const { x, y } = screenToWorld(clientX, clientY);
      const cellX = Math.floor(x / layout.cellSize);
      const cellY = Math.floor(y / layout.cellSize);
      for (let dx = -1; dx <= 1; dx += 1) {
        for (let dy = -1; dy <= 1; dy += 1) {
          const list = layout.grid.get(String(cellX + dx) + "," + String(cellY + dy));
          if (!list) continue;
          for (const idx of list) {
            const node = layout.nodes[idx];
            if (Math.hypot(x - node.x, y - node.y) <= node.radius) {
              return node;
            }
          }
        }
      }
      return null;
    }

    function getBubblePalette(tagType) {
      if (tagType === 'semantic') {
        return {
          glow: '#fbbf24',
          glowFill: 'rgba(251, 191, 36, 0.25)',
          highlight: 'rgba(255, 243, 196, 0.35)',
          mid: 'rgba(251, 191, 36, 0.15)',
          hoverMid: 'rgba(251, 191, 36, 0.25)',
          activeMid: 'rgba(251, 191, 36, 0.25)',
          deep: 'rgba(140, 92, 24, 0.32)',
          edge: 'rgba(70, 45, 15, 0.2)',
          stroke: 'rgba(251, 191, 36, 0.5)',
          rimLight: 'rgba(255, 255, 255, 0.6)',
          rimDark: 'rgba(110, 70, 20, 0.3)',
          hoverStroke: '#fbbf24',
          activeStroke: '#fbbf24'
        };
      }
      if (tagType === 'custom') {
        return {
          glow: '#38bdf8',
          glowFill: 'rgba(56, 189, 248, 0.28)',
          highlight: 'rgba(220, 248, 255, 0.35)',
          mid: 'rgba(130, 215, 245, 0.38)',
          hoverMid: 'rgba(150, 228, 255, 0.44)',
          activeMid: 'rgba(170, 238, 255, 0.5)',
          deep: 'rgba(28, 96, 126, 0.35)',
          edge: 'rgba(15, 50, 70, 0.22)',
          stroke: 'rgba(200, 245, 255, 0.45)',
          rimLight: 'rgba(255, 255, 255, 0.7)',
          rimDark: 'rgba(20, 80, 110, 0.35)',
          hoverStroke: 'rgba(175, 235, 255, 0.65)',
          activeStroke: '#44c8ff'
        };
      }
      return {
        glow: '#a78bfa',
        glowFill: 'rgba(139, 92, 246, 0.3)',
        highlight: 'rgba(240, 234, 255, 0.35)',
        mid: 'rgba(170, 145, 240, 0.38)',
        hoverMid: 'rgba(185, 165, 250, 0.44)',
        activeMid: 'rgba(200, 185, 255, 0.5)',
        deep: 'rgba(78, 48, 150, 0.36)',
        edge: 'rgba(40, 25, 70, 0.22)',
        stroke: 'rgba(220, 205, 255, 0.45)',
        rimLight: 'rgba(255, 255, 255, 0.72)',
        rimDark: 'rgba(70, 45, 130, 0.35)',
        hoverStroke: 'rgba(195, 175, 255, 0.65)',
        activeStroke: '#b7a4ff'
      };
    }

    function drawBubble(node) {
      const active = selectedTags.includes(node.tag);
      const hovered = hoverTag === node.tag;
      const palette = getBubblePalette(node.tagType);
      const midTone = active ? palette.activeMid : hovered ? palette.hoverMid : palette.mid;
      const shadowAlpha = active ? 0.2 : hovered ? 0.16 : 0.12;
      const shadowBlur = active ? 16 : hovered ? 12 : 10;
      const shadowOffset = active ? 4 : hovered ? 3 : 2;
      
      // Draw glow effect for selected bubbles
      if (active) {
        ctx.save();
        ctx.shadowColor = palette.glow;
        ctx.shadowBlur = 20;
        ctx.beginPath();
        ctx.arc(node.x, node.y, node.radius, 0, Math.PI * 2);
        ctx.fillStyle = palette.glowFill;
        ctx.fill();
        ctx.restore();
      }
      
      ctx.save();
      ctx.shadowColor = 'rgba(0, 0, 0, ' + shadowAlpha + ')';
      ctx.shadowBlur = shadowBlur;
      ctx.shadowOffsetY = shadowOffset;
      ctx.beginPath();
      ctx.arc(node.x, node.y, node.radius, 0, Math.PI * 2);
      ctx.fillStyle = midTone;
      ctx.fill();
      ctx.restore();
      
      // Thicker border for selected
      ctx.lineWidth = active ? 3.2 : (hovered ? 2 : 1.4);
      if (active) {
        ctx.strokeStyle = palette.activeStroke;
      } else if (hovered) {
        ctx.strokeStyle = palette.hoverStroke;
      } else {
        ctx.strokeStyle = palette.stroke;
      }
      ctx.stroke();

      const label = node.tag.length > 14 ? node.tag.slice(0, 12) + '…' : node.tag;
      const labelSize = Math.max(10, Math.min(18, node.radius * 0.28));
      const countSize = Math.max(9, Math.min(16, node.radius * 0.22));
      ctx.fillStyle = '#f7f4ff';
      ctx.font =
        "600 " + labelSize + 'px "Avenir Next", "PingFang SC", sans-serif';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(label, node.x, node.y - node.radius * 0.12);
      ctx.fillStyle = 'rgba(247, 244, 255, 0.7)';
      ctx.font =
        "500 " + countSize + 'px "Avenir Next", "PingFang SC", sans-serif';
      ctx.fillText(String(node.count), node.x, node.y + node.radius * 0.18);
    }

    function draw() {
      rafId = 0;
      ctx.clearRect(0, 0, canvasWidth, canvasHeight);
      if (!layout || !layout.nodes.length) {
        emptyHint.style.display = 'flex';
        return;
      }
      emptyHint.style.display = 'none';
      ctx.save();
      ctx.translate(view.offsetX, view.offsetY);
      ctx.scale(view.scale, view.scale);
      layout.nodes.forEach(drawBubble);
      ctx.restore();
    }

    let popupInitialTags = [];
    const popupTagPriority = { semantic: 3, base: 2, custom: 1 };

    function applyTagSelection(tags, focusTagName) {
      const normalized = Array.from(
        new Set((tags || []).map((tag) => String(tag).toLowerCase().trim()).filter(Boolean))
      );
      selectedTags = normalized;
      updateList();
      if (focusTagName) {
        const focus = String(focusTagName).toLowerCase().trim();
        if (focus) {
          focusTag(focus);
        }
      } else if (normalized.length === 1) {
        focusTag(normalized[0]);
      }
    }

    function normalizeTagValue(value) {
      return value.trim().toLowerCase();
    }

    function buildPopupTags(tagGroups) {
      const map = new Map();
      tagGroups.forEach(({ tagType, tags }) => {
        (tags || []).forEach((tag) => {
          const normalized = normalizeTagValue(tag);
          if (!normalized) return;
          const existing = map.get(normalized);
          if (!existing || popupTagPriority[tagType] > popupTagPriority[existing.tagType]) {
            map.set(normalized, { tag: normalized, tagType });
          }
        });
      });
      return Array.from(map.values());
    }

    function buildPopupTagMap(tags) {
      const map = new Map();
      tags.forEach((item) => {
        map.set(item.tag, item.tagType);
      });
      return map;
    }

    function addPopupTag(tag, tagType) {
      const normalized = normalizeTagValue(tag);
      if (!normalized) return;
      const existing = popupSelectedTags.find((item) => item.tag === normalized);
      if (existing) {
        if (popupTagPriority[tagType] > popupTagPriority[existing.tagType]) {
          existing.tagType = tagType;
        }
        return;
      }
      popupSelectedTags.push({ tag: normalized, tagType });
    }

    function setPopupFilter(filter) {
      popupActiveFilter = filter || 'all';
      if (!popupFilterActions) return;
      popupFilterActions
        .querySelectorAll('button')
        .forEach((item) => item.classList.remove('active'));
      const activeButton = popupFilterActions.querySelector(
        '[data-filter="' + popupActiveFilter + '"]'
      );
      if (activeButton) {
        activeButton.classList.add('active');
      }
    }

    function resolveItemTagType(item, tag) {
      if (item.tagsSemantic && item.tagsSemantic.includes(tag)) {
        return 'semantic';
      }
      if (item.tagsBase && item.tagsBase.includes(tag)) {
        return 'base';
      }
      if (item.tagsCustom && item.tagsCustom.includes(tag)) {
        return 'custom';
      }
      const tagNode = tagData.find((n) => n.tag === tag);
      return tagNode ? tagNode.tagType : 'base';
    }

    function updateList() {
      list.innerHTML = '';
      selectedTagsEl.innerHTML = '';
      if (!selectedTags.length) {
        panelMeta.textContent = '请选择一个或多个标签';
        requestRender();
        return;
      }
      selectedTags.forEach((tag) => {
        const chip = document.createElement('span');
        const tagNode = tagData.find((item) => item.tag === tag);
        const tagType = tagNode ? tagNode.tagType : 'base';
        chip.className = 'tag-chip ' + tagType;
        chip.textContent = '#' + tag;
        chip.dataset.tag = tag;
        chip.addEventListener('click', () => removeTag(tag));
        selectedTagsEl.appendChild(chip);
      });

      const allItems = [];
      selectedTags.forEach((tag) => {
        const node = tagData.find((item) => item.tag === tag);
        if (!node) return;
        allItems.push(...node.items);
      });
      const uniqueMap = new Map();
      allItems.forEach((item) => {
        uniqueMap.set(item.id, item);
      });
      const filteredItems = Array.from(uniqueMap.values()).filter((item) =>
        selectedTags.every((tag) => (item.tags || []).includes(tag))
      );
      panelMeta.textContent = filteredItems.length + ' 个符号';

      filteredItems.forEach((item) => {
        const el = document.createElement('div');
        el.className = 'item';
        
        const tagsHtml = (item.tags || [])
          .map((tag) => {
            const tagType = resolveItemTagType(item, tag);
            return '<span class="tag-chip ' + tagType + '" data-tag="' + tag + '">#' + tag + '</span>';
          })
          .join('');
          
        el.innerHTML =
          '<div class="signature">' + item.signature + '</div>' +
          '<div class="brief-container" title="双击编辑">' + (item.brief || '') + '</div>' +
          '<div class="tag-row">' + tagsHtml + '<div class="add-tag-btn" title="管理标签">+</div></div>';
        
        el.addEventListener('click', (e) => {
          if (e.target.closest('.tag-chip') || e.target.closest('.add-tag-btn') || e.target.closest('.edit-box-container') || e.target.closest('input')) return;
          vscode.postMessage({
            type: 'open',
            filePath: item.filePath,
            line: item.line
          });
        });

        const briefEl = el.querySelector('.brief-container');
        briefEl.addEventListener('dblclick', (e) => {
             e.stopPropagation();
             editDescription(item, briefEl);
        });
        
        const addBtn = el.querySelector('.add-tag-btn');
        addBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            showTagPopup(
              item.id,
              item.tagsBase || [],
              item.tagsSemantic || [],
              item.tagsCustom || []
            );
        });

        list.appendChild(el);
      });
      
      wireTagChips(list);
      requestRender();
    }

    function editDescription(item, container) {
      const original = item.brief || '';
      const encoded = original.replace(/"/g, '&quot;');
      
      container.innerHTML = 
        '<div class="edit-box-container">' +
        '<input class="edit-box" value="' + encoded + '" />' +
        '<div class="edit-btns">' +
        '<div class="btn-icon btn-check" title="保存">✓</div>' +
        '<div class="btn-icon btn-cross" title="取消">✕</div>' +
        '</div>' +
        '</div>';
      
      const input = container.querySelector('input');
      const check = container.querySelector('.btn-check');
      const cross = container.querySelector('.btn-cross');
      
      input.focus();
      
      input.addEventListener('click', e => e.stopPropagation());
      input.addEventListener('dblclick', e => e.stopPropagation());
      
      const save = () => {
        const val = input.value.trim();
        if (val !== original) {
           vscode.postMessage({ type: 'updateDescription', symbolId: item.id, description: val });
           item.brief = val; // Optimistic update
           container.textContent = val;
        } else {
           container.textContent = original;
        }
      };
      
      const cancel = () => {
        container.textContent = original;
      };
      
      check.addEventListener('click', (e) => { e.stopPropagation(); save(); });
      cross.addEventListener('click', (e) => { e.stopPropagation(); cancel(); });
      
      input.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') save();
        if (e.key === 'Escape') cancel();
      });
    }

    function showTagPopup(symbolId, tagsBase, tagsSemantic, tagsCustom) {
      popupCurrentSymbolId = symbolId;
      popupInitialTags = buildPopupTags([
        { tagType: 'semantic', tags: tagsSemantic },
        { tagType: 'base', tags: tagsBase },
        { tagType: 'custom', tags: tagsCustom }
      ]);
      popupSelectedTags = [...popupInitialTags];
      
      setPopupFilter('all');
      updatePopupSelected();
      popupSearch.value = '';
      updatePopupList('');
      tagPopupOverlay.classList.add('active');
      popupSearch.focus();
    }

    function hideTagPopup() {
      tagPopupOverlay.classList.remove('active');
      popupCurrentSymbolId = null;
    }

    function updatePopupSelected() {
      popupTagsSelected.innerHTML = '';
      popupSelectedTags.forEach((entry) => {
        const tag = entry.tag;
        const tagNode = tagData.find((n) => n.tag === tag);
        const tagType = entry.tagType || (tagNode ? tagNode.tagType : 'custom');
        const chip = document.createElement('span');
        chip.className = 'tag-chip ' + tagType;
        chip.textContent = '#' + tag;
        chip.style.margin = '2px';
        chip.style.cursor = 'pointer';
        chip.title = '点击删除';
        chip.addEventListener('click', () => {
          popupSelectedTags = popupSelectedTags.filter((item) => item.tag !== tag);
          updatePopupSelected();
        });
        popupTagsSelected.appendChild(chip);
      });
    }

    function updatePopupList(query) {
       popupList.innerHTML = '';
       const q = query.trim().toLowerCase();
       // Filter tagData unique tags
       const pool =
         popupActiveFilter === 'all'
           ? tagData
           : tagData.filter((item) => item.tagType === popupActiveFilter);
       const matches = pool
           .filter(n => n.tag.includes(q))
           .sort((a, b) => b.count - a.count)
           .slice(0, 20);
       
       matches.forEach(node => {
         const el = document.createElement('div');
         el.className = 'popup-item';
         el.innerHTML = '<span>' + node.tag + '</span><span>' + node.count + '</span>';
         el.addEventListener('click', () => {
           addPopupTag(node.tag, node.tagType || 'base');
           updatePopupSelected();
         });
         popupList.appendChild(el);
       });
    }

    popupCancel.addEventListener('click', hideTagPopup);
    
    popupSave.addEventListener('click', () => {
       if (!popupCurrentSymbolId) return;
       const oldTags = popupInitialTags;
       const newTags = popupSelectedTags;
       const oldMap = buildPopupTagMap(oldTags);
       const newMap = buildPopupTagMap(newTags);
       
       const toAdd = [];
       const toRemove = [];
       newMap.forEach((tagType, tag) => {
         if (!oldMap.has(tag)) {
           toAdd.push({ tag, tagType });
           return;
         }
         const oldType = oldMap.get(tag);
         if (oldType !== tagType) {
           toRemove.push({ tag, tagType: oldType });
           toAdd.push({ tag, tagType });
         }
       });
       oldMap.forEach((tagType, tag) => {
         if (!newMap.has(tag)) {
           toRemove.push({ tag, tagType });
         }
       });
       
       // Send single batched message to prevent race conditions
       if (toAdd.length > 0 || toRemove.length > 0) {
         vscode.postMessage({
           type: 'updateSymbolTags',
           symbolId: popupCurrentSymbolId,
           tagsToAdd: toAdd,
           tagsToRemove: toRemove
         });
       }
       
       hideTagPopup();
    });

    popupSearch.addEventListener('input', (e) => {
       updatePopupList(e.target.value);
    });

    if (popupFilterActions) {
      popupFilterActions.querySelectorAll('button').forEach((btn) => {
        btn.addEventListener('click', () => {
          setPopupFilter(btn.dataset.filter || 'all');
          updatePopupList(popupSearch.value || '');
        });
      });
    }

    popupAddNew.addEventListener('click', () => {
       const val = normalizeTagValue(popupSearch.value || '');
       if (!val) {
         return;
       }
       const existing = tagData.find((item) => item.tag === val);
       const tagType = existing ? existing.tagType : 'custom';
       addPopupTag(val, tagType);
       updatePopupSelected();
       popupSearch.value = '';
       updatePopupList('');
    });

    function wireTagChips(container) {
      container.querySelectorAll('.tag-chip').forEach((chip) => {
        chip.addEventListener('click', (event) => {
          event.stopPropagation();
          const tag = chip.getAttribute('data-tag');
          if (!tag) return;
          addTag(tag);
        });
      });
    }

    function toggleTag(tag) {
      if (selectedTags.includes(tag)) {
        removeTag(tag);
        return;
      }
      addTag(tag);
    }

    function addTag(tag) {
      if (!selectedTags.includes(tag)) {
        selectedTags = [...selectedTags, tag];
      }
      updateList();
      focusTag(tag);
    }

    function removeTag(tag) {
      selectedTags = selectedTags.filter((item) => item !== tag);
      updateList();
    }

    function focusTag(tag) {
      if (!layout) return;
      const node = layout.map.get(tag);
      if (!node) return;
      view.offsetX = canvasWidth / 2 - node.x * view.scale;
      view.offsetY = canvasHeight / 2 - node.y * view.scale;
      requestRender();
    }

    function zoomAt(clientX, clientY, nextScale) {
      const rect = canvas.getBoundingClientRect();
      const px = clientX - rect.left;
      const py = clientY - rect.top;
      const worldX = (px - view.offsetX) / view.scale;
      const worldY = (py - view.offsetY) / view.scale;
      view.scale = nextScale;
      view.offsetX = px - worldX * view.scale;
      view.offsetY = py - worldY * view.scale;
      requestRender();
    }

    function updateSuggestions(value) {
      const query = value.trim().toLowerCase();
      suggestions.innerHTML = '';
      suggestionIndex = -1;
      suggestionItems = [];
      if (!query) {
        suggestions.classList.remove('active');
        return;
      }
      const pool = getFilteredTags();
      const matches = pool.filter((item) => item.tag.includes(query)).slice(0, 8);
      if (!matches.length) {
        suggestions.classList.remove('active');
        return;
      }
      matches.forEach((node) => {
        const el = document.createElement('div');
        el.className = 'suggestion';
        el.innerHTML = '<span>' + node.tag + '</span><span>' + node.count + '</span>';
        el.addEventListener('click', () => {
          addTag(node.tag);
          searchInput.value = '';
          suggestions.classList.remove('active');
        });
        suggestions.appendChild(el);
        suggestionItems.push({ node, el });
      });
      suggestions.classList.add('active');
    }

    function highlightSuggestion(index) {
      suggestionItems.forEach((item, i) => {
        if (i === index) {
          item.el.classList.add('active');
          item.el.scrollIntoView({ block: 'nearest' });
        } else {
          item.el.classList.remove('active');
        }
      });
    }

    window.addEventListener('message', (event) => {
      const message = event.data;
      if (message.type === 'data') {
        tagData = message.tags || [];
        buildLayout();
        if (!message.skipList) {
          updateList();
        }
        updateSuggestions(searchInput.value || '');
        if (pendingSelection) {
          applyTagSelection(pendingSelection.tags || [], pendingSelection.focusTag);
          pendingSelection = null;
        }
      }
      if (message.type === 'selectTags') {
        const tags = message.tags || [];
        const focusTagName = message.focusTag || tags[0];
        if (!tagData.length) {
          pendingSelection = { tags, focusTag: focusTagName };
          return;
        }
        applyTagSelection(tags, focusTagName);
      }
      if (message.type === 'status') {
        panelMeta.textContent = message.text || '';
      }
    });

    searchInput.addEventListener('input', (event) => {
      updateSuggestions(event.target.value || '');
    });

    searchInput.addEventListener('keydown', (event) => {
      if (event.key === 'ArrowDown') {
        if (!suggestionItems.length) return;
        event.preventDefault();
        suggestionIndex = Math.min(suggestionIndex + 1, suggestionItems.length - 1);
        highlightSuggestion(suggestionIndex);
        return;
      }
      if (event.key === 'ArrowUp') {
        if (!suggestionItems.length) return;
        event.preventDefault();
        suggestionIndex = Math.max(suggestionIndex - 1, 0);
        highlightSuggestion(suggestionIndex);
        return;
      }
      if (event.key === 'Enter' && searchInput.value.trim()) {
        if (suggestionIndex >= 0 && suggestionItems[suggestionIndex]) {
          const pick = suggestionItems[suggestionIndex].node;
          addTag(pick.tag);
        } else {
          const value = searchInput.value.trim().toLowerCase();
          const node = getFilteredTags().find((item) => item.tag === value);
          if (node) {
            addTag(node.tag);
          }
        }
        searchInput.value = '';
        suggestions.classList.remove('active');
      }
    });

    filterActions.querySelectorAll('button').forEach((btn) => {
      btn.addEventListener('click', () => {
        filterActions.querySelectorAll('button').forEach((item) => item.classList.remove('active'));
        btn.classList.add('active');
        activeFilter = btn.dataset.filter || 'all';
        buildLayout();
        updateSuggestions(searchInput.value || '');
      });
    });

    refreshBtn.addEventListener('click', () => {
      vscode.postMessage({ type: 'refreshIndex' });
    });

    canvas.addEventListener('pointerdown', (event) => {
      canvas.setPointerCapture(event.pointerId);
      pointers.set(event.pointerId, { x: event.clientX, y: event.clientY });
      dragged = false;
      if (pointers.size === 2) {
        const values = Array.from(pointers.values());
        pinchStart = {
          distance: Math.hypot(values[0].x - values[1].x, values[0].y - values[1].y),
          scale: view.scale
        };
        return;
      }
      const hit = findNodeAt(event.clientX, event.clientY);
      pressedTag = hit ? hit.tag : null;
      if (!pressedTag) {
        isPanning = true;
        canvas.classList.add('panning');
        dragStart = {
          x: event.clientX,
          y: event.clientY,
          offsetX: view.offsetX,
          offsetY: view.offsetY
        };
      }
    });

    canvas.addEventListener('pointermove', (event) => {
      if (pointers.has(event.pointerId)) {
        pointers.set(event.pointerId, { x: event.clientX, y: event.clientY });
      }
      if (pinchStart && pointers.size === 2) {
        const values = Array.from(pointers.values());
        const nextDistance = Math.hypot(values[0].x - values[1].x, values[0].y - values[1].y);
        if (pinchStart.distance > 0) {
          const ratio = nextDistance / pinchStart.distance;
          const boosted = Math.pow(ratio, 1.35);
          const nextScale = Math.min(6.0, Math.max(0.08, pinchStart.scale * boosted));
          const centerX = (values[0].x + values[1].x) / 2;
          const centerY = (values[0].y + values[1].y) / 2;
          zoomAt(centerX, centerY, nextScale);
        }
        return;
      }
      if (isPanning && dragStart) {
        const dx = event.clientX - dragStart.x;
        const dy = event.clientY - dragStart.y;
        const panBoost = 1.35;
        view.offsetX = dragStart.offsetX + dx * panBoost;
        view.offsetY = dragStart.offsetY + dy * panBoost;
        dragged = true;
        requestRender();
        return;
      }
      if (event.pointerType === 'mouse') {
        const hit = findNodeAt(event.clientX, event.clientY);
        const nextTag = hit ? hit.tag : null;
        if (nextTag !== hoverTag) {
          hoverTag = nextTag;
          requestRender();
        }
      }
    });

    canvas.addEventListener('pointerup', (event) => {
      pointers.delete(event.pointerId);
      if (pinchStart && pointers.size < 2) {
        pinchStart = null;
      }
      if (isPanning) {
        isPanning = false;
        canvas.classList.remove('panning');
      }
      if (pressedTag && !dragged) {
        toggleTag(pressedTag);
      }
      pressedTag = null;
      dragStart = null;
    });

    canvas.addEventListener('pointercancel', () => {
      pointers.clear();
      pinchStart = null;
      isPanning = false;
      pressedTag = null;
      dragStart = null;
      canvas.classList.remove('panning');
    });

    canvas.addEventListener('wheel', (event) => {
      if (!event.ctrlKey && !event.metaKey) {
        return;
      }
      event.preventDefault();
      const delta = Math.max(-1.2, Math.min(1.2, -event.deltaY * 0.02));
      const nextScale = Math.min(6.0, Math.max(0.08, view.scale * (1 + delta)));
      zoomAt(event.clientX, event.clientY, nextScale);
    }, { passive: false });

    window.addEventListener('resize', resizeCanvas);
    resizeCanvas();
  </script>
</body>
</html>`;
}
class TagGraphViewProvider {
    constructor(context) {
        this.context = context;
    }
    async resolveWebviewView(view) {
        this.view = view;
        view.webview.options = { enableScripts: true };
        view.webview.html = getTagGraphHtml();
        view.webview.onDidReceiveMessage(async (message) => {
            if (message.type === "refresh") {
                await this.postData();
            }
            if (message.type === "refreshIndex") {
                await vscode.commands.executeCommand("semanticRoute.updateIndex");
                await this.postData();
            }
            if (message.type === "open") {
                await this.openLocation(message.filePath, message.line);
            }
            // New handlers
            if (message.type === "updateDescription") {
                const root = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
                if (root) {
                    const indexRoot = await resolveIndexRoot(root);
                    if (indexRoot) {
                        await core.updateSymbolDescription(indexRoot, message.symbolId, message.description);
                        // Refresh layout but skip list update to preserve scroll/state
                        await this.postData(true);
                    }
                }
            }
            // Batched tag update to prevent race conditions
            if (message.type === "updateSymbolTags") {
                const root = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
                if (root) {
                    const indexRoot = await resolveIndexRoot(root);
                    if (indexRoot) {
                        await core.updateSymbolTags(indexRoot, message.symbolId, message.tagsToAdd || [], message.tagsToRemove || []);
                        await this.postData();
                    }
                }
            }
        });
        view.onDidChangeVisibility(() => {
            if (view.visible) {
                this.postData();
            }
        });
        await this.postData();
        if (this.pendingSelection) {
            const selection = this.pendingSelection;
            this.pendingSelection = undefined;
            this.view?.webview.postMessage({
                type: "selectTags",
                tags: selection.tags,
                focusTag: selection.focusTag
            });
        }
    }
    reveal() {
        if (this.view?.show) {
            this.view.show?.(true);
        }
    }
    async selectTags(tags, focusTag) {
        if (!tags.length) {
            return;
        }
        if (!this.view) {
            this.pendingSelection = { tags, focusTag };
            try {
                await vscode.commands.executeCommand("semanticRoute.tagGraph.focus");
            }
            catch {
                // ignore focus errors; pending selection will apply on next view open
            }
            return;
        }
        this.reveal();
        await this.postData();
        this.view.webview.postMessage({ type: "selectTags", tags, focusTag });
    }
    async postData(skipList = false) {
        const root = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
        if (!root) {
            this.view?.webview.postMessage({
                type: "status",
                text: "未找到工作区目录。"
            });
            return;
        }
        const indexRoot = await resolveIndexRoot(root);
        if (!indexRoot) {
            this.view?.webview.postMessage({
                type: "status",
                text: "未找到索引目录，请先运行 Build/Update Index。"
            });
            return;
        }
        const tags = await buildTagGraphData(indexRoot);
        this.view?.webview.postMessage({ type: "data", tags, skipList });
    }
    async openLocation(filePath, line) {
        const root = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
        if (!root || !filePath) {
            return;
        }
        const targetPath = path_1.default.join(root, filePath);
        try {
            const doc = await vscode.workspace.openTextDocument(targetPath);
            const editor = await vscode.window.showTextDocument(doc, { preview: true });
            const lineIndex = line ? Math.max(0, line - 1) : 0;
            const position = new vscode.Position(lineIndex, 0);
            editor.selection = new vscode.Selection(position, position);
            editor.revealRange(new vscode.Range(position, position));
        }
        catch {
            vscode.window.showErrorMessage("Semantic Route: 无法打开目标文件。");
        }
    }
}
async function getProfiles(config) {
    const profiles = config.get("llm.profiles", []);
    return Array.isArray(profiles) ? profiles : [];
}
function resolveActiveProfile(profiles, activeId) {
    if (activeId) {
        const matched = profiles.find((profile) => profile.id === activeId);
        if (matched) {
            return matched;
        }
    }
    return profiles.length > 0 ? profiles[0] : undefined;
}
async function applyLlmEnv(context) {
    const config = vscode.workspace.getConfiguration(CONFIG_SECTION);
    const enabled = config.get("llm.enabled", true);
    const profiles = await getProfiles(config);
    const activeProfileId = config.get("llm.activeProfile") || "";
    const activeProfile = resolveActiveProfile(profiles, activeProfileId);
    const provider = activeProfile?.provider || config.get("llm.provider") || "";
    const model = activeProfile?.model || config.get("llm.model") || "";
    const baseUrl = activeProfile?.baseUrl || config.get("llm.baseUrl") || "";
    const systemPrompt = activeProfile?.systemPrompt || config.get("llm.systemPrompt") || "";
    const userPrompt = activeProfile?.userPrompt || config.get("llm.userPrompt") || "";
    const apiKey = activeProfile
        ? (await context.secrets.get(getProfileSecretKey(activeProfile.id))) || ""
        : (await context.secrets.get(SECRET_KEY)) || "";
    if (!enabled || !provider) {
        delete process.env.SRCA_LLM_PROVIDER;
        delete process.env.SRCA_LLM_MODEL;
        delete process.env.SRCA_LLM_API_KEY;
        delete process.env.SRCA_LLM_BASE_URL;
        delete process.env.SRCA_LLM_SYSTEM_PROMPT;
        delete process.env.SRCA_LLM_USER_PROMPT;
        return;
    }
    if (!apiKey) {
        const profileLabel = activeProfile?.label ? `（${activeProfile.label}）` : "";
        vscode.window.showWarningMessage(`Semantic Route: 未配置 LLM Token${profileLabel}，请先运行 Configure LLM。`);
        delete process.env.SRCA_LLM_PROVIDER;
        delete process.env.SRCA_LLM_MODEL;
        delete process.env.SRCA_LLM_API_KEY;
        delete process.env.SRCA_LLM_BASE_URL;
        delete process.env.SRCA_LLM_SYSTEM_PROMPT;
        delete process.env.SRCA_LLM_USER_PROMPT;
        return;
    }
    process.env.SRCA_LLM_PROVIDER = provider;
    if (model) {
        process.env.SRCA_LLM_MODEL = model;
    }
    if (apiKey) {
        process.env.SRCA_LLM_API_KEY = apiKey;
    }
    if (baseUrl) {
        process.env.SRCA_LLM_BASE_URL = baseUrl;
    }
    if (systemPrompt) {
        process.env.SRCA_LLM_SYSTEM_PROMPT = systemPrompt;
    }
    else {
        delete process.env.SRCA_LLM_SYSTEM_PROMPT;
    }
    if (userPrompt) {
        process.env.SRCA_LLM_USER_PROMPT = userPrompt;
    }
    else {
        delete process.env.SRCA_LLM_USER_PROMPT;
    }
}
async function promptModel(provider, currentModel) {
    const presets = MODEL_PRESETS[provider] || [];
    const items = [...presets];
    if (currentModel && !items.includes(currentModel)) {
        items.unshift(currentModel);
    }
    items.push("自定义...");
    const pick = await vscode.window.showQuickPick(items, {
        placeHolder: "选择模型"
    });
    if (!pick) {
        return null;
    }
    if (pick === "自定义...") {
        const custom = await vscode.window.showInputBox({
            prompt: "输入模型名称",
            ignoreFocusOut: true
        });
        return custom ? custom.trim() : null;
    }
    return pick;
}
async function promptProfileInfo(context, base) {
    const label = await vscode.window.showInputBox({
        prompt: base ? "编辑配置名称" : "输入配置名称",
        value: base?.label || "",
        ignoreFocusOut: true
    });
    if (!label) {
        return null;
    }
    const providerPick = await vscode.window.showQuickPick(PROFILE_PROVIDERS, {
        placeHolder: "选择 LLM 提供方"
    });
    if (!providerPick) {
        return null;
    }
    const modelPick = await promptModel(providerPick, base?.model);
    if (!modelPick) {
        return null;
    }
    let apiKey;
    const apiPrompt = base ? `输入 ${providerPick} API Key（留空保持不变）` : `请输入 ${providerPick} API Key`;
    const apiKeyInput = await vscode.window.showInputBox({
        prompt: apiPrompt,
        password: true,
        ignoreFocusOut: true
    });
    if (!base && !apiKeyInput) {
        return null;
    }
    if (apiKeyInput) {
        apiKey = apiKeyInput;
    }
    const baseUrl = await vscode.window.showInputBox({
        prompt: `可选：${providerPick} 的 API Base URL`,
        placeHolder: "留空使用默认接口",
        value: base?.baseUrl || "",
        ignoreFocusOut: true
    });
    const systemPrompt = await vscode.window.showInputBox({
        prompt: "可选：System Prompt（留空使用默认）",
        value: base?.systemPrompt || "",
        ignoreFocusOut: true
    });
    const userPrompt = await vscode.window.showInputBox({
        prompt: "可选：User Prompt 模板（支持 {{moduleName}}/{{signature}}/{{implementation}}）",
        value: base?.userPrompt || "",
        ignoreFocusOut: true
    });
    const id = base?.id || sanitizeProfileId(label);
    const profile = {
        id,
        label,
        provider: providerPick,
        model: modelPick,
        baseUrl: baseUrl || "",
        systemPrompt: systemPrompt || "",
        userPrompt: userPrompt || ""
    };
    if (apiKey) {
        await context.secrets.store(getProfileSecretKey(id), apiKey);
    }
    return { profile, apiKey };
}
async function configureLlm(context) {
    const config = vscode.workspace.getConfiguration(CONFIG_SECTION);
    const profiles = await getProfiles(config);
    if (profiles.length === 0) {
        await config.update("llm.enabled", false, vscode.ConfigurationTarget.Global);
        await config.update("llm.activeProfile", "", vscode.ConfigurationTarget.Global);
    }
    const items = profiles.map((profile) => ({
        label: profile.label,
        description: `${profile.provider}${profile.model ? ` / ${profile.model}` : ""}`,
        detail: profile.id,
        id: profile.id
    }));
    items.push({ label: "禁用 LLM", description: "", detail: "", id: "__disable__" });
    items.push({ label: "新建配置", description: "", detail: "", id: "__new__" });
    const picked = await vscode.window.showQuickPick(items, {
        placeHolder: "选择或新建 LLM 配置"
    });
    if (!picked) {
        return;
    }
    if (picked.id === "__disable__") {
        await config.update("llm.enabled", false, vscode.ConfigurationTarget.Global);
        vscode.window.showInformationMessage("Semantic Route: 已禁用 LLM。");
        return;
    }
    if (picked.id === "__new__") {
        const result = await promptProfileInfo(context);
        if (!result) {
            return;
        }
        const nextProfiles = [...profiles, result.profile];
        await config.update("llm.profiles", nextProfiles, vscode.ConfigurationTarget.Global);
        await config.update("llm.activeProfile", result.profile.id, vscode.ConfigurationTarget.Global);
        await config.update("llm.enabled", true, vscode.ConfigurationTarget.Global);
        vscode.window.showInformationMessage(`Semantic Route: 已新增并启用配置 ${result.profile.label}。`);
        return;
    }
    const selected = profiles.find((profile) => profile.id === picked.id);
    if (!selected) {
        return;
    }
    const action = await vscode.window.showQuickPick(["使用此配置", "编辑配置", "删除配置"], {
        placeHolder: `当前选择：${selected.label}`
    });
    if (!action) {
        return;
    }
    if (action === "使用此配置") {
        await config.update("llm.activeProfile", selected.id, vscode.ConfigurationTarget.Global);
        await config.update("llm.enabled", true, vscode.ConfigurationTarget.Global);
        vscode.window.showInformationMessage(`Semantic Route: 已切换到 ${selected.label}。`);
        return;
    }
    if (action === "删除配置") {
        const nextProfiles = profiles.filter((profile) => profile.id !== selected.id);
        await config.update("llm.profiles", nextProfiles, vscode.ConfigurationTarget.Global);
        const activeId = config.get("llm.activeProfile") || "";
        if (activeId === selected.id) {
            await config.update("llm.activeProfile", nextProfiles[0]?.id || "", vscode.ConfigurationTarget.Global);
        }
        await context.secrets.delete(getProfileSecretKey(selected.id));
        vscode.window.showInformationMessage(`Semantic Route: 已删除配置 ${selected.label}。`);
        return;
    }
    const edited = await promptProfileInfo(context, selected);
    if (!edited) {
        return;
    }
    const nextProfiles = profiles.map((profile) => profile.id === selected.id ? edited.profile : profile);
    await config.update("llm.profiles", nextProfiles, vscode.ConfigurationTarget.Global);
    await config.update("llm.activeProfile", edited.profile.id, vscode.ConfigurationTarget.Global);
    await config.update("llm.enabled", true, vscode.ConfigurationTarget.Global);
    vscode.window.showInformationMessage(`Semantic Route: 已更新配置 ${edited.profile.label}。`);
}
function activate(context) {
    const tagGraphProvider = new TagGraphViewProvider(context);
    context.subscriptions.push(vscode.window.registerWebviewViewProvider("semanticRoute.tagGraph", tagGraphProvider));
    const configureCmd = vscode.commands.registerCommand("semanticRoute.configureLLM", async () => {
        await configureLlm(context);
    });
    const buildCmd = vscode.commands.registerCommand("semanticRoute.buildIndex", async () => {
        const folders = vscode.workspace.workspaceFolders;
        if (!folders || folders.length === 0) {
            vscode.window.showErrorMessage("Semantic Route: 未找到工作区目录。");
            return;
        }
        const projectRoot = folders[0].uri.fsPath;
        const config = vscode.workspace.getConfiguration(CONFIG_SECTION);
        const briefConcurrency = config.get("llm.briefConcurrency", 4);
        const buildV3 = core.buildModuleIndexV3;
        if (!buildV3) {
            vscode.window.showErrorMessage("Semantic Route: 未找到 V3 构建函数。");
            return;
        }
        const outDir = path_1.default.join(projectRoot, ".ai_context");
        const modulesDir = path_1.default.join(outDir, "modules");
        const hasIndex = await hasModuleIndex(outDir);
        if (!hasIndex) {
            vscode.window.showInformationMessage("Semantic Route: 索引为空，改为执行构建。");
        }
        const beforeSnapshot = await snapshotModuleFiles(modulesDir);
        await vscode.window.withProgress({
            location: vscode.ProgressLocation.Notification,
            title: "Semantic Route: 正在构建索引...",
            cancellable: false
        }, async (progress) => {
            progress.report({ message: "准备环境..." });
            await applyLlmEnv(context);
            progress.report({ message: "准备环境..." });
            await applyLlmEnv(context);
            // Configure skills generation (Removed)
            progress.report({ message: "正在生成模块索引..." });
            await buildV3(projectRoot, outDir, {
                briefConcurrency,
                onProgress: (info) => {
                    const relativePath = info.filePath
                        ? path_1.default.relative(projectRoot, info.filePath)
                        : "";
                    const detail = relativePath ? ` ${relativePath}` : "";
                    progress.report({
                        message: `处理中 ${info.current}/${info.total}${detail}`
                    });
                },
                onBriefProgress: (info) => {
                    progress.report({
                        message: `生成 brief ${info.current}/${info.total}`
                    });
                }
            });
            progress.report({ message: "正在聚类模块..." });
        });
        const afterSnapshot = await snapshotModuleFiles(modulesDir);
        const { created, updated } = diffModuleSnapshots(beforeSnapshot, afterSnapshot);
        reportModuleChanges("构建", projectRoot, created, updated);
        vscode.window.showInformationMessage(`Semantic Route: 索引构建完成。新增 ${created.length}，更新 ${updated.length}。`);
    });
    const updateCmd = vscode.commands.registerCommand("semanticRoute.updateIndex", async () => {
        const folders = vscode.workspace.workspaceFolders;
        if (!folders || folders.length === 0) {
            vscode.window.showErrorMessage("Semantic Route: 未找到工作区目录。");
            return;
        }
        const projectRoot = folders[0].uri.fsPath;
        const config = vscode.workspace.getConfiguration(CONFIG_SECTION);
        const briefConcurrency = config.get("llm.briefConcurrency", 4);
        const updateV3 = core.updateModuleIndexV3;
        if (!updateV3) {
            vscode.window.showErrorMessage("Semantic Route: 未找到 V3 更新函数。");
            return;
        }
        const outDir = path_1.default.join(projectRoot, ".ai_context");
        const modulesDir = path_1.default.join(outDir, "modules");
        const beforeSnapshot = await snapshotModuleFiles(modulesDir);
        await vscode.window.withProgress({
            location: vscode.ProgressLocation.Notification,
            title: "Semantic Route: 正在更新索引",
            cancellable: false
        }, async (progress) => {
            progress.report({ message: "准备环境..." });
            await applyLlmEnv(context);
            progress.report({ message: "准备环境..." });
            await applyLlmEnv(context);
            // Configure skills generation (Removed)
            progress.report({ message: "正在生成模块索引..." });
            await updateV3(projectRoot, outDir, {
                briefConcurrency,
                onProgress: (info) => {
                    const relativePath = info.filePath
                        ? path_1.default.relative(projectRoot, info.filePath)
                        : "";
                    const detail = relativePath ? ` ${relativePath}` : "";
                    progress.report({
                        message: `处理中 ${info.current}/${info.total}${detail}`
                    });
                },
                onBriefProgress: (info) => {
                    progress.report({
                        message: `生成 brief ${info.current}/${info.total}`
                    });
                }
            });
            progress.report({ message: "正在聚类模块..." });
        });
        const afterSnapshot = await snapshotModuleFiles(modulesDir);
        const { created, updated } = diffModuleSnapshots(beforeSnapshot, afterSnapshot);
        reportModuleChanges("更新", projectRoot, created, updated);
        vscode.window.showInformationMessage(`Semantic Route: 索引更新完成。新增 ${created.length}，更新 ${updated.length}。`);
    });
    const searchCmd = vscode.commands.registerCommand("semanticRoute.searchSkills", async () => {
        const root = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
        if (!root) {
            vscode.window.showErrorMessage("Semantic Route: 未找到工作区目录。");
            return;
        }
        const indexRoot = await resolveIndexRoot(root);
        if (!indexRoot) {
            vscode.window.showErrorMessage("Semantic Route: 未找到索引目录，请先运行 Build/Update Index。");
            return;
        }
        const activeEditor = vscode.window.activeTextEditor;
        const selectionText = getSelectedText(activeEditor);
        const query = await vscode.window.showInputBox({
            prompt: "搜索 Skill Blocks",
            value: selectionText || undefined,
            placeHolder: "输入关键词进行搜索"
        });
        if (!query) {
            return;
        }
        const routingPath = path_1.default.join(indexRoot, "routing.json");
        let hasRouting = false;
        try {
            await (0, promises_1.access)(routingPath, fs_1.constants.R_OK);
            hasRouting = true;
        }
        catch {
            hasRouting = false;
        }
        if (hasRouting) {
            const results = await searchSkillsV2(indexRoot, query);
            if (!results.length) {
                vscode.window.showInformationMessage("Semantic Route: 没有搜索到结果。");
                return;
            }
            const pickItems = results.map((item) => ({
                label: item.signature,
                description: item.filePath ? `[${item.module}] ${item.filePath}` : item.module,
                detail: item.tags.length > 0
                    ? `tags: [${item.tags.join(", ")}] — ${item.brief}`
                    : item.brief,
                id: item.id,
                signature: item.signature,
                brief: item.brief
            }));
            const picked = await vscode.window.showQuickPick(pickItems, {
                canPickMany: true,
                placeHolder: "选择要包含的 API"
            });
            if (!picked || picked.length === 0) {
                return;
            }
            const codeSnippet = getCodeSnippet(activeEditor);
            const assembled = buildApiPrompt(picked.map((item) => ({ signature: item.signature, brief: item.brief })), codeSnippet);
            const doc = await vscode.workspace.openTextDocument({
                content: assembled,
                language: "markdown"
            });
            await vscode.window.showTextDocument(doc);
            return;
        }
        const results = await core.searchSkills(indexRoot, query);
        if (!results.length) {
            vscode.window.showInformationMessage("Semantic Route: 没有搜索到结果。");
            return;
        }
        const pickItems = results.map((item) => ({
            label: item.title,
            description: item.path,
            detail: item.preview,
            path: item.path
        }));
        const picked = await vscode.window.showQuickPick(pickItems, {
            canPickMany: true,
            placeHolder: "选择要包含的 Skill Blocks"
        });
        if (!picked || picked.length === 0) {
            return;
        }
        const mdContents = [];
        for (const item of picked) {
            const skillPath = path_1.default.join(indexRoot, item.path);
            const content = await (0, promises_1.readFile)(skillPath, "utf8");
            mdContents.push(`--- skill: ${item.path} ---\n${content}`);
        }
        const codeSnippet = getCodeSnippet(activeEditor);
        const assembled = [
            "# Skill Blocks",
            "",
            ...mdContents,
            "",
            "# 当前代码片段",
            "",
            "```cpp",
            codeSnippet,
            "```",
            "",
            "# 任务说明（TODO）",
            "",
            "请先阅读上面的 Skill 文档，理解项目中已有的工具函数和约定，然后根据“任务说明”部分的描述进行修改或扩展代码。"
        ].join("\n");
        const doc = await vscode.workspace.openTextDocument({
            content: assembled,
            language: "markdown"
        });
        await vscode.window.showTextDocument(doc);
    });
    const autoSkillsDocCmd = vscode.commands.registerCommand("semanticRoute.autoSkillsDoc", async () => {
        const root = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
        if (!root) {
            vscode.window.showErrorMessage("Semantic Route: 未找到工作区目录。");
            return;
        }
        const indexRoot = await resolveIndexRoot(root);
        if (!indexRoot) {
            vscode.window.showErrorMessage("Semantic Route: 未找到索引目录，请先运行 Build/Update Index。");
            return;
        }
        const routingPath = path_1.default.join(indexRoot, "routing.json");
        try {
            await (0, promises_1.access)(routingPath, fs_1.constants.R_OK);
        }
        catch {
            vscode.window.showErrorMessage("Semantic Route: 未找到 routing.json，请先运行 Build/Update Index。");
            return;
        }
        const editor = vscode.window.activeTextEditor;
        const query = getAutoQuery(editor);
        if (!query) {
            vscode.window.showErrorMessage("Semantic Route: 未找到可用于检索的内容。");
            return;
        }
        const config = vscode.workspace.getConfiguration(CONFIG_SECTION);
        const topN = Math.max(1, config.get("skills.autoTopN", 8));
        const results = await searchSkillsV2(indexRoot, query);
        if (!results.length) {
            vscode.window.showInformationMessage("Semantic Route: 没有搜索到结果。");
            return;
        }
        const picked = results.slice(0, topN);
        const codeSnippet = getCodeSnippet(editor);
        const assembled = buildApiPrompt(picked.map((item) => ({ signature: item.signature, brief: item.brief })), codeSnippet);
        const doc = await vscode.workspace.openTextDocument({
            content: assembled,
            language: "markdown"
        });
        await vscode.window.showTextDocument(doc);
    });
    const autoSkillsClipboardCmd = vscode.commands.registerCommand("semanticRoute.autoSkillsClipboard", async () => {
        const root = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
        if (!root) {
            vscode.window.showErrorMessage("Semantic Route: 未找到工作区目录。");
            return;
        }
        const indexRoot = await resolveIndexRoot(root);
        if (!indexRoot) {
            vscode.window.showErrorMessage("Semantic Route: 未找到索引目录，请先运行 Build/Update Index。");
            return;
        }
        const routingPath = path_1.default.join(indexRoot, "routing.json");
        try {
            await (0, promises_1.access)(routingPath, fs_1.constants.R_OK);
        }
        catch {
            vscode.window.showErrorMessage("Semantic Route: 未找到 routing.json，请先运行 Build/Update Index。");
            return;
        }
        const editor = vscode.window.activeTextEditor;
        const query = getAutoQuery(editor);
        if (!query) {
            vscode.window.showErrorMessage("Semantic Route: 未找到可用于检索的内容。");
            return;
        }
        const config = vscode.workspace.getConfiguration(CONFIG_SECTION);
        const topN = Math.max(1, config.get("skills.autoTopN", 8));
        const results = await searchSkillsV2(indexRoot, query);
        if (!results.length) {
            vscode.window.showInformationMessage("Semantic Route: 没有搜索到结果。");
            return;
        }
        const picked = results.slice(0, topN);
        const codeSnippet = getCodeSnippet(editor);
        const assembled = buildApiPrompt(picked.map((item) => ({ signature: item.signature, brief: item.brief })), codeSnippet);
        await vscode.env.clipboard.writeText(assembled);
        vscode.window.showInformationMessage(`Semantic Route: 已复制 Auto Skills（${picked.length} 条）。`);
    });
    const revealSymbolCmd = vscode.commands.registerCommand("semanticRoute.revealSymbolAtCursor", async () => {
        const editor = vscode.window.activeTextEditor;
        if (!editor) {
            vscode.window.showErrorMessage("Semantic Route: 未找到活动编辑器。");
            return;
        }
        const workspaceFolder = vscode.workspace.getWorkspaceFolder(editor.document.uri);
        if (!workspaceFolder) {
            vscode.window.showErrorMessage("Semantic Route: 未找到工作区目录。");
            return;
        }
        const projectRoot = workspaceFolder.uri.fsPath;
        const indexRoot = await resolveIndexRoot(projectRoot);
        if (!indexRoot) {
            vscode.window.showErrorMessage("Semantic Route: 未找到索引目录，请先运行 Build/Update Index。");
            return;
        }
        const routing = await loadRouting(indexRoot);
        if (!routing) {
            vscode.window.showErrorMessage("Semantic Route: 索引数据不可用。");
            return;
        }
        const relativePath = normalizeFilePath(path_1.default.relative(projectRoot, editor.document.uri.fsPath));
        const cursorLine = editor.selection.active.line + 1;
        const candidates = Object.entries(routing.symbols)
            .map(([symbolId, info]) => {
            const infoPath = info.filePath ? normalizeFilePath(info.filePath) : "";
            if (!infoPath || infoPath !== relativePath) {
                return null;
            }
            const positions = [info.declLine, info.implLine].filter((line) => typeof line === "number");
            if (!positions.length) {
                return null;
            }
            const distance = Math.min(...positions.map((line) => Math.abs(cursorLine - line)));
            return { symbolId, info, distance };
        })
            .filter((item) => Boolean(item));
        if (!candidates.length) {
            vscode.window.showInformationMessage("Semantic Route: 未匹配到当前光标所在符号。");
            return;
        }
        candidates.sort((a, b) => a.distance - b.distance);
        const target = candidates[0];
        const tags = Array.from(new Set([
            ...(target.info.tagsSemantic || []),
            ...(target.info.tagsBase || []),
            ...(target.info.tagsCustom || []),
            ...(target.info.tags || [])
        ]
            .map((tag) => tag.toLowerCase().trim())
            .filter(Boolean)));
        if (tags.length === 0) {
            vscode.window.showInformationMessage("Semantic Route: 当前符号没有可用标签。");
            return;
        }
        await tagGraphProvider.selectTags(tags, tags[0]);
    });
    const openTagGraphCmd = vscode.commands.registerCommand("semanticRoute.openTagGraph", () => {
        tagGraphProvider.reveal();
    });
    context.subscriptions.push(configureCmd, buildCmd, updateCmd, searchCmd, autoSkillsDocCmd, autoSkillsClipboardCmd, revealSymbolCmd, openTagGraphCmd);
}
function deactivate() {
    // noop
}
//# sourceMappingURL=extension.js.map