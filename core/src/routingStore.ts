import path from "path";
import { mkdir, readFile, writeFile } from "fs/promises";

export type TagIndexEntry = {
  count: number;  // Number of symbols using this tag
  score: number;  // Usage frequency (incremented by search script)
};

export type TagType = "base" | "semantic" | "custom";

export type TagChange = string | { tag: string; tagType?: TagType };

export const ROUTING_SCHEMA_VERSION = 4;

/**
 * Categorized tag index - groups tags by type
 */
export type CategorizedTagIndex = {
  base: Record<string, TagIndexEntry>;
  semantic: Record<string, TagIndexEntry>;
  custom: Record<string, TagIndexEntry>;
};

/**
 * Category metadata for canonical tags
 */
export type TagCategory = {
  count: number;
};

/**
 * Tag metadata for alias mapping and category management
 */
export type TagMetadata = {
  aliases: Record<string, string>;           // raw -> canonical
  categories: Record<string, TagCategory>;   // canonical -> info
  version: number;
};

export function createEmptyTagMetadata(): TagMetadata {
  return {
    aliases: {},
    categories: {},
    version: 1
  };
}

function normalizeTagMetadata(tagMetadata?: TagMetadata): { normalized: TagMetadata; changed: boolean } {
  const hasAliases = Boolean(tagMetadata && tagMetadata.aliases && typeof tagMetadata.aliases === "object");
  const hasCategories = Boolean(tagMetadata && tagMetadata.categories && typeof tagMetadata.categories === "object");
  const hasVersion = typeof tagMetadata?.version === "number";
  const normalized: TagMetadata = {
    aliases: tagMetadata?.aliases ?? {},
    categories: tagMetadata?.categories ?? {},
    version: hasVersion ? tagMetadata!.version : 1
  };
  return {
    normalized,
    changed: !tagMetadata || !hasAliases || !hasCategories || !hasVersion
  };
}

export type RoutingJson = {
  schemaVersion?: number;
  tagIndex: CategorizedTagIndex;
  tagMetadata?: TagMetadata;
  symbols: {
    [symbolId: string]: {
      module: string;
      declHash: string;
      implHash?: string;
      declLine?: number;
      implLine?: number;
      filePath?: string;
      signature?: string;
      brief?: string;
      tags?: string[];
      // Legacy fields (for migration)
      tagsBase?: string[];
      tagsSemantic?: string[];
      tagsCustom?: string[];
    };
  };
};

/**
 * Helper to create empty categorized tag index
 */
function createEmptyTagIndex(): CategorizedTagIndex {
  return { base: {}, semantic: {}, custom: {} };
}

/**
 * Helper to get or create tag entry in categorized index
 */
function getTagEntry(tagIndex: CategorizedTagIndex, tag: string, tagType: TagType): TagIndexEntry {
  if (!tagIndex[tagType][tag]) {
    tagIndex[tagType][tag] = { count: 0, score: 0 };
  }
  return tagIndex[tagType][tag];
}

/**
 * Helper to find tag type in categorized index
 */
export function findTagType(tagIndex: CategorizedTagIndex, tag: string): TagType | undefined {
  if (tagIndex.base[tag]) return "base";
  if (tagIndex.semantic[tag]) return "semantic";
  if (tagIndex.custom[tag]) return "custom";
  return undefined;
}

/**
 * Helper to get tag entry from any category
 */
export function getTagFromAnyCategory(tagIndex: CategorizedTagIndex, tag: string): TagIndexEntry | undefined {
  return tagIndex.base[tag] || tagIndex.semantic[tag] || tagIndex.custom[tag];
}

export function buildRoutingFromModules(
  moduleEntries: Record<
    string,
    Array<{
      id: string;
      declHash: string;
      implHash?: string;
      declLine?: number;
      implLine?: number;
      filePath?: string;
      signature?: string;
      brief?: string;
      tagsBase?: string[];
      tagsSemantic?: string[];
      tagsCustom?: string[];
    }>
  >,
  existingTagIndex?: CategorizedTagIndex,
  existingTagMetadata?: TagMetadata
): RoutingJson {
  const routing: RoutingJson = {
    schemaVersion: ROUTING_SCHEMA_VERSION,
    tagIndex: createEmptyTagIndex(),
    tagMetadata: existingTagMetadata ?? createEmptyTagMetadata(),
    symbols: {}
  };

  for (const [moduleName, entries] of Object.entries(moduleEntries)) {
    for (const entry of entries) {
      // Merge all tags into unified array
      const allTags = [
        ...(entry.tagsBase || []),
        ...(entry.tagsSemantic || []),
        ...(entry.tagsCustom || [])
      ].map(t => t.toLowerCase().trim()).filter(Boolean);

      // Remove duplicates
      const uniqueTags = [...new Set(allTags)];

      routing.symbols[entry.id] = {
        module: moduleName,
        declHash: entry.declHash,
        implHash: entry.implHash,
        declLine: entry.declLine,
        implLine: entry.implLine,
        filePath: entry.filePath,
        signature: entry.signature,
        brief: entry.brief,
        tags: uniqueTags
      };

      // Count tags by type in tagIndex
      for (const tag of entry.tagsBase || []) {
        const normalized = tag.toLowerCase().trim();
        if (!normalized) continue;
        const entry = getTagEntry(routing.tagIndex, normalized, "base");
        entry.count++;
        // Preserve existing score
        if (existingTagIndex?.base[normalized]) {
          entry.score = existingTagIndex.base[normalized].score;
        }
      }
      for (const tag of entry.tagsSemantic || []) {
        const normalized = tag.toLowerCase().trim();
        if (!normalized) continue;
        const entry = getTagEntry(routing.tagIndex, normalized, "semantic");
        entry.count++;
        if (existingTagIndex?.semantic[normalized]) {
          entry.score = existingTagIndex.semantic[normalized].score;
        }
      }
      for (const tag of entry.tagsCustom || []) {
        const normalized = tag.toLowerCase().trim();
        if (!normalized) continue;
        const entry = getTagEntry(routing.tagIndex, normalized, "custom");
        entry.count++;
        if (existingTagIndex?.custom[normalized]) {
          entry.score = existingTagIndex.custom[normalized].score;
        }
      }
    }
  }

  return routing;
}

/**
 * Rebuild categorized tagIndex from symbols (for migration)
 * Also migrates legacy tagsBase/tagsSemantic/tagsCustom to unified tags array
 */
function migrateAndRebuildTagIndex(routing: RoutingJson): CategorizedTagIndex {
  const tagIndex = createEmptyTagIndex();

  // Check if this is v2 format (flat tagIndex) - need to preserve scores
  const legacyScores = new Map<string, number>();
  if (routing.tagIndex && !("base" in routing.tagIndex)) {
    // v2 format: flat tagIndex
    const flatIndex = routing.tagIndex as unknown as Record<string, TagIndexEntry>;
    for (const [tag, entry] of Object.entries(flatIndex)) {
      legacyScores.set(tag, entry.score || 0);
    }
  }

  for (const [symbolId, info] of Object.entries(routing.symbols || {})) {
    // Process legacy tag arrays and build categorized index
    const baseTags = info.tagsBase || [];
    const semanticTags = info.tagsSemantic || [];
    const customTags = info.tagsCustom || [];

    // Migrate to unified tags array if not present
    if (!info.tags || info.tags.length === 0) {
      const allTags = [...baseTags, ...semanticTags, ...customTags]
        .map(t => t.toLowerCase().trim())
        .filter(Boolean);
      info.tags = [...new Set(allTags)];
    }

    // Update tagIndex with type info
    for (const tag of baseTags) {
      const normalized = tag.toLowerCase().trim();
      if (!normalized) continue;
      const entry = getTagEntry(tagIndex, normalized, "base");
      entry.count++;
      entry.score = legacyScores.get(normalized) || entry.score;
    }
    for (const tag of semanticTags) {
      const normalized = tag.toLowerCase().trim();
      if (!normalized) continue;
      const entry = getTagEntry(tagIndex, normalized, "semantic");
      entry.count++;
      entry.score = legacyScores.get(normalized) || entry.score;
    }
    for (const tag of customTags) {
      const normalized = tag.toLowerCase().trim();
      if (!normalized) continue;
      const entry = getTagEntry(tagIndex, normalized, "custom");
      entry.count++;
      entry.score = legacyScores.get(normalized) || entry.score;
    }

    // Clear legacy fields after migration
    delete info.tagsBase;
    delete info.tagsSemantic;
    delete info.tagsCustom;
  }

  return tagIndex;
}

function normalizeRouting(routing: RoutingJson): { routing: RoutingJson; migrated: boolean } {
  let migrated = false;
  const currentVersion = routing.schemaVersion ?? 1;

  if (currentVersion > ROUTING_SCHEMA_VERSION) {
    throw new Error(`Unsupported routing schema version: ${currentVersion}`);
  }

  // Migrate from v1/v2 to v3
  if (currentVersion < ROUTING_SCHEMA_VERSION) {
    routing.tagIndex = migrateAndRebuildTagIndex(routing);
    routing.schemaVersion = ROUTING_SCHEMA_VERSION;
    migrated = true;
  } else if (!routing.tagIndex || !("base" in routing.tagIndex)) {
    // Ensure v3 structure
    routing.tagIndex = createEmptyTagIndex();
    migrated = true;
  }

  const normalizedMetadata = normalizeTagMetadata(routing.tagMetadata);
  if (normalizedMetadata.changed) {
    routing.tagMetadata = normalizedMetadata.normalized;
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
        tagIndex: createEmptyTagIndex(),
        tagMetadata: createEmptyTagMetadata(),
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

  // Find tag in any category and increment score
  const tagType = findTagType(routing.tagIndex, normalizedTag);
  if (tagType) {
    routing.tagIndex[tagType][normalizedTag].score++;
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
 * Add a tag to a symbol (defaults to semantic type)
 */
export async function addSymbolTag(
  indexRoot: string,
  symbolId: string,
  tag: string,
  tagType: TagType = "semantic"
): Promise<void> {
  const routing = await loadRouting(indexRoot);
  const symbol = routing.symbols[symbolId];
  if (symbol) {
    const normalizedTag = tag.toLowerCase().trim();
    if (!normalizedTag) return;

    // Initialize tags if not present
    if (!symbol.tags) {
      symbol.tags = [];
    }

    // Avoid duplicates
    if (!symbol.tags.includes(normalizedTag)) {
      symbol.tags.push(normalizedTag);

      // Update categorized tag index
      const entry = getTagEntry(routing.tagIndex, normalizedTag, tagType);
      entry.count++;

      await saveRouting(indexRoot, routing);
    }
  }
}

/**
 * Remove a tag from a symbol
 */
export async function removeSymbolTag(indexRoot: string, symbolId: string, tag: string): Promise<void> {
  const routing = await loadRouting(indexRoot);
  const symbol = routing.symbols[symbolId];
  if (symbol && symbol.tags) {
    const normalizedTag = tag.toLowerCase().trim();
    const index = symbol.tags.indexOf(normalizedTag);
    if (index !== -1) {
      symbol.tags.splice(index, 1);

      // Update categorized tag index
      const tagType = findTagType(routing.tagIndex, normalizedTag);
      if (tagType) {
        routing.tagIndex[tagType][normalizedTag].count = Math.max(
          0,
          routing.tagIndex[tagType][normalizedTag].count - 1
        );
      }

      await saveRouting(indexRoot, routing);
    }
  }
}

/**
 * Batch update symbol tags (add and remove in one atomic operation)
 * Uses unified tags array and categorized tagIndex
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

  // Initialize tags array if not present
  if (!symbol.tags) {
    symbol.tags = [];
  }

  const normalizeTagChange = (
    change: TagChange,
    fallbackType: TagType = "semantic"
  ): { tag: string; tagType: TagType } | null => {
    const rawTag = typeof change === "string" ? change : change.tag;
    const tagType =
      typeof change === "string" ? fallbackType : change.tagType || fallbackType;
    const normalizedTag = rawTag?.toLowerCase().trim();
    if (!normalizedTag) {
      return null;
    }
    return { tag: normalizedTag, tagType };
  };

  // Remove tags first
  for (const change of tagsToRemove) {
    const normalized = normalizeTagChange(change);
    if (!normalized) continue;

    const { tag: tagToRemove } = normalized;
    const idx = symbol.tags.indexOf(tagToRemove);
    if (idx !== -1) {
      symbol.tags.splice(idx, 1);
      // Update index count
      const existingType = findTagType(routing.tagIndex, tagToRemove);
      if (existingType) {
        routing.tagIndex[existingType][tagToRemove].count = Math.max(
          0,
          routing.tagIndex[existingType][tagToRemove].count - 1
        );
      }
    }
  }

  // Add new tags
  for (const change of tagsToAdd) {
    const normalized = normalizeTagChange(change);
    if (!normalized) continue;

    const { tag: tagToAdd, tagType } = normalized;
    if (!symbol.tags.includes(tagToAdd)) {
      symbol.tags.push(tagToAdd);
      // Update categorized index
      const entry = getTagEntry(routing.tagIndex, tagToAdd, tagType);
      entry.count++;
    }
  }

  await saveRouting(indexRoot, routing);
}

export async function saveRouting(indexRoot: string, routing: RoutingJson): Promise<void> {
  const routingPath = path.join(indexRoot, "routing.json");
  await mkdir(indexRoot, { recursive: true });
  routing.schemaVersion = ROUTING_SCHEMA_VERSION;
  const content = JSON.stringify(routing, null, 2);
  await writeFile(routingPath, content, "utf8");
}
