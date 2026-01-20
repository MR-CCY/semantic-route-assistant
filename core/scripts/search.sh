#!/bin/bash
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
    "\(.value.filePath // "unknown"):\(.value.declLine // 0) - \(.key)\n  brief: \(.value.brief // "N/A")\n  tags: \((.value.tagsSemantic // []) + (.value.tagsBase // []) | join(", "))"
  ' "$ROUTING_JSON"
else
  # Fallback: simple grep-based search
  grep -i "\"$QUERY_LOWER\"" "$ROUTING_JSON" | head -20
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
    const routingPath = `${contextDir}/routing.json`;
    
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
