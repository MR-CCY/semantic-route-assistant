"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.generateClaudeSkillMd = generateClaudeSkillMd;
exports.generateSkillsFiles = generateSkillsFiles;
exports.removeSkillsFiles = removeSkillsFiles;
const path_1 = __importDefault(require("path"));
const promises_1 = require("fs/promises");
/**
 * Generate .skills/find-logic-implementation/SKILL.md - Semantic logic discovery protocol
 *
 * This Skill focuses on semantic discovery of algorithms/behaviors rather than text search.
 */
function getSkillRootExampleLine() {
    const skillName = SKILL_NAME;
    const isWindows = process.platform === "win32";
    const codexRoot = isWindows
        ? `%USERPROFILE%\\.codex\\skills\\${skillName}`
        : `~/.codex/skills/${skillName}`;
    const claudeRoot = isWindows
        ? `%USERPROFILE%\\.claude\\skills\\${skillName}`
        : `~/.claude/skills/${skillName}`;
    return `当前平台示例（Codex）：\`${codexRoot}\`；Claude：\`${claudeRoot}\``;
}
const SKILL_NAME = "find-logic-implementation";
const LEGACY_SKILL_NAME = "find-existing-code";
function generateClaudeSkillMd() {
    const skillRootExampleLine = getSkillRootExampleLine();
    return `---
name: ${SKILL_NAME}
description: 语义能力透视：查找功能/能力/行为/算法/模式的实现（函数名未知也可找，非普通文本搜索）
---

# Semantic Logic Discovery Protocol

核心原则：
1) 语义发现优先（算法/行为/意图）
2) 普通文本搜索走 rg/IDE
3) 新增功能前 → 先用标签搜索已有能力
4) 重构/修改前 → 先查询依赖，评估影响

---

## 适用范围（语义匹配）

**必须使用**：语义/算法/行为/意图类检索（函数名看不出逻辑）。
- 例：气泡排序、DAG 环检测、缓存失效策略、指纹生成、二分查找
- 例：多条件组合（DAG + 锁 + 数据库写入）

**禁止使用**：明确字面目标，直接搜代码更快更准。
- 例：函数名/类名/文件名/路径/配置键/错误码/字符串字面量

**路由规则**：能用 \`rg\`/IDE 搜索直接命中 → 不用此技能；否则用语义匹配。

---

## 快速路径

1) 确定索引目录：\`.ai_context\`
2) 执行查询脚本（本地，无网络）
3) 有匹配 → 阅读最小实现片段 → 复用或申请重写
4) 无匹配 → 直接实现

脚本路径：\`<SKILL_ROOT>/scripts/search.py\`
${skillRootExampleLine}

---

## 行为规则（简化）

### Rule 1: 语义转化（调用 search.py 前自动扩展）
并非所有词都需要语义转化。明确实体/类名/模块名（如 dag、ApiClient）直接作为基础标签保留；只有能力/行为类意图（如 解析 JSON）才做语义转化与同义扩展。
将用户意图转为技术语义标签（snake_case），并在调用 search.py 前自动扩展中英同义/翻译/格式变体（中英/蛇形/空格/连字符）；把同义项用 \`|\` 合成一组，python 仅负责检索不做扩展。
例："气泡排序" → bubble_sort|bubble sort|sorting|气泡排序|排序算法
例："dag 类的 json 解析" → dag + json_parse|json_decode|json_deserialize|解析json

### Rule 2: 自动分组 + 并/交集
脚本会输出语义分组：**组内 OR**（相似语义，用 \`|\`），**组间 AND**（不相似语义）。
可用 !tag 或 -tag 作为排除组（组内仍可用 |）。
短标签(<=3)仅全等匹配，避免噪声。
\`\`\`bash
python3 <SKILL_ROOT>/scripts/search.py <indexRoot> tagA|tagA_syn1|tagA_cn tagB|tagB_syn1|tagB_cn
\`\`\`

### Rule 3: 阅读验证
有匹配时只做三件事：
1) **阅读最小实现**：跳转到 \`filePath:declLine\` 判断能力
2) **确认满足**：能满足就复用，不要改
3) **减少输入**：只汇报能力列表与结论，不贴源码

### Rule 4: 重写审批
如果匹配存在但需要重写，必须：
1. **说明原因**：解释为什么现有实现不满足需求
2. **请求审批**：等待用户确认后再重写
3. **示例回复**：

\`\`\`
[FOUND] net::HttpClient::get 
[REVIEW] 阅读实现后发现不支持自定义 Headers
[PROPOSE] 建议重写/扩展此函数，原因：需要支持 Authorization header
请确认后我再实现。
\`\`\`

**无匹配时**：直接实现新功能。

### Rule 5: 重构影响分析
重构/修改前只输出最小影响面（只回答：谁在调用该函数、谁在使用该类型、数据结构变更影响哪些模块）：

\`\`\`
[REFACTOR] 修改 RoutingJson
[QUERY] python3 <SKILL_ROOT>/scripts/search.py <indexRoot> routing tagIndex
[IMPACT] 列出受影响符号（最多 5 个）
[ACTION] 依次更新所有受影响的函数
\`\`\`

---

## 查询协议（短）

### Step 1: 确定标签（含同义/翻译/格式变体）
\`\`\`
"气泡排序" → bubble_sort|sorting|气泡排序
"DAG 环检测" → dag|directed_acyclic_graph cycle_detection|环检测
\`\`\`

---

## 行为示例（最小）

\`\`\`
[QUERY] python3 <SKILL_ROOT>/scripts/search.py <indexRoot> bubble_sort|sorting|气泡排序
[FOUND] utils::process_data - 实现排序逻辑
[REVIEW] 阅读 src/utils/sort.cpp:42，确认包含气泡排序步骤
[ACTION] 复用 utils::process_data
\`\`\`

---

## 目标

- **语义发现**: 定位算法/行为/意图实现
- **交集检索**: 多条件组合更精准
- **防重复**: 查到匹配时必须复用
- **可重写**: 但需说明原因 + 审批
- **安全重构**: 修改前分析影响范围
- **省 Token**: 只喂能力表，不喂实现细节
`;
}
function generateSearchPyScript() {
    return `#!/usr/bin/env python3
"""
search.py - Search symbols by semantic tag groups
Usage:
  python search.py <path-to-.ai_context> <tag1> [tag2 ...]     # OR within group, AND across groups
  # Group synonyms with "|" (e.g. bubble_sort|sorting|气泡排序)
  # Exclude group with "!" or "-" prefix (e.g. !mock|test)
  # Short tags (<= 3 chars) require exact match
"""

import json
import sys
from pathlib import Path
import re

SHORT_TAG_MAX_LEN = 3


def normalize_tag(tag: str) -> str:
    tag = tag.strip().lower()
    tag = re.sub(r"[\\s\\-\\.]+", "_", tag)
    tag = re.sub(r"_+", "_", tag).strip("_")
    return tag


def tag_matches(query_tag: str, symbol_tag: str) -> bool:
    if not query_tag or not symbol_tag:
        return False
    if len(query_tag) <= SHORT_TAG_MAX_LEN or len(symbol_tag) <= SHORT_TAG_MAX_LEN:
        return query_tag == symbol_tag
    return query_tag in symbol_tag or symbol_tag in query_tag


def merge_group_sets(groups: list[set[str]]) -> list[set[str]]:
    merged: list[set[str]] = []
    for group in groups:
        if not group:
            continue
        placed = False
        for existing in merged:
            if existing & group:
                existing.update(group)
                placed = True
                break
        if not placed:
            merged.append(set(group))

    changed = True
    while changed:
        changed = False
        result: list[set[str]] = []
        for group in merged:
            merged_into = False
            for existing in result:
                if existing & group:
                    existing.update(group)
                    merged_into = True
                    changed = True
                    break
            if not merged_into:
                result.append(set(group))
        merged = result

    return merged


def parse_query_groups(query_tags: list[str]) -> tuple[list[list[str]], list[list[str]]]:
    positive_groups: list[list[str]] = []
    negative_groups: list[list[str]] = []
    for raw in query_tags:
        raw = raw.strip()
        if not raw:
            continue
        is_negative = raw[0] in ("!", "-")
        if is_negative:
            raw = raw[1:]
        parts = [part.strip() for part in raw.split("|") if part.strip()]
        if parts:
            if is_negative:
                negative_groups.append(parts)
            else:
                positive_groups.append(parts)
    return positive_groups, negative_groups


def build_tag_score_map(tag_index: dict) -> dict[str, int]:
    scores: dict[str, int] = {}
    for category in ["base", "semantic", "custom"]:
        for tag, info in (tag_index.get(category, {}) or {}).items():
            scores[tag] = info.get("score", 0)
    return scores


def match_groups(groups: list[list[str]], all_tags: set[str]) -> tuple[list[bool], set[str]]:
    group_matches: list[bool] = []
    matched_tags: set[str] = set()
    for group in groups:
        group_hit = False
        for symbol_tag in all_tags:
            for query_tag in group:
                if tag_matches(query_tag, symbol_tag):
                    group_hit = True
                    matched_tags.add(symbol_tag)
                    break
        group_matches.append(group_hit)
    return group_matches, matched_tags


def hits_any_group(groups: list[list[str]], all_tags: set[str]) -> bool:
    for group in groups:
        for symbol_tag in all_tags:
            for query_tag in group:
                if tag_matches(query_tag, symbol_tag):
                    return True
    return False


def build_tag_groups(data: dict, query_groups: list[list[str]]) -> list[list[str]]:
    tag_metadata = data.get("tagMetadata", {}) or {}
    aliases = tag_metadata.get("aliases", {}) or {}
    categories = tag_metadata.get("categories", {}) or {}
    canonical_set = set(categories.keys()) | set(aliases.values())

    reverse_aliases: dict[str, set[str]] = {}
    for raw, canonical in aliases.items():
        reverse_aliases.setdefault(canonical, set()).add(raw)

    raw_groups: list[set[str]] = []
    for group in query_groups:
        group_set: set[str] = set()
        for raw in group:
            normalized = normalize_tag(raw)
            if not normalized:
                continue
            group_set.add(normalized)
            if normalized in aliases:
                canonical = aliases[normalized]
                group_set.add(canonical)
                group_set.update(reverse_aliases.get(canonical, set()))
            elif normalized in canonical_set:
                group_set.add(normalized)
                group_set.update(reverse_aliases.get(normalized, set()))
        if group_set:
            raw_groups.append(group_set)

    merged_groups = merge_group_sets(raw_groups)
    return [sorted(group) for group in merged_groups if group]


def search_symbols(
    context_dir: str,
    positive_groups: list[list[str]],
    negative_groups: list[list[str]],
    flat_tags: list[str]
):
    routing_path = Path(context_dir) / "routing.json"
    
    if not routing_path.exists():
        print(f"Error: routing.json not found at {routing_path}", file=sys.stderr)
        sys.exit(1)
    
    with open(routing_path, 'r', encoding='utf-8') as f:
        data = json.load(f)
    
    groups = build_tag_groups(data, positive_groups)
    if not groups:
        print("Error: At least one valid tag is required", file=sys.stderr)
        sys.exit(1)
    exclude_groups = build_tag_groups(data, negative_groups) if negative_groups else []

    print("Semantic groups (OR within, AND across):")
    for idx, group in enumerate(groups, 1):
        print(f"  G{idx}: {', '.join(group)}")
    if exclude_groups:
        print("Exclude groups:")
        for idx, group in enumerate(exclude_groups, 1):
            print(f"  X{idx}: {', '.join(group)}")
    print("---")

    results = []
    tag_scores = build_tag_score_map(data.get('tagIndex', {}) or {})
    
    # Search symbols - use unified tags array
    for symbol_id, info in data.get('symbols', {}).items():
        # Use unified tags array (or fallback to legacy for migration)
        symbol_tags = [t.lower() for t in info.get('tags', 
            info.get('tagsBase', []) + info.get('tagsSemantic', []) + info.get('tagsCustom', [])
        )]
        all_tags = set(symbol_tags)
        
        group_matches, matched_tags = match_groups(groups, all_tags)
        if not all(group_matches):
            continue
        if exclude_groups and hits_any_group(exclude_groups, all_tags):
            continue

        match_count = sum(1 for matched in group_matches if matched)
        match_score = sum(tag_scores.get(tag, 0) for tag in matched_tags) + len(matched_tags)
        results.append({
            'symbol_id': symbol_id,
            'file_path': info.get('filePath', 'unknown'),
            'line': info.get('declLine', 0),
            'brief': info.get('brief', 'N/A'),
            'tags': symbol_tags,
            'match_count': match_count,
            'score': match_score
        })
    
    # Sort by score then match count (descending)
    results.sort(key=lambda x: (x['score'], x['match_count']), reverse=True)
    
    # Display results
    if exclude_groups:
        print(f"Searching for tag groups: {', '.join(flat_tags)} (excluding {len(exclude_groups)} group(s))")
    else:
        print(f"Searching for tag groups: {', '.join(flat_tags)}")
    print("---")
    for result in results:
        print(f"{result['file_path']}:{result['line']} - {result['symbol_id']}")
        print(f"  brief: {result['brief']}")
        print(f"  tags: {', '.join(result['tags'])}")
        print(f"  matched: {result['match_count']} tag(s), score: {result['score']}")
        print()
    
    print("---")
    print(f"Found {len(results)} symbol(s)")
    
    # Increment scores for all queried tags
    for tag in flat_tags:
        increment_tag_score(context_dir, tag.lower().strip(), data)
    
    print(f"Tag scores incremented for: {', '.join(flat_tags)}")


def increment_tag_score(context_dir: str, tag: str, data: dict):
    """Increment the score for a tag in categorized tagIndex"""
    tag_index = data.get('tagIndex', {})
    
    # Search in all categories
    for category in ['base', 'semantic', 'custom']:
        cat_index = tag_index.get(category, {})
        if tag in cat_index:
            cat_index[tag]['score'] = cat_index[tag].get('score', 0) + 1
            
            # Save back to file
            routing_path = Path(context_dir) / "routing.json"
            with open(routing_path, 'w', encoding='utf-8') as f:
                json.dump(data, f, indent=2, ensure_ascii=False)
            return


if __name__ == '__main__':
    if len(sys.argv) < 3:
        print("Usage: python search.py <path-to-.ai_context> <tag1> [tag2 ...]", file=sys.stderr)
        sys.exit(1)

    args = sys.argv[1:]

    if len(args) < 2:
        print("Error: At least one tag is required", file=sys.stderr)
        sys.exit(1)

    context_dir = args[0]
    query_tags = args[1:]
    
    if not query_tags:
        print("Error: At least one tag is required", file=sys.stderr)
        sys.exit(1)
    
    positive_groups, negative_groups = parse_query_groups(query_tags)
    if not positive_groups:
        print("Error: At least one positive tag group is required", file=sys.stderr)
        sys.exit(1)
    flat_tags = [normalize_tag(tag) for group in positive_groups for tag in group if normalize_tag(tag)]
    if not flat_tags:
        print("Error: At least one valid tag is required", file=sys.stderr)
        sys.exit(1)

    search_symbols(context_dir, positive_groups, negative_groups, flat_tags)
`;
}
function generateSearchShScript() {
    return `#!/bin/bash
# search.sh - Search symbols by tag groups (delegates to search.py)
# Usage: search.sh <path-to-.ai_context> <tag1> [tag2 ...]

set -e

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"

if command -v python3 >/dev/null 2>&1; then
  python3 "$SCRIPT_DIR/search.py" "$@"
  exit $?
fi

echo "Error: python3 is required to run semantic grouped search." >&2
exit 1
`;
}
/**
 * Write all skills files to output directory
 * NOTE: skills.md and skills_compact.json are no longer generated as we use search scripts.
 */
async function generateSkillsFiles(outDir, symbols, projectName = "Project", options) {
    const forceWrite = options?.force ?? false;
    // Generate SKILL.md and scripts for Claude and Codex (global skills directory)
    const homeDir = process.env.HOME || process.env.USERPROFILE || "";
    if (homeDir) {
        const skillContent = generateClaudeSkillMd();
        const pyScript = generateSearchPyScript();
        const shScript = generateSearchShScript();
        // Skills directories for different AI tools
        const skillsDirs = [
            path_1.default.join(homeDir, ".claude", "skills", SKILL_NAME), // Claude
            path_1.default.join(homeDir, ".codex", "skills", SKILL_NAME) // OpenAI Codex
        ];
        for (const skillDir of skillsDirs) {
            const skillPath = path_1.default.join(skillDir, "SKILL.md");
            const scriptsDir = path_1.default.join(skillDir, "scripts");
            let shouldWrite = forceWrite;
            if (!shouldWrite) {
                try {
                    await (0, promises_1.stat)(skillPath);
                }
                catch {
                    shouldWrite = true;
                }
            }
            if (!shouldWrite) {
                continue;
            }
            await (0, promises_1.mkdir)(skillDir, { recursive: true });
            await (0, promises_1.writeFile)(skillPath, skillContent, "utf8");
            // Deploy scripts
            await (0, promises_1.mkdir)(scriptsDir, { recursive: true });
            await (0, promises_1.writeFile)(path_1.default.join(scriptsDir, "search.py"), pyScript, "utf8");
            await (0, promises_1.writeFile)(path_1.default.join(scriptsDir, "search.sh"), shScript, "utf8");
        }
    }
}
async function removeSkillsFiles() {
    const homeDir = process.env.HOME || process.env.USERPROFILE || "";
    if (!homeDir) {
        return;
    }
    const skillsDirs = [
        path_1.default.join(homeDir, ".claude", "skills", SKILL_NAME),
        path_1.default.join(homeDir, ".codex", "skills", SKILL_NAME),
        path_1.default.join(homeDir, ".claude", "skills", LEGACY_SKILL_NAME),
        path_1.default.join(homeDir, ".codex", "skills", LEGACY_SKILL_NAME)
    ];
    for (const skillDir of skillsDirs) {
        await (0, promises_1.rm)(skillDir, { recursive: true, force: true });
    }
}
