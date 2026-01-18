# Semantic Routing Code Assistant (SRCA)

一个为多语言代码构建轻量语义索引的 VS Code 扩展，让 LLM 提示词更短、更准。

---

## ✨ 核心特性

- **多语言支持**：自动识别并索引 C/C++、Java、JavaScript/TypeScript、Vue、Python、Go 代码
- **智能标签**：基于规则的基础标签 + LLM 生成的语义标签
- **标签图谱**：可视化的 Canvas 2D 气泡图，支持拖拽/缩放、筛选与跳转
- **增量更新**：通过文件 hash 缓存，仅更新修改的文件
- **可扩展架构**：语言适配器层设计，轻松添加新语言支持

---

## 📂 目录结构

```
semantic-route-assistant/
├── core/                    # Node/TypeScript 核心引擎
│   └── src/
│       ├── language/        # 语言适配器
│       │   ├── cppAdapter.ts
│       │   ├── javaAdapter.ts
│       │   ├── jsAdapter.ts
│       │   ├── pythonAdapter.ts
│       │   └── goAdapter.ts
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
| **JavaScript/TypeScript** | `.js`, `.jsx`, `.ts`, `.tsx`, `.mjs`, `.cjs` | 正则 | class/function, async/export, 装饰器 |
| **Vue** | `.vue` | 正则 | component, 装饰器 |
| **Python** | `.py`, `.pyw` | 正则 | class/def, async, 装饰器, 继承 |
| **Go** | `.go` | 正则 | func/struct/interface, receiver, exported |

---

## 🚀 VS Code 指令

| 指令 | 说明 |
|------|------|
| `Semantic Route: Build Index` | 全量构建索引 (生成 `routing.json`) |
| `Semantic Route: Update Index` | 增量更新索引 |
| `Semantic Route: Tag Graph` | 打开交互式标签图谱 (支持编辑/添加标签) |
| `Semantic Route: Reveal Symbol in Graph` | 在图谱中定位当前光标处的符号 |
| `Semantic Route: Configure LLM` | 配置 LLM 提供商 |
| `Semantic Route: Auto Skills (Doc/Clipboard)` | 自动生成当前上下文的技能文档 |

---

## 🤖 Agent Skills (新特性)

本插件不再生成静态的 Markdown 文档，而是采用 **Global Skills** 模式，将查找能力直接注入到 AI Agent (Claude/Cursor/Copilot) 中。

### 自动安装的 Skill
构建索引后，会自动在 `~/.claude/skills/find-existing-code/` (或其他 Agent 目录) 安装以下工具：

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

## 🛠️ 扩展新语言

1. 在 `core/src/language/` 添加适配器
2. 在 `core/src/language/index.ts` 注册适配器
3. 运行 `./scripts/rebuild.sh`

---

## License

MIT
