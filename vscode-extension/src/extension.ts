import * as vscode from "vscode";
import path from "path";
import { readFile, access } from "fs/promises";
import { constants as fsConstants } from "fs";
import * as core from "semantic-route-assistant-core";

type RoutingJson = {
  modules: {
    [moduleName: string]: string;
  };
  symbols: {
    [symbolId: string]: {
      module: string;
      declHash: string;
    };
  };
};

type V2SearchResult = {
  id: string;
  module: string;
  signature: string;
  brief: string;
  score: number;
};

const CONFIG_SECTION = "semanticRoute";
const SECRET_KEY = "semanticRoute.llm.apiKey";

const PROVIDERS = ["openai", "qwen", "gemini", "other", "disable"] as const;

const MODEL_PRESETS: Record<string, string[]> = {
  openai: ["gpt-4o-mini", "gpt-4.1-mini", "gpt-4o"],
  qwen: ["qwen-turbo", "qwen-plus", "qwen-max"],
  gemini: ["gemini-1.5-flash", "gemini-1.5-pro"]
};

function countOccurrences(haystack: string, needle: string): number {
  if (!needle) return 0;
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

function parseModuleEntries(content: string): Map<string, { signature: string; brief: string }> {
  const entries = new Map<string, { signature: string; brief: string }>();
  const lines = content.split("\n");
  const entryRegex =
    /^\s*-\s+`([^`]+)`\s*<!--\s*id:\s*([^|]+)\s*\|\s*hash:\s*([^\s]+)\s*-->/;

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

async function loadRouting(indexRoot: string): Promise<RoutingJson | null> {
  const routingPath = path.join(indexRoot, "routing.json");
  try {
    const content = await readFile(routingPath, "utf8");
    return JSON.parse(content) as RoutingJson;
  } catch {
    return null;
  }
}

async function searchSkillsV2(indexRoot: string, query: string): Promise<V2SearchResult[]> {
  const routing = await loadRouting(indexRoot);
  if (!routing) {
    return [];
  }

  const entryMap = new Map<string, { signature: string; brief: string }>();
  for (const modulePath of Object.values(routing.modules)) {
    const resolvedPath = path.join(indexRoot, modulePath);
    try {
      const content = await readFile(resolvedPath, "utf8");
      const parsed = parseModuleEntries(content);
      for (const [id, entry] of parsed.entries()) {
        entryMap.set(id, entry);
      }
    } catch {
      // ignore missing module files
    }
  }

  const lowerQuery = query.toLowerCase();
  const results: V2SearchResult[] = [];
  for (const [symbolId, info] of Object.entries(routing.symbols)) {
    const entry = entryMap.get(symbolId);
    const signature = entry?.signature ?? symbolId;
    const brief = entry?.brief ?? "";

    let score = 0;
    if (info.module.toLowerCase().includes(lowerQuery)) {
      score += 2;
    }
    if (symbolId.toLowerCase().includes(lowerQuery)) {
      score += 3;
    }
    if (signature.toLowerCase().includes(lowerQuery)) {
      score += 1;
    }
    if (brief) {
      score += countOccurrences(brief.toLowerCase(), lowerQuery);
    }

    if (score > 0) {
      results.push({
        id: symbolId,
        module: info.module,
        signature,
        brief,
        score
      });
    }
  }

  results.sort((a, b) => b.score - a.score);
  return results;
}

function getSelectedText(editor: vscode.TextEditor | undefined): string {
  if (!editor) {
    return "";
  }
  return editor.selection.isEmpty ? "" : editor.document.getText(editor.selection);
}

function getCodeSnippet(editor: vscode.TextEditor | undefined): string {
  if (!editor) {
    return "";
  }
  return editor.selection.isEmpty
    ? editor.document.getText()
    : editor.document.getText(editor.selection);
}

async function applyLlmEnv(context: vscode.ExtensionContext): Promise<void> {
  const config = vscode.workspace.getConfiguration(CONFIG_SECTION);
  const enabled = config.get<boolean>("llm.enabled", true);
  const provider = config.get<string>("llm.provider") || "";
  const model = config.get<string>("llm.model") || "";
  const baseUrl = config.get<string>("llm.baseUrl") || "";
  const apiKey = (await context.secrets.get(SECRET_KEY)) || "";

  if (!enabled || !provider) {
    delete process.env.SRCA_LLM_PROVIDER;
    delete process.env.SRCA_LLM_MODEL;
    delete process.env.SRCA_LLM_API_KEY;
    delete process.env.SRCA_LLM_BASE_URL;
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
}

async function configureLlm(context: vscode.ExtensionContext): Promise<void> {
  const config = vscode.workspace.getConfiguration(CONFIG_SECTION);

  const providerPick = await vscode.window.showQuickPick(PROVIDERS, {
    placeHolder: "选择 LLM 提供方"
  });
  if (!providerPick) {
    return;
  }

  if (providerPick === "disable") {
    await config.update("llm.provider", "", vscode.ConfigurationTarget.Global);
    await config.update("llm.model", "", vscode.ConfigurationTarget.Global);
    await config.update("llm.baseUrl", "", vscode.ConfigurationTarget.Global);
    await config.update("llm.enabled", false, vscode.ConfigurationTarget.Global);
    await context.secrets.delete(SECRET_KEY);
    vscode.window.showInformationMessage("Semantic Route: 已禁用 LLM。");
    return;
  }

  const models = MODEL_PRESETS[providerPick] || [];
  const modelPick = await vscode.window.showQuickPick(models, {
    placeHolder: "选择模型"
  });
  if (!modelPick) {
    return;
  }

  const apiKey = await vscode.window.showInputBox({
    prompt: `请输入 ${providerPick} API Key`,
    password: true,
    ignoreFocusOut: true
  });
  if (!apiKey) {
    return;
  }

  const baseUrl = await vscode.window.showInputBox({
    prompt: `可选：${providerPick} 的 API Base URL`,
    placeHolder: "留空使用默认接口",
    ignoreFocusOut: true
  });

  await config.update("llm.provider", providerPick, vscode.ConfigurationTarget.Global);
  await config.update("llm.model", modelPick, vscode.ConfigurationTarget.Global);
  await config.update("llm.baseUrl", baseUrl || "", vscode.ConfigurationTarget.Global);
  await config.update("llm.enabled", true, vscode.ConfigurationTarget.Global);
  await context.secrets.store(SECRET_KEY, apiKey);

  vscode.window.showInformationMessage("Semantic Route: LLM 配置已保存。");
}

export function activate(context: vscode.ExtensionContext): void {
  const configureCmd = vscode.commands.registerCommand("semanticRoute.configureLLM", async () => {
    await configureLlm(context);
  });

  const toggleLlmCmd = vscode.commands.registerCommand("semanticRoute.toggleLLM", async () => {
    const config = vscode.workspace.getConfiguration(CONFIG_SECTION);
    const enabled = config.get<boolean>("llm.enabled", true);
    await config.update("llm.enabled", !enabled, vscode.ConfigurationTarget.Global);
    vscode.window.showInformationMessage(
      `Semantic Route: LLM 已${enabled ? "关闭" : "开启"}。`
    );
  });

  const buildCmd = vscode.commands.registerCommand("semanticRoute.buildIndex", async () => {
    const folders = vscode.workspace.workspaceFolders;

    if (!folders || folders.length === 0) {
    vscode.window.showErrorMessage("Semantic Route: 未找到工作区目录。");
    return;
    }

    const projectRoot = folders[0].uri.fsPath;
    const outDir = path.join(projectRoot, "llm_index");

    vscode.window.showInformationMessage("Semantic Route: 正在构建索引...");

    try {
      await applyLlmEnv(context);
      const build = typeof core.buildIndexV2 === "function" ? core.buildIndexV2 : core.buildIndex;
      await build(projectRoot, outDir);
      vscode.window.showInformationMessage("Semantic Route: 索引构建完成。");
    } catch (error) {
      vscode.window.showErrorMessage(`Semantic Route: 构建索引失败 (${(error as Error).message})`);
    }
  });

  const updateCmd = vscode.commands.registerCommand("semanticRoute.updateIndex", async () => {
    const folders = vscode.workspace.workspaceFolders;

    if (!folders || folders.length === 0) {
    vscode.window.showErrorMessage("Semantic Route: 未找到工作区目录。");
    return;
    }

    const projectRoot = folders[0].uri.fsPath;
    const outDir = path.join(projectRoot, "llm_index");

    vscode.window.showInformationMessage("Semantic Route: 正在更新索引...");

    try {
      await applyLlmEnv(context);
      const update = typeof core.updateIndexV2 === "function" ? core.updateIndexV2 : core.updateIndex;
      await update(projectRoot, outDir);
      vscode.window.showInformationMessage("Semantic Route: 索引更新完成。");
    } catch (error) {
      vscode.window.showErrorMessage(`Semantic Route: 更新索引失败 (${(error as Error).message})`);
    }
  });

  const searchCmd = vscode.commands.registerCommand("semanticRoute.searchSkills", async () => {
    const root = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
    if (!root) {
      vscode.window.showErrorMessage("Semantic Route: 未找到工作区目录。");
      return;
    }

    const indexRoot = path.join(root, "llm_index");

    try {
      await access(indexRoot, fsConstants.R_OK);
    } catch {
      vscode.window.showErrorMessage("Semantic Route: 未找到 llm_index，请先运行 Build/Update Index。");
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

    const routingPath = path.join(indexRoot, "routing.json");
    let hasRouting = false;
    try {
      await access(routingPath, fsConstants.R_OK);
      hasRouting = true;
    } catch {
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
        description: item.module,
        detail: item.brief,
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

      const apiLines: string[] = [];
      for (const item of picked) {
        apiLines.push(`- \`${item.signature}\``);
        if (item.brief) {
          apiLines.push(`  ${item.brief}`);
        } else {
          apiLines.push(`  TODO: brief description`);
        }
        apiLines.push("");
      }

      const codeSnippet = getCodeSnippet(activeEditor);
      const assembled = [
        "# Relevant APIs",
        "",
        ...apiLines,
        "# Current Code",
        "",
        "```cpp",
        codeSnippet,
        "```"
      ].join("\n");

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

    const mdContents: string[] = [];
    for (const item of picked) {
      const skillPath = path.join(indexRoot, item.path);
      const content = await readFile(skillPath, "utf8");
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

  context.subscriptions.push(configureCmd, toggleLlmCmd, buildCmd, updateCmd, searchCmd);
}

export function deactivate(): void {
  // noop
}
