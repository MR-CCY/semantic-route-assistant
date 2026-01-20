#!/usr/bin/env python3
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
    tag = re.sub(r"[\s\-\.]+", "_", tag)
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

    with open(routing_path, "r", encoding="utf-8") as f:
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
    tag_scores = build_tag_score_map(data.get("tagIndex", {}) or {})

    # Search symbols - use unified tags array
    for symbol_id, info in data.get("symbols", {}).items():
        symbol_tags = [t.lower() for t in info.get("tags",
            info.get("tagsBase", []) + info.get("tagsSemantic", []) + info.get("tagsCustom", [])
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
            "symbol_id": symbol_id,
            "file_path": info.get("filePath", "unknown"),
            "line": info.get("declLine", 0),
            "brief": info.get("brief", "N/A"),
            "tags": symbol_tags,
            "match_count": match_count,
            "score": match_score
        })

    results.sort(key=lambda x: (x["score"], x["match_count"]), reverse=True)

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

    for tag in flat_tags:
        increment_tag_score(context_dir, tag.lower().strip(), data)

    print(f"Tag scores incremented for: {', '.join(flat_tags)}")


def increment_tag_score(context_dir: str, tag: str, data: dict):
    """Increment the score for a tag in categorized tagIndex"""
    tag_index = data.get("tagIndex", {})

    for category in ["base", "semantic", "custom"]:
        cat_index = tag_index.get(category, {})
        if tag in cat_index:
            cat_index[tag]["score"] = cat_index[tag].get("score", 0) + 1
            routing_path = Path(context_dir) / "routing.json"
            with open(routing_path, "w", encoding="utf-8") as f:
                json.dump(data, f, indent=2, ensure_ascii=False)
            return


if __name__ == "__main__":
    if len(sys.argv) < 3:
        print("Usage: python search.py <path-to-.ai_context> <tag1> [tag2 ...]", file=sys.stderr)
        sys.exit(1)

    args = sys.argv[1:]

    if len(args) < 2:
        print("Error: At least one tag is required", file=sys.stderr)
        sys.exit(1)

    context_dir = args[0]
    query_tags = args[1:]
    positive_groups, negative_groups = parse_query_groups(query_tags)
    if not positive_groups:
        print("Error: At least one positive tag group is required", file=sys.stderr)
        sys.exit(1)
    flat_tags = [
        normalize_tag(tag)
        for group in positive_groups
        for tag in group
        if normalize_tag(tag)
    ]
    if not flat_tags:
        print("Error: At least one valid tag is required", file=sys.stderr)
        sys.exit(1)

    search_symbols(context_dir, positive_groups, negative_groups, flat_tags)
