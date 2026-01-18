#!/usr/bin/env python3
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

