import path from "path";
import { mkdir, readFile, writeFile } from "fs/promises";

export type TagIndexEntry = {
  count: number;  // Number of symbols using this tag
  score: number;  // Usage frequency (incremented by search script)
};

export type TagType = "base" | "semantic" | "custom";

export type TagChange = string | { tag: string; tagType?: TagType };

export const ROUTING_SCHEMA_VERSION = 2;

export type RoutingJson = {
  schemaVersion?: number;
  modules: {
    [moduleName: string]: string;
  };
  tagIndex: {
    [tag: string]: TagIndexEntry;
  };
  symbols: {
    [symbolId: string]: {
      module: string;
      declHash: string;
      declLine?: number;
      implLine?: number;
      filePath?: string;
      signature?: string;
      brief?: string;
      tagsBase?: string[];
      tagsSemantic?: string[];
      tagsCustom?: string[];
      tags?: string[];
    };
  };
};

export function buildRoutingFromModules(
  moduleEntries: Record<
    string,
    Array<{
      id: string;
      declHash: string;
      declLine?: number;
      implLine?: number;
      filePath?: string;
      signature?: string;
      brief?: string;
      tagsBase?: string[];
      tagsSemantic?: string[];
      tagsCustom?: string[];
      tags?: string[];
    }>
  >,
  existingTagIndex?: Record<string, TagIndexEntry>
): RoutingJson {
  const routing: RoutingJson = {
    schemaVersion: ROUTING_SCHEMA_VERSION,
    modules: {},
    tagIndex: {},
    symbols: {}
  };
  const tagCounts = new Map<string, number>();

  for (const [moduleName, entries] of Object.entries(moduleEntries)) {
    routing.modules[moduleName] = `./modules/${moduleName}.md`;
    for (const entry of entries) {
      routing.symbols[entry.id] = {
        module: moduleName,
        declHash: entry.declHash,
        declLine: entry.declLine,
        implLine: entry.implLine,
        filePath: entry.filePath,
        signature: entry.signature,
        brief: entry.brief,
        tagsBase: entry.tagsBase,
        tagsSemantic: entry.tagsSemantic,
        tagsCustom: entry.tagsCustom,
        tags: entry.tags
      };

      // Count tag usage
      const allTags = [
        ...(entry.tagsSemantic || []),
        ...(entry.tagsBase || []),
        ...(entry.tagsCustom || []),
        ...(entry.tags || [])
      ];
      for (const tag of allTags) {
        const normalized = tag.toLowerCase().trim();
        if (normalized) {
          tagCounts.set(normalized, (tagCounts.get(normalized) || 0) + 1);
        }
      }
    }
  }

  // Build tagIndex, preserving scores from existing index
  for (const [tag, count] of tagCounts) {
    routing.tagIndex[tag] = {
      count,
      score: existingTagIndex?.[tag]?.score || 0
    };
  }

  return routing;
}

function rebuildTagIndex(routing: RoutingJson): Record<string, TagIndexEntry> {
  const tagCounts = new Map<string, number>();

  for (const info of Object.values(routing.symbols || {})) {
    const allTags = [
      ...(info.tagsSemantic || []),
      ...(info.tagsBase || []),
      ...(info.tagsCustom || []),
      ...(info.tags || [])
    ];
    for (const tag of allTags) {
      const normalized = tag.toLowerCase().trim();
      if (!normalized) {
        continue;
      }
      tagCounts.set(normalized, (tagCounts.get(normalized) || 0) + 1);
    }
  }

  const nextIndex: Record<string, TagIndexEntry> = {};
  const existingIndex = routing.tagIndex || {};

  for (const [tag, count] of tagCounts) {
    nextIndex[tag] = {
      count,
      score: existingIndex[tag]?.score || 0
    };
  }

  for (const [tag, entry] of Object.entries(existingIndex)) {
    if (!nextIndex[tag]) {
      nextIndex[tag] = { count: 0, score: entry.score || 0 };
    }
  }

  return nextIndex;
}

function normalizeRouting(routing: RoutingJson): { routing: RoutingJson; migrated: boolean } {
  let migrated = false;
  const currentVersion = routing.schemaVersion ?? 1;

  if (currentVersion > ROUTING_SCHEMA_VERSION) {
    throw new Error(`Unsupported routing schema version: ${currentVersion}`);
  }

  if (!routing.tagIndex) {
    routing.tagIndex = {};
    migrated = true;
  }

  if (currentVersion < ROUTING_SCHEMA_VERSION) {
    routing.tagIndex = rebuildTagIndex(routing);
    routing.schemaVersion = ROUTING_SCHEMA_VERSION;
    migrated = true;
  } else if (routing.schemaVersion !== ROUTING_SCHEMA_VERSION) {
    routing.schemaVersion = ROUTING_SCHEMA_VERSION;
    migrated = true;
  }

  return { routing, migrated };
}

export async function loadRouting(indexRoot: string): Promise<RoutingJson> {
  const routingPath = path.join(indexRoot, "routing.json");
  try {
    const content = await readFile(routingPath, "utf8");
    const data = JSON.parse(content) as RoutingJson;
    const normalized = normalizeRouting(data);
    if (normalized.migrated) {
      await saveRouting(indexRoot, normalized.routing);
    }
    return normalized.routing;
  } catch (error: any) {
    if (error?.code === "ENOENT") {
      return {
        schemaVersion: ROUTING_SCHEMA_VERSION,
        modules: {},
        tagIndex: {},
        symbols: {}
      };
    }
    throw error;
  }
}

/**
 * Increment score for a tag (called by search script)
 */
export async function incrementTagScore(indexRoot: string, tag: string): Promise<void> {
  const routing = await loadRouting(indexRoot);
  const normalizedTag = tag.toLowerCase().trim();
  if (routing.tagIndex[normalizedTag]) {
    routing.tagIndex[normalizedTag].score++;
    await saveRouting(indexRoot, routing);
  }
}

/**
 * Update symbol description
 */
export async function updateSymbolDescription(indexRoot: string, symbolId: string, description: string): Promise<void> {
  const routing = await loadRouting(indexRoot);
  if (routing.symbols[symbolId]) {
    routing.symbols[symbolId].brief = description;
    await saveRouting(indexRoot, routing);
  }
}

/**
 * Add a semantic tag to a symbol
 */
export async function addSymbolTag(indexRoot: string, symbolId: string, tag: string): Promise<void> {
  const routing = await loadRouting(indexRoot);
  const symbol = routing.symbols[symbolId];
  if (symbol) {
    const normalizedTag = tag.toLowerCase().trim();
    if (!normalizedTag) return;

    // Initialize tagsSemantic if not present
    if (!symbol.tagsSemantic) {
      symbol.tagsSemantic = [];
    }

    // Avoid duplicates
    if (!symbol.tagsSemantic.includes(normalizedTag)) {
      symbol.tagsSemantic.push(normalizedTag);

      // Update tag index
      if (!routing.tagIndex[normalizedTag]) {
        routing.tagIndex[normalizedTag] = { count: 0, score: 0 };
      }
      routing.tagIndex[normalizedTag].count++;

      await saveRouting(indexRoot, routing);
    }
  }
}

/**
 * Remove a semantic tag from a symbol
 */
export async function removeSymbolTag(indexRoot: string, symbolId: string, tag: string): Promise<void> {
  const routing = await loadRouting(indexRoot);
  const symbol = routing.symbols[symbolId];
  if (symbol && symbol.tagsSemantic) {
    const normalizedTag = tag.toLowerCase().trim();
    const index = symbol.tagsSemantic.indexOf(normalizedTag);
    if (index !== -1) {
      symbol.tagsSemantic.splice(index, 1);

      // Update tag index
      if (routing.tagIndex[normalizedTag]) {
        routing.tagIndex[normalizedTag].count = Math.max(0, routing.tagIndex[normalizedTag].count - 1);
        // Optional: remove tag from index if count is 0? Maybe keep it for history/search score.
      }

      await saveRouting(indexRoot, routing);
    }
  }
}

/**
 * Batch update symbol tags (add and remove in one atomic operation)
 */
export async function updateSymbolTags(
  indexRoot: string,
  symbolId: string,
  tagsToAdd: TagChange[],
  tagsToRemove: TagChange[]
): Promise<void> {
  const routing = await loadRouting(indexRoot);
  const symbol = routing.symbols[symbolId];

  if (!symbol) {
    return;
  }

  const tagIndex = routing.tagIndex || (routing.tagIndex = {});

  const normalizeTagChange = (
    change: TagChange,
    fallbackType?: TagType
  ): { tag: string; tagType?: TagType } | null => {
    const rawTag = typeof change === "string" ? change : change.tag;
    const tagType =
      typeof change === "string" ? fallbackType : change.tagType || fallbackType;
    const normalizedTag = rawTag?.toLowerCase().trim();
    if (!normalizedTag) {
      return null;
    }
    return { tag: normalizedTag, tagType };
  };

  const getTagList = (tagType: TagType, create: boolean): string[] | undefined => {
    if (tagType === "semantic") {
      if (!symbol.tagsSemantic && create) {
        symbol.tagsSemantic = [];
      }
      return symbol.tagsSemantic;
    }
    if (tagType === "base") {
      if (!symbol.tagsBase && create) {
        symbol.tagsBase = [];
      }
      return symbol.tagsBase;
    }
    if (!symbol.tagsCustom && create) {
      symbol.tagsCustom = [];
    }
    return symbol.tagsCustom;
  };

  const removeTag = (tag: string, tagType?: TagType) => {
    const types: TagType[] = tagType ? [tagType] : ["semantic", "base", "custom"];
    for (const type of types) {
      const list = getTagList(type, false);
      if (!list) {
        continue;
      }
      const index = list.indexOf(tag);
      if (index === -1) {
        continue;
      }
      list.splice(index, 1);
      if (tagIndex[tag]) {
        tagIndex[tag].count = Math.max(0, tagIndex[tag].count - 1);
      }
    }
  };

  const addTag = (tag: string, tagType: TagType) => {
    const list = getTagList(tagType, true)!;
    if (list.includes(tag)) {
      return;
    }
    list.push(tag);
    if (!tagIndex[tag]) {
      tagIndex[tag] = { count: 0, score: 0 };
    }
    tagIndex[tag].count++;
  };

  // Remove tags first
  tagsToRemove.forEach((change) => {
    const normalized = normalizeTagChange(change);
    if (!normalized) {
      return;
    }
    removeTag(normalized.tag, normalized.tagType);
  });

  // Add new tags (legacy callers default to semantic)
  tagsToAdd.forEach((change) => {
    const normalized = normalizeTagChange(change, "semantic");
    if (!normalized) {
      return;
    }
    addTag(normalized.tag, normalized.tagType || "semantic");
  });

  await saveRouting(indexRoot, routing);
}

export async function saveRouting(indexRoot: string, routing: RoutingJson): Promise<void> {
  const routingPath = path.join(indexRoot, "routing.json");
  await mkdir(indexRoot, { recursive: true });
  routing.schemaVersion = ROUTING_SCHEMA_VERSION;
  const content = JSON.stringify(routing, null, 2);
  await writeFile(routingPath, content, "utf8");
}
