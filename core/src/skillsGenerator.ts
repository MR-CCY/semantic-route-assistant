import path from "path";
import { mkdir, stat, writeFile, rm } from "fs/promises";
import type { SymbolRecord } from "./v3Types";

/**
 * Generate .skills/find-existing-code/SKILL.md - Constraint-based AI Protocol
 * 
 * This Skill enforces a "reuse-first" policy:
 * AI must search for existing capabilities before implementing new code.
 */
function getSkillRootExampleLine(): string {
  const isWindows = process.platform === "win32";
  const codexRoot = isWindows
    ? `%USERPROFILE%\\.codex\\skills\\find-existing-code`
    : `~/.codex/skills/find-existing-code`;
  const claudeRoot = isWindows
    ? `%USERPROFILE%\\.claude\\skills\\find-existing-code`
    : `~/.claude/skills/find-existing-code`;
  return `当前平台示例（Codex）：\`${codexRoot}\`；Claude：\`${claudeRoot}\``;
}

export function generateClaudeSkillMd(): string {
  const skillRootExampleLine = getSkillRootExampleLine();
  return `---
name: find-existing-code
description: 复用优先：新写/重构前先查能力；查找具备某些能力的函数/类也用此技能
---

# Semantic Routing Protocol (low-entropy)

核心原则：
1) 写新代码前 → 先查询能力表，优先复用
2) 重构/修改前 → 先查询依赖，评估影响

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

### Rule 1: 查询优先
写代码前必须执行查询：
\`\`\`bash
python3 <SKILL_ROOT>/scripts/search.py <indexRoot> <tag1> <tag2>
\`\`\`
OR 模式（广泛搜索）：
\`\`\`bash
python3 <SKILL_ROOT>/scripts/search.py -o <indexRoot> <tag1> <tag2>
\`\`\`

### Rule 2: 阅读验证
有匹配时只做三件事：
1) **阅读最小实现**：跳转到 \`filePath:declLine\` 判断能力
2) **确认满足**：能满足就复用，不要改
3) **减少输入**：只汇报能力列表与结论，不贴源码

### Rule 3: 重写审批
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

### Rule 4: 重构影响分析
重构/修改前只输出最小影响面（只回答：谁在调用该函数、谁在使用该类型、数据结构变更影响哪些模块）：

\`\`\`
[REFACTOR] 修改 RoutingJson
[QUERY] python3 <SKILL_ROOT>/scripts/search.py <indexRoot> routing tagIndex
[IMPACT] 列出受影响符号（最多 5 个）
[ACTION] 依次更新所有受影响的函数
\`\`\`

---

## 查询协议（短）

### Step 1: 确定标签
\`\`\`
"发送 HTTP 请求" → http request
"修改路由结构" → routing tagIndex
\`\`\`

---

## 行为示例（最小）

\`\`\`
[QUERY] python3 <SKILL_ROOT>/scripts/search.py <indexRoot> http get
[FOUND] net::ApiClient::get - 发送 HTTP GET 请求
[REVIEW] 阅读 src/net/api_client.cpp:42，确认支持 URL 参数
[ACTION] 直接调用 net::ApiClient::get(url)
\`\`\`

---

## 目标

- **防重复**: 查到匹配时必须复用
- **可重写**: 但需说明原因 + 审批
- **安全重构**: 修改前分析影响范围
- **省 Token**: 只喂能力表，不喂实现细节
`;
}


function generateSearchPyScript(): string {
  return `#!/usr/bin/env python3
"""
search.py - Search symbols by tags and increment tag scores
Usage: 
  python search.py <path-to-.ai_context> <tag1> [tag2 ...]     # AND mode (default)
  python search.py -o <path-to-.ai_context> <tag1> [tag2 ...]  # OR mode
"""

import json
import sys
from pathlib import Path


def search_symbols(context_dir: str, query_tags: list[str], use_or: bool = False):
    routing_path = Path(context_dir) / "routing.json"
    
    if not routing_path.exists():
        print(f"Error: routing.json not found at {routing_path}", file=sys.stderr)
        sys.exit(1)
    
    with open(routing_path, 'r', encoding='utf-8') as f:
        data = json.load(f)
    
    query_set = {tag.lower().strip() for tag in query_tags}
    results = []
    
    # Search symbols - use unified tags array
    for symbol_id, info in data.get('symbols', {}).items():
        # Use unified tags array (or fallback to legacy for migration)
        symbol_tags = [t.lower() for t in info.get('tags', 
            info.get('tagsBase', []) + info.get('tagsSemantic', []) + info.get('tagsCustom', [])
        )]
        all_tags = set(symbol_tags)
        
        # Calculate matches
        matched_tags = []
        for query_tag in query_set:
            for symbol_tag in all_tags:
                if query_tag in symbol_tag or symbol_tag in query_tag:
                    matched_tags.append(symbol_tag)
                    break
        
        # Apply AND/OR logic
        if use_or:
            # OR: at least one tag matches
            if matched_tags:
                results.append({
                    'symbol_id': symbol_id,
                    'file_path': info.get('filePath', 'unknown'),
                    'line': info.get('declLine', 0),
                    'brief': info.get('brief', 'N/A'),
                    'tags': symbol_tags,
                    'match_count': len(matched_tags)
                })
        else:
            # AND: all tags must match
            if len(matched_tags) >= len(query_set):
                results.append({
                    'symbol_id': symbol_id,
                    'file_path': info.get('filePath', 'unknown'),
                    'line': info.get('declLine', 0),
                    'brief': info.get('brief', 'N/A'),
                    'tags': symbol_tags,
                    'match_count': len(matched_tags)
                })
    
    # Sort by match count (descending)
    results.sort(key=lambda x: x['match_count'], reverse=True)
    
    # Display results
    mode_str = "OR" if use_or else "AND"
    print(f"Searching for tags ({mode_str}): {', '.join(query_tags)}")
    print("---")
    for result in results:
        print(f"{result['file_path']}:{result['line']} - {result['symbol_id']}")
        print(f"  brief: {result['brief']}")
        print(f"  tags: {', '.join(result['tags'])}")
        print(f"  matched: {result['match_count']} tag(s)")
        print()
    
    print("---")
    print(f"Found {len(results)} symbol(s)")
    
    # Increment scores for all queried tags
    for tag in query_tags:
        increment_tag_score(context_dir, tag.lower().strip(), data)
    
    print(f"Tag scores incremented for: {', '.join(query_tags)}")


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
        print("Usage: python search.py [-o] <path-to-.ai_context> <tag1> [tag2 ...]", file=sys.stderr)
        print("  -o: Use OR mode (default is AND)", file=sys.stderr)
        sys.exit(1)
    
    use_or = sys.argv[1] == '-o'
    start_idx = 2 if use_or else 1
    
    context_dir = sys.argv[start_idx]
    query_tags = sys.argv[start_idx + 1:]
    
    if not query_tags:
        print("Error: At least one tag is required", file=sys.stderr)
        sys.exit(1)
    
    search_symbols(context_dir, query_tags, use_or)
`;
}

function generateSearchShScript(): string {
  return `#!/bin/bash
# search.sh - Search symbols by tag and increment tag score
# Usage: search.sh <path-to-.ai_context> <tag>

set -e

CONTEXT_DIR="$1"
QUERY_TAG="$2"

if [ -z "$CONTEXT_DIR" ] || [ -z "$QUERY_TAG" ]; then
  echo "Usage: search.sh <path-to-.ai_context> <tag>"
  exit 1
fi

ROUTING_JSON="$CONTEXT_DIR/routing.json"

if [ ! -f "$ROUTING_JSON" ]; then
  echo "Error: routing.json not found at $ROUTING_JSON"
  exit 1
fi

# Normalize query tag to lowercase
QUERY_LOWER=$(echo "$QUERY_TAG" | tr '[:upper:]' '[:lower:]')

# Search for symbols with matching tags
echo "Searching for tag: $QUERY_TAG"
echo "---"

# Use jq if available, otherwise fallback to grep
if command -v jq &> /dev/null; then
  jq -r --arg tag "$QUERY_LOWER" '
    .symbols | to_entries[] |
    select(
      (.value.tagsSemantic // [] | map(ascii_downcase) | any(. == $tag or contains($tag) or ($tag | contains(.)))) or
      (.value.tagsBase // [] | map(ascii_downcase) | any(. == $tag or contains($tag) or ($tag | contains(.))))
    ) |
    "\(.value.filePath // "unknown"):\(.value.declLine // 0) - \(.key)\\n  brief: \(.value.brief // "N/A")\\n  tags: \((.value.tagsSemantic // []) + (.value.tagsBase // []) | join(", "))"
  ' "$ROUTING_JSON"
else
  # Fallback: simple grep-based search
  grep -i "\\"\\$QUERY_LOWER\\"" "$ROUTING_JSON" | head -20
fi

echo ""
echo "---"
echo "Tag search completed. Score incremented for: $QUERY_TAG"

# Increment score using Node.js (if available)
if command -v node &> /dev/null; then
  node << 'EOF'
    const fs = require('fs');
    const contextDir = process.argv[1];
    const tag = process.argv[2].toLowerCase().trim();
    const routingPath = \`\${contextDir}/routing.json\`;
    
    try {
      const data = JSON.parse(fs.readFileSync(routingPath, 'utf8'));
      if (data.tagIndex && data.tagIndex[tag]) {
        data.tagIndex[tag].score = (data.tagIndex[tag].score || 0) + 1;
        fs.writeFileSync(routingPath, JSON.stringify(data, null, 2), 'utf8');
      }
    } catch (err) {
      // Silent failure - tag scoring is non-critical
    }
EOF
fi
`;
}

/**
 * Write all skills files to output directory
 * NOTE: skills.md and skills_compact.json are no longer generated as we use search scripts.
 */
export async function generateSkillsFiles(
  outDir: string,
  symbols: SymbolRecord[],
  projectName: string = "Project",
  options?: {
    force?: boolean;
  }
): Promise<void> {
  const forceWrite = options?.force ?? false;

  // Generate SKILL.md and scripts for Claude and Codex (global skills directory)
  const homeDir = process.env.HOME || process.env.USERPROFILE || "";
  if (homeDir) {
    const skillName = "find-existing-code";
    const skillContent = generateClaudeSkillMd();
    const pyScript = generateSearchPyScript();
    const shScript = generateSearchShScript();

    // Skills directories for different AI tools
    const skillsDirs = [
      path.join(homeDir, ".claude", "skills", skillName),  // Claude
      path.join(homeDir, ".codex", "skills", skillName)    // OpenAI Codex
    ];

    for (const skillDir of skillsDirs) {
      const skillPath = path.join(skillDir, "SKILL.md");
      const scriptsDir = path.join(skillDir, "scripts");
      let shouldWrite = forceWrite;

      if (!shouldWrite) {
        try {
          await stat(skillPath);
        } catch {
          shouldWrite = true;
        }
      }

      if (!shouldWrite) {
        continue;
      }

      await mkdir(skillDir, { recursive: true });
      await writeFile(skillPath, skillContent, "utf8");

      // Deploy scripts
      await mkdir(scriptsDir, { recursive: true });
      await writeFile(path.join(scriptsDir, "search.py"), pyScript, "utf8");
      await writeFile(path.join(scriptsDir, "search.sh"), shScript, "utf8");
    }
  }
}

export async function removeSkillsFiles(): Promise<void> {
  const homeDir = process.env.HOME || process.env.USERPROFILE || "";
  if (!homeDir) {
    return;
  }

  const skillName = "find-existing-code";
  const skillsDirs = [
    path.join(homeDir, ".claude", "skills", skillName),
    path.join(homeDir, ".codex", "skills", skillName)
  ];

  for (const skillDir of skillsDirs) {
    await rm(skillDir, { recursive: true, force: true });
  }
}
