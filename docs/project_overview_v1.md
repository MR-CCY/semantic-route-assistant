好，我给你写一份**“项目总说明 / 基线文档 v1.0”**。
后面如果我说的话和这个说明冲突，就以这份为准，你可以拿这份来纠错我。

⸻

项目总说明 v1.0（防幻觉版）

0. 项目概览

项目暂名：Semantic Routing Code Assistant（简称 SRCA）

一句话说明：

在代码仓库之上自动构建一层“给 AI 看的项目使用手册（Semantic Code Layer）”，
用“小模型 + Git 增量 + VSCode 插件”实现：
先读 Skill 文档、再动源码 的 AI 编程流程，降低幻觉、节约 token。

当前主要目标语言：C++
（以后可以扩展到其他语言，但这不是当前版本的前提要求）

⸻

1. 项目目标 & 非目标

1.1 项目目标
	1.	让 AI 在有限 token 内尽可能理解项目结构和现有能力
	•	重点是：项目级理解，而不是单文件理解。
	•	通过索引层（Skill Blocks）获得比“直接贴源码”更高的信息密度。
	2.	减少幻觉
	•	避免 AI：
	•	发明不存在的函数/模块；
	•	误解模块职责；
	•	乱猜接口/参数；
	•	把不相关的代码硬扯进来。
	3.	减少上下文 token 消耗
	•	用精简的 Markdown 索引替代大量源码粘贴。
	•	同样的 token 数量，包含更多结构化语义信息。
	4.	让 AI 的工作流更像一个高级工程师
	•	先查文档（Skill Block/索引层）
	•	再定位文件
	•	再修改/新增代码
	5.	自动化维护这个“语义索引层”
	•	跟随源码变化自动更新；
	•	通过 Git Hash 做增量更新；
	•	开发者不用手工维护大部分文档。

1.2 非目标（v1 不做的事）
	1.	不是一个“自动修一切 bug 的 AI”
	•	它是一个“上下文路由 + 索引层工具”，不负责所有智能。
	2.	不是替代所有文档系统
	•	不替代正式 API 文档 / 架构文档；
	•	Skill Block 是“面向 AI 的压缩视图”，不是给人看的长文档（人类可以看，但不是重点）。
	3.	不是全自动 IDE
	•	不强制集成所有 LLM 调用；
	•	初期只提供“帮你拼 prompt”的 VSCode 插件即可。
	4.	不是代码搜索引擎的竞品
	•	它不是 ripgrep / sourcegraph 的替代；
	•	重点是给 AI 用的语义索引，而不是给人搜代码。

⸻

2. 核心理念

2.1 Semantic Code Layer（语义代码层）

在原本的代码库之上，增加一层“语义层”，由大量 Markdown 组成：
	•	不保存实现细节；
	•	只保存：
	•	模块职责；
	•	对外接口签名；
	•	使用示例；
	•	副作用 / 线程安全 / 约定；
	•	文件路径映射。

源码 = 机器执行层
语义层 = AI 理解层（也是人类可读的浓缩文档）

2.2 Skill Block（技能块）

每个模块 / 文件对应的 Markdown 文档称为一个 Skill Block。

大致结构：

# Module: <模块名>
# Path: <路径>

## 1. 模块职责
...

## 2. 对外接口（函数/类声明）

```cpp
// 只列声明，不写实现

3. 使用方式（Usage）

// 调用示例

4. 副作用

…

5. 线程安全

…

6. 文件结构（相关 .h/.cpp）
	•	…

特点：

- **高语义密度**：用自然语言 + 少量代码，表达“这个模块是干嘛的、怎么用”。
- **严格禁止**：
  - 重新实现已有函数；
  - 胡编模块；
  - 假装存在某些 API。

### 2.3 分层路由（Hierarchical Routing）

**分两层：**

- **L1：项目总览 / 路由入口**
  - 描述项目有哪些领域模块（utils / http / db / core_runtime 等）
  - 类似地图。

- **L2：模块级 Skill Block**
  - 每个模块有独立 MD；
  - 可以按目录 / 子域再分层（domains/utils, domains/http, …）。

AI 使用时路线是：

> L1 找到模块 & 功能 → L2 阅读对应 Skill Block → 再去看/改具体源码文件

### 2.4 语义压缩（Semantic Compression）

**使用“小模型（Small LLM）”来总结和压缩源码：**

- 输入：C++ 文件（或相关头/源文件片段）；
- 输出：结构化的 Skill Block Markdown。

作用：  
把长代码 → 压成高信息密度的说明，以更少 token 告诉大模型“这块代码是干嘛的”。

### 2.5 增量语义缓存（Incremental Semantic Cache）

每个源码文件有对应的：

- **内容哈希（Hash）**
- **对应 Skill Block 文件路径**

当源码变化时：

- Hash 改变 → 重新生成对应 Skill Block；
- Hash 不变 → 复用旧 Skill Block。

存储一个 metadata（例如 `llm_index/.meta.json`）来记录映射关系。

> 这样 Skill 层**始终跟源码同步**，避免“文档滞后”、“AI 看的是旧文档”。

---

## 3. 系统组件

整个系统分为 4 个核心组件（+ 1 个可选）。

### 3.1 语义索引引擎（Semantic Index Engine，核心模块）

位置：项目 `core/`（Node.js / TypeScript）

职责：

1. 扫描项目源码（C++ 文件）
2. 计算 Hash & 维护 `.meta` 信息
3. 调用小模型生成 Skill Block
4. 写入 `llm_index/` 目录
5. 提供检索接口（按照关键字 / 模块名查找相关 Skill Block）

对外暴露的核心函数示意：

```ts
buildIndex(projectRoot: string, outDir: string): Promise<void>;
updateIndex(projectRoot: string, outDir: string): Promise<void>; // 基于 hash 增量
searchSkills(outDir: string, query: string): Promise<SkillMatch[]>;

3.2 Skill Block 存储结构（llm_index/ 目录）

约定：

llm_index/
  00_project_overview.md
  .meta.json              # 文件 hash & skill md 映射
  domains/
    utils/
      00_overview.md
      time_utils_api.md
      log_utils_api.md
    http/
      00_overview.md
      http_client_api.md
    db/
      ...
    core_runtime/
      ...

特点：
	•	只读给 AI：不会在这里写实现代码。
	•	既可被人查看，也主要给 LLM 看。

3.3 语义路由器 / 查询层（Semantic Router）

职责：
	•	接收自然语言 / 文件上下文查询（例如：“统计任务执行耗时并记录日志”）
	•	在 llm_index/ 下搜索相关 Skill Block：
	•	可以先用字符串匹配 / 简单关键词；
	•	后期可以加入 embedding + fuse.js 等。
	•	返回按相关度排序的 Skill Block 列表。

语义路由器是 VSCode 插件和 LLM 之间的“上下文选片机”。

3.4 VSCode 插件

位置：vscode-extension/

职责：
	1.	提供命令调用入口：
	•	Semantic Route: Build Index
	•	Semantic Route: Search Skills
	2.	调用 core 的 buildIndex / searchSkills 等函数；
	3.	把选择好的 Skill Block + 当前代码拼接成 prompt：
	•	以新编辑器 tab 的形式展示（方便复制给任意 LLM）；
	•	或者在后续版本中直接调用 LLM API。

MVP 版本不需要集成任何 LLM 调用，只做“拼上下文”。

3.5 （可选）LLM 执行层

后续增强：
	•	在 VSCode 插件里直接调用 GPT / Claude / 自建模型：
	•	自动带上 Skill Block；
	•	自动检查生成是否重复造轮子；
	•	自动将生成代码插入编辑器。

不是当前必须实现的部分，只是将来可选增强。

⸻

4. 工作流程（典型场景）

4.1 首次构建索引
	1.	打开一个 C++ 项目（比如 TaskHub）；
	2.	在 VSCode 中执行命令：
Semantic Route: Build Index
	3.	插件调用 core.buildIndex：
	•	扫描所有 .h/.cpp；
	•	调用小模型生成 Skill Block；
	•	生成 llm_index/ 目录。

结果：
项目拥有一个“AI 可读”的语义索引层，可以长期复用。

4.2 后续增量更新
	1.	开发者修改某些 .cpp/.h；
	2.	提交代码前/后，执行：
	•	Semantic Route: Update Index（或者自动挂在 Git hook / CI 上）
	3.	引擎：
	•	根据 .meta.json 计算 hash；
	•	只对 hash 变化的文件重新生成 Skill Block；
	•	未变化部分沿用旧索引。

保证 Skill 层一直最新。

4.3 开发时 AI 辅助使用场景

开发者想写一段“带日志的计时任务”代码：
	1.	打开 VSCode，选中当前要修改的文件；
	2.	执行命令：
Semantic Route: Search Skill Blocks
	3.	输入自然语言描述或直接使用当前文件路径作为查询；
	4.	插件调用 searchSkills 返回相关 Skill Block 列表；
	5.	用户在 QuickPick 中勾选相关的几个（例如 time_utils_api.md 和 log_utils_api.md）；
	6.	插件生成一个 prompt 文本，包含：
	•	项目概览（必要时）；
	•	勾选的 Skill Block 内容；
	•	当前文件/选中代码片段；
	•	一个清晰的任务描述前言，“请先阅读这些 Skill 文档，然后修改/补全代码”。
	7.	开发者把这段 prompt 直接扔给 ChatGPT / Codex / Claude 等 → 获得更少幻觉、更懂项目的回答。

⸻

5. 技术路线（模型 & 实现）

5.1 模型使用

生成 Skill Block 这一部分必须使用 LLM 接口（小模型即可）。
几种可能路线：
	1.	云端小模型 API
	•	GPT-4o-mini / Claude Haiku / Gemini Flash 等；
	•	成本低，效果好；
	•	适合个人开发阶段。
	2.	本地 LLM（Ollama / LM Studio 等）
	•	使用比如 Llama3 8B、Qwen2.5 7B 等；
	•	更安全，不走公网；
	•	效果略逊，但对“总结模块职责”这种任务基本够用。
	3.	混合 AST + LLM
	•	AST 提供函数签名、类结构；
	•	LLM 提供职责、使用方式、语义解释；
	•	两者合成最终 Skill Block。

5.2 当前版本约束
	•	v1 不要求必须有 AST，可以先完全依赖小模型 summarization。
	•	重点是：
	•	路径映射；
	•	Hash 增量；
	•	Skill Block 结构；
	•	VSCode 插件工作流。

⸻

6. 主要缺点 & 已知风险（v1 的现实情况）

（这里为后面防幻觉：如果我有一天把它吹成“完美方案”，请你拿这个打我脸）
	1.	Skill Block 质量依赖小模型输出
	•	有可能总结不准 / 有遗漏。
	•	通过模板约束 + 双模型校验 + 人工检查关键模块可以缓解。
	2.	不是所有模块都适合自动总结
	•	非常复杂的元编程 / 宏 / 特定框架逻辑，可能需要人工写 Skill Block。
	3.	索引层本身也会变大
	•	依赖良好的搜索/路由工具（Semantic Router）；
	•	人类不需要手动翻一堆 MD，插件替你找。
	4.	AI 不一定 100% 遵守 Skill
	•	需要在 prompt 中明确约束“禁止重新实现已有函数”等；
	•	未来可以开发“生成代码静态检查”来辅助。

这些缺点都是可控的工程问题，不影响方案成立。

⸻

7. 当前阶段的“完成标准”（MVP）

当且仅当以下能力实现时，视为 MVP 完成：
	1.	能对一个实际 C++ 项目：
	•	扫描源码；
	•	生成 llm_index/；
	•	每个源码文件至少有一个对应的 stub/真实 Skill Block。
	2.	VSCode 插件：
	•	有 Build Index 命令；
	•	能调用 core.buildIndex 在工作区生成/更新 llm_index。
	3.	基础查询能力：
	•	有 Search Skill Blocks 命令；
	•	可以按关键词在 llm_index/ 中找到相关 md；
	•	能把选中的 Skill Block + 当前代码片段拼成 prompt，在新 tab 展示。

这时，这个工具已经具备实用价值：
开发者可以用它自动收集“项目上下文 + 模块文档”，减少人工找代码和解释给 AI 的成本。

⸻

如果以后我在别的对话里：
	•	把这个工具说成“完全不需要模型”；❌
	•	或说“它自己会自动搜索整个项目并直接让 AI 改代码”；❌
	•	或说“它就是个普通 code search 插件”；❌
	•	或说“主要目标是防止造轮子（而不是提升理解 & 降低 token）”；❌

那都是跑偏 / 幻觉，你可以直接拿这份“总说明 v1.0”糊我。

如果你觉得这版有哪里不对 / 要补充的，我们可以一起改成 v1.1，然后把它当作项目的“圣经版本”。