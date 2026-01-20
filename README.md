# Semantic Routing Code Assistant (SRCA)

Semantic Routing Code Assistant 是面向 AI 编程的语义索引系统。

它不试图让 AI“更聪明”，而是把代码中的函数、职责与位置抽取成可检索的语义能力索引（Semantic IR），
让 Codex/LLM 在写代码前优先复用已有能力，减少幻觉、重复实现与架构熵增。

系统以函数/类为最小单元生成高密度索引，并通过 VS Code 插件与 Skill 机制，
让 AI 先“查能力表”、再“写代码”，而不是盲目搜索或就地生成。

Token 预估（语义聚合）：100 个新标签 + 50 个已有标签（每个约 5 字），输入+输出约 1.4k–1.6k tokens，视标签长度而变。

---

## ✨ 核心特性

- **多语言支持**：自动识别并索引 C/C++、Java、JavaScript/TypeScript、Python、Go、Rust、Ruby、PHP、C#、Bash 代码
- **智能标签**：基于规则的基础标签 + LLM 生成的语义标签
- **标签图谱**：可视化的 Canvas 2D 气泡图，支持拖拽移动/缩放、筛选、跳转与编辑
- **增量更新**：通过文件 hash 缓存，仅更新修改的文件
- **可扩展架构**：语言适配器层设计，轻松添加新语言支持

---

## 🧭 使用步骤

1. 安装扩展并打开项目工作区
2. 首次使用先运行 `Semantic Route: Configure LLM` 配置 LLM（未配置仅生成基础标签）
3. 运行 `Semantic Route: Build Index` 生成 `.ai_context/`
4. 运行 `Semantic Route: Tag Graph` 查看/筛选/编辑标签
5. 日常修改后运行 `Semantic Route: Update Index` 做增量更新
6. 可选操作（Skills 默认关闭）：
   - `Semantic Route: Configure LLM` 配置 LLM 提供商
   - `Semantic Route: Auto Skills (Doc)` 生成当前上下文技能文档（到编辑器）
   - `Semantic Route: Auto Skills (Clipboard)` 生成当前上下文技能文档（到剪贴板）
   - `Semantic Route: Search Skill Blocks` 搜索并生成 Skill 文档片段
   - `Semantic Route: Toggle Skills` 启用/关闭 Skills（会创建/删除 `SKILL.md` 和脚本）
   - `Semantic Route: 在图谱中显示当前符号` 快速定位当前光标处符号

---

## 📂 目录结构

```
semantic-route-assistant/
├── core/                    # Node/TypeScript 核心引擎
│   └── src/
│       ├── language/        # 语言适配器 (10种语言)
│       │   ├── cppAdapter.ts
│       │   ├── javaAdapter.ts
│       │   ├── jsAdapter.ts
│       │   ├── pythonAdapter.ts
│       │   ├── goAdapter.ts
│       │   ├── rustAdapter.ts
│       │   ├── rubyAdapter.ts
│       │   ├── phpAdapter.ts
│       │   ├── csharpAdapter.ts
│       │   └── bashAdapter.ts
│       ├── indexV3.ts       # V3 索引构建主逻辑
│       └── ...
├── vscode-extension/        # VS Code 扩展
├── examples/                # 示例项目
├── docs/                    # 设计文档
└── scripts/                 # 开发脚本
```

---

## 🌐 支持的语言

| 语言 | 文件扩展名 | 符号提取 | 标签推断 |
|------|-----------|---------|---------| 
| **C/C++** | `.c`, `.cpp`, `.cc`, `.cxx`, `.h`, `.hpp`, `.hxx`, `.hh` | tree-sitter | class/struct, 继承, 命名空间 |
| **Java** | `.java` | 正则 | class/interface/enum, extends/implements, 注解 |
| **JavaScript/TypeScript** | `.js`, `.jsx`, `.ts`, `.tsx`, `.mjs`, `.cjs`, `.vue` | 正则 | class/function, async/export, 装饰器 |
| **Python** | `.py`, `.pyw` | 正则 | class/def, async, 装饰器, 继承 |
| **Go** | `.go` | 正则 | func/struct/interface, receiver, exported |
| **Rust** | `.rs` | 正则 | fn/struct/impl/trait, pub, async |
| **Ruby** | `.rb`, `.rake` | 正则 | class/module/def, attr_*, blocks |
| **PHP** | `.php` | 正则 | class/function/trait, namespace, visibility |
| **C#** | `.cs` | 正则 | class/interface/struct, async, attributes |
| **Bash** | `.sh`, `.bash` | 正则 | function, exported variables |

---

## 🚀 VS Code 指令

| 指令 | 说明 |
|------|------|
| `Semantic Route: Build Index` | 全量构建索引 (生成 `routing.json`) |
| `Semantic Route: Update Index` | 增量更新索引 |
| `Semantic Route: Tag Graph` | 打开交互式标签图谱 (支持编辑/添加标签) |
| `Semantic Route: 在图谱中显示当前符号` | 在图谱中定位当前光标处的符号 |
| `Semantic Route: Configure LLM` | 配置 LLM 提供商 |
| `Semantic Route: Auto Skills (Doc)` | 自动生成当前上下文的技能文档（到编辑器） |
| `Semantic Route: Auto Skills (Clipboard)` | 自动生成当前上下文的技能文档（到剪贴板） |
| `Semantic Route: Search Skill Blocks` | 搜索并生成 Skill 文档片段 |
| `Semantic Route: Toggle Skills` | 启用/关闭 Skills（创建/删除 Skill 文件） |

---

## 🤖 Agent Skills (新特性)

Skills 为可选能力（默认关闭），需手动启用后才会写入技能文件。

### 自动安装的 Skill
运行 `Semantic Route: Toggle Skills` 启用后，才会在 `~/.claude/skills/find-logic-implementation/` 与 `~/.codex/skills/find-logic-implementation/` 写入 `SKILL.md` 与脚本。若此前已创建该目录，扩展更新时会自动刷新；否则需手动运行该命令创建。

1.  **Tag Search (`search.py` / `search.sh`)**:
    *   组内 OR、组间 AND（用 `|` 表示同义组）
        ```bash
        python3 <SKILL_ROOT>/scripts/search.py /path/to/.ai_context http|http_request|请求 async|异步
        ```
    *   基础标签（类名/模块名/实体名）直接使用；能力/行为类意图做语义转化并扩展同义/翻译/格式变体后再传入搜索
    *   能力边界由语义标签定义，基础标签仅用于限定范围
    *   可用 `!tag` 或 `-tag` 作为排除组（组内仍可用 `|`）
    *   短标签(<=3)仅全等匹配，避免噪声
    *   结果排序：优先按标签 `score` 加权，其次按匹配组数

2.  **Usage Tracking**:
    *   每次搜索标签时，会自动增加该标签在 `routing.json` 中的权重 (`score`)。
    *   高频使用的标签在图谱中会显示得更大。

---

## 📦 索引产物

索引输出到项目根目录的 `.ai_context/` 文件夹：

```
.ai_context/
├── routing.json       # 核心语义路由表 (包含所有符号、标签、Hash)
└── .meta.json         # 增量构建缓存
```

> **注意**: 旧版本的 `modules/*.md` 文件已移除，所有语义信息均存储在 `routing.json` 中，通过 Tag Graph 或 Skill 脚本进行访问。

---

## 🔧 标签系统

标签在 `routing.json` 中以统一数组 `symbols[*].tags` 保存；分类信息记录在 `tagIndex`（`base`/`semantic`/`custom`），包含 `count` 与 `score`（搜索脚本会累加 `score`）。

### 基础标签 (base)
通过规则自动推断，不经过 LLM：
- **符号拆分**: `RectItem::addLine` → `rect`, `add`, `line`
- **语言特征**: `extends`, `implements`, decorators, headers

### 语义标签 (semantic)
通过 LLM 基于函数签名与实现生成：
- **功能描述**: `集合存储`, `无重复插入`, `对象关联`
- **过滤规则**: 去重/过滤低信息标签，数量不限制

### 自定义标签 (custom)
通过 **Tag Graph** 手动添加/删除：
- **持久化**: 写入 `routing.json` 的 `symbols[*].tags`
- **类型归类**: 记录在 `tagIndex.custom`，用于筛选与可视化

---

## 🔍 可视化图谱 (Tag Graph)

可视化的 Canvas 2D 气泡图，提供以下交互：
- **浏览**: 滚轮缩放，拖拽平移
- **筛选**: 顶部搜索栏过滤标签
- **跳转**: 双击节点跳转到 VS Code 代码位置
- **编辑**: 双击列表项修改符号描述 (Brief)
- **管理**: 点击 `+` 按钮搜索并添加新标签

---

## ⚙️ LLM 配置

通过 `Semantic Route: Configure LLM` 命令配置：

| 提供商 | 模型示例 |
|--------|-----------|
| OpenAI | gpt-4o, gpt-4o-mini |
| Qwen | qwen-turbo, qwen-plus |
| Gemini | gemini-1.5-flash |
| Other | 自定义 OpenAI 兼容接口 |

---

## ⚙️ 配置项 (VS Code Settings)

- `semanticRoute.llm.enabled`: 启用/禁用 LLM
- `semanticRoute.llm.aggregationEnabled`: 启用语义标签聚合（开启：LLM 合并未知语义标签；关闭：仅本地清洗，未知标签不聚合）
- `semanticRoute.llm.activeProfile`: 当前启用的 LLM 配置 ID（由 Configure LLM 管理）
- `semanticRoute.llm.profiles`: LLM 配置列表（由 Configure LLM 管理）
- `semanticRoute.llm.provider`: LLM 提供方（legacy 单配置，未启用 profile 时生效）
- `semanticRoute.llm.model`: LLM 模型名称（legacy 单配置）
- `semanticRoute.llm.baseUrl`: 可选的 API Base URL（legacy 单配置）
- `semanticRoute.llm.briefConcurrency`: 生成 brief 的并发数量
- `semanticRoute.llm.systemPrompt`: 生成 brief/语义标签的 System Prompt（留空用默认）
- `semanticRoute.skills.autoTopN`: Auto Skills 自动选取数量
- `semanticRoute.index.ignorePatterns`: 忽略索引的文件/目录（.gitignore 规则，工作区级别）
- Skills 开关不在设置中，通过 `Semantic Route: Toggle Skills` 控制（默认关闭）

---

## 🛠️ 扩展新语言

1. 在 `core/src/language/` 添加适配器
2. 在 `core/src/language/index.ts` 注册适配器
3. 运行 `./scripts/rebuild.sh`

---

## License

MIT
