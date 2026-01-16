Semantic Routing Code Assistant (SRCA)
=====================================

中文说明
--------

概览
- SRCA 用于为 C/C++ 代码构建轻量语义索引，让 LLM 提示词更短、更准。
- 会扫描源码、抽取符号、生成 brief（可接 LLM）、按标签聚合模块，输出模块级 Markdown 与 routing.json。

目录结构
- core/                Node/TypeScript 引擎
- vscode-extension/    VS Code 插件
- examples/            示例 C++ 项目
- docs/                设计文档
- scripts/             开发脚本

当前能力（V3）
- 全内存构建管线：
  - scanSourceFiles -> extractSymbolsFromCode (tree-sitter-cpp)
  - extractImplementationForSymbol
 - generateBriefForSymbol（LLM 或占位）
  - 规则标签 + 语义标签聚合
  - 输出模块级 Markdown + routing.json
  - .meta.json（文件 hash 缓存）
- Search Skill Blocks 支持标签过滤（#tag）；标签图谱使用 Canvas 2D，支持拖拽/缩放、标签筛选与跳转。
- 语言适配层已抽象，C/C++ 为默认适配器。

索引产物
- .ai_context/modules/*.md
  - 模块视图，条目注释含 tags。
- .ai_context/routing.json
  - symbol -> { module, declHash, filePath, tags }（不含 brief）。
- .ai_context/.meta.json
  - 文件 hash + lastUpdated。

VS Code 指令
- Semantic Route: Configure LLM
- Semantic Route: Build Index
- Semantic Route: Update Index
- Semantic Route: Search Skill Blocks
- Semantic Route: Tag Graph（标签气泡图，支持筛选/搜索/跳转）

LLM 配置
- 通过 "Semantic Route: Configure LLM" 添加/编辑配置并选择使用。
- 每个配置包含 provider/model/baseUrl/systemPrompt/userPrompt 和 API Key。
- Prompt 占位符：{{moduleName}} / {{signature}} / {{implementation}}。

Settings（Semantic Route）
- semanticRoute.llm.profiles
- semanticRoute.llm.activeProfile
- semanticRoute.llm.enabled
- semanticRoute.llm.briefConcurrency

扩展新语言
1) 在 core/src/language/ 新增 adapter（如 pythonAdapter.ts）。
2) 在 core/src/language/index.ts 注册。
3) 调用 buildModuleIndexV3/updateModuleIndexV3 时传 { languageId: "yourAdapterId" }。

开发
- scripts/rebuild.sh
  - 重新构建 core 与 VS Code 插件。

备注
- Build/Update 默认使用 V3，输出到 .ai_context。
- V1/V2 逻辑仍保留在 core 内部，但不再暴露为命令。

---

English
-------

Overview
- SRCA builds a lightweight semantic index for C/C++ code so LLM prompts stay short and accurate.
- It scans source files, extracts symbols, generates one-line briefs (LLM optional), clusters symbols into modules, and writes module Markdown plus routing.json.

Repository layout
- core/                Node/TypeScript engine
- vscode-extension/    VS Code extension
- examples/            Example C++ projects
- docs/                Design docs
- scripts/             Dev scripts

Current features (V3)
- V3 in-memory pipeline:
  - scanSourceFiles -> extractSymbolsFromCode (tree-sitter-cpp)
  - extractImplementationForSymbol
  - generateBriefForSymbol (LLM or placeholder)
  - rule-based tags + semantic tag clustering
  - module Markdown output
  - routing.json output
  - .meta.json (file hash cache)
- Search Skill Blocks with tag filters (#tag); Tag Graph uses Canvas 2D with drag/zoom/filter and jump-to-location.
- Language adapter layer (C/C++ is the default adapter).

Index outputs
- .ai_context/modules/*.md
  - Module view with tags in HTML comments.
- .ai_context/routing.json
  - Symbol -> { module, declHash, filePath, tags } (no brief text).
- .ai_context/.meta.json
  - File hash + lastUpdated.

VS Code commands
- Semantic Route: Configure LLM
- Semantic Route: Build Index
- Semantic Route: Update Index
- Semantic Route: Search Skill Blocks
- Semantic Route: Tag Graph (bubble view with filter/search/jump)

LLM configuration
- Use "Semantic Route: Configure LLM" to add/edit profiles and select one.
- Each profile includes provider/model/baseUrl/systemPrompt/userPrompt and an API key.
- Prompt placeholders: {{moduleName}}, {{signature}}, {{implementation}}.

Settings (Semantic Route)
- semanticRoute.llm.profiles
- semanticRoute.llm.activeProfile
- semanticRoute.llm.enabled
- semanticRoute.llm.briefConcurrency

Language support
1) Create a new adapter in core/src/language/ (e.g., pythonAdapter.ts).
2) Register it in core/src/language/index.ts.
3) Call buildModuleIndexV3/updateModuleIndexV3 with { languageId: "yourAdapterId" }.

Development
- scripts/rebuild.sh
  - Rebuilds core and the VS Code extension.

Notes
- Build/Update use V3 and write to .ai_context.
- V1/V2 remain in core for compatibility but are not exposed as commands.
