# Semantic Routing Code Assistant (SRCA)

Semantic Routing Code Assistant 是一个面向 AI 编程时代的工程语义索引系统。

它并不试图让 AI“更聪明”，而是通过自动抽取代码中的函数、职责与位置，
构建一层 AI 必须遵守的语义能力索引（Semantic IR），
从而约束 Codex / LLM 在写代码时 优先复用项目中已有的一线能力，
避免幻觉、重复实现与架构熵增。

该系统以 函数/类为最小单元，生成高密度语义索引，并通过 VS Code 插件与 Skill 机制，
使 AI 在编码前先“查能力表”，再“写代码”，而不是盲目搜索或就地生成。

---

## ✨ 核心特性

- **多语言支持**：自动识别并索引 C/C++、Java、JavaScript/TypeScript、Python、Go、Rust、Ruby、PHP、C#、Bash 代码
- **智能标签**：基于规则的基础标签 + LLM 生成的语义标签
- **标签图谱**：可视化的 Canvas 2D 气泡图，支持拖拽移动/缩放、筛选、跳转与编辑
- **增量更新**：通过文件 hash 缓存，仅更新修改的文件
- **可扩展架构**：语言适配器层设计，轻松添加新语言支持

---

## 📂 目录结构

```
semantic-route-assistant/
├── core/                    # Node/TypeScript 核心引擎
│   └── src/
│       ├── language/        # 语言适配器 (11种语言)
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
| `Semantic Route: Auto Skills (Doc/Clipboard)` | 自动生成当前上下文的技能文档 |
| `Semantic Route: Search Skill Blocks` | 搜索并生成 Skill 文档片段 |

---

## 🤖 Agent Skills (新特性)

本插件不再生成静态的 Markdown 文档，而是采用 **Global Skills** 模式，将查找能力直接注入到 AI Agent (Claude/Cursor/Copilot) 中。

### 自动安装的 Skill
构建索引后（`semanticRoute.skills.writeOnBuild` 为 true），会自动在 `~/.claude/skills/find-existing-code/` (或其他 Agent 目录) 安装以下工具：

1.  **Tag Search (`search.py` / `search.sh`)**:
    *   **AND 模式**: 查找同时包含 `http` 和 `async` 的代码
        ```bash
        scripts/search.py /path/to/.ai_context http async
        ```
    *   **OR 模式**: 查找 `websocket` 或 `grpc` 相关代码
        ```bash
        scripts/search.py -o /path/to/.ai_context websocket grpc
        ```

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

### 基础标签 (tags_base)
通过规则自动推断，不经过 LLM：
- **符号拆分**: `RectItem::addLine` → `rect`, `add`, `line`
- **语言特征**: `extends`, `implements`, decorators, headers

### 语义标签 (tags_sem)
通过 LLM 分析代码摘要 (Brief) 生成：
- **功能描述**: `集合存储`, `无重复插入`, `对象关联`
- **自动去重**: 过滤掉已存在的基础标签
- **人工干预**: 可以在 **Tag Graph** 中手动编辑描述、添加/删除语义标签，修改会持久化保存到 `routing.json`。

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
- `semanticRoute.llm.briefConcurrency`: 生成 brief 的并发数量
- `semanticRoute.skills.autoTopN`: Auto Skills 自动选取数量
- `semanticRoute.skills.writeOnBuild`: Build Index 时生成并写入 Skills（默认开启）

---

## 🛠️ 扩展新语言

1. 在 `core/src/language/` 添加适配器
2. 在 `core/src/language/index.ts` 注册适配器
3. 运行 `./scripts/rebuild.sh`

---

## License

MIT
