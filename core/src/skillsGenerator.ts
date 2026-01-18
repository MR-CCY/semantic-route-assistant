import path from "path";
import { mkdir, stat, writeFile } from "fs/promises";
import type { SymbolRecord } from "./v3Types";

/**
 * Generate .skills/find-existing-code/SKILL.md - Claude Skills standard
 */
export function generateClaudeSkillMd(): string {
    return `---
name: find-existing-code
description: 在写新代码前，先查找项目中已有的类似功能
---

# Find Existing Code

## When to Use
- 需要实现新功能时
- 看到可能重复的代码时
- 想了解项目已有能力时

## How It Works
This skill uses a tag-based search system with automatic usage tracking:
- **routing.json**: Contains all symbols with tags and a \`tagIndex\` that tracks tag usage frequency
- **search scripts**: Python/Bash scripts to query symbols by tag and increment tag scores

## Steps
1. 确定要搜索的标签（如 \`http\`, \`async\`, \`cache\` 等）- 可以指定多个标签
2. 选择查询模式：
   - **AND 模式（默认）**：符号必须同时拥有所有标签（精确查找）
   - **OR 模式（-o）**：符号拥有任一标签即可（宽泛探索）
3. 执行搜索脚本：
   - Python (AND): \`python scripts/search.py /path/to/.ai_context tag1 tag2\`
   - Python (OR): \`python scripts/search.py -o /path/to/.ai_context tag1 tag2\`
   - Bash: \`bash scripts/search.sh /path/to/.ai_context tag\`
4. 脚本返回匹配的符号列表（按匹配度排序），并自动增加所有查询标签的 score

## Example
\`\`\`bash
# AND 模式：查找同时有 http 和 async 的异步 HTTP 功能
python scripts/search.py .ai_context http async

# OR 模式：查找所有网络相关功能
python scripts/search.py -o .ai_context http websocket grpc

# Output:
# Searching for tags (AND): http, async
# ---
# src/net/api_client.cpp:42 - net::ApiClient::sendRequest
#   brief: 发送 HTTP 请求到指定 URL
#   tags: http, request, async
#   matched: 2 tag(s)
#
# Found 1 symbol(s)
# Tag scores incremented for: http, async
\`\`\`

## Tag Index
The \`routing.json\` file maintains a \`tagIndex\` with usage statistics:
\`\`\`json
{
  "tagIndex": {
    "http": { "count": 10, "score": 5 },
    "async": { "count": 7, "score": 3 }
  }
}
\`\`\`
- \`count\`: Number of symbols with this tag
- \`score\`: How many times this tag has been searched (auto-incremented)
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
    
    # Search symbols
    for symbol_id, info in data.get('symbols', {}).items():
        tags_semantic = [t.lower() for t in info.get('tagsSemantic', [])]
        tags_base = [t.lower() for t in info.get('tagsBase', [])]
        all_tags = set(tags_semantic + tags_base)
        
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
                    'tags': info.get('tagsSemantic', []) + info.get('tagsBase', []),
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
                    'tags': info.get('tagsSemantic', []) + info.get('tagsBase', []),
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
    """Increment the score for a tag"""
    tag_index = data.get('tagIndex', {})
    
    if tag in tag_index:
        tag_index[tag]['score'] = tag_index[tag].get('score', 0) + 1
        
        # Save back to file
        routing_path = Path(context_dir) / "routing.json"
        with open(routing_path, 'w', encoding='utf-8') as f:
            json.dump(data, f, indent=2, ensure_ascii=False)


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
    projectName: string = "Project"
): Promise<void> {

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

            try {
                // Check if file already exists
                await stat(skillPath);
                // File exists, skip
            } catch {
                // File doesn't exist, create it
                await mkdir(skillDir, { recursive: true });
                await writeFile(skillPath, skillContent, "utf8");

                // Deploy scripts
                await mkdir(scriptsDir, { recursive: true });
                await writeFile(path.join(scriptsDir, "search.py"), pyScript, "utf8");
                await writeFile(path.join(scriptsDir, "search.sh"), shScript, "utf8");

                // Also write copy to local scripts dir for reference/dev
                // (Optional, but good for consistency)
            }
        }
    }
}
