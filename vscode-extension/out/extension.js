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
function parseModuleEntries(content) {
    const entries = new Map();
    const lines = content.split("\n");
    const entryRegex = /^\s*-\s+`([^`]+)`\s*<!--\s*id:\s*([^|]+)\s*\|\s*hash:\s*([^\s|]+)(?:\s*\|\s*file:\s*([^|]+))?(?:\s*\|\s*tags:\s*\[([^\]]*)\])?\s*-->/;
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
        const tags = (info.tags || []).map((tag) => tag.toLowerCase());
        const filePath = info.filePath;
        if (tagFilters.length > 0) {
            const allMatch = tagFilters.every((tag) => tags.includes(tag));
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
            if (tags.some((tag) => tag.includes(keyword))) {
                score += 3;
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
                tags,
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
        const beforeSnapshot = await snapshotModuleFiles(modulesDir);
        await vscode.window.withProgress({
            location: vscode.ProgressLocation.Notification,
            title: "Semantic Route: 正在构建索引...",
            cancellable: false
        }, async (progress) => {
            progress.report({ message: "准备环境..." });
            await applyLlmEnv(context);
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
    context.subscriptions.push(configureCmd, buildCmd, updateCmd, searchCmd, autoSkillsDocCmd, autoSkillsClipboardCmd);
}
function deactivate() {
    // noop
}
//# sourceMappingURL=extension.js.map