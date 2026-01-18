"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.ROUTING_SCHEMA_VERSION = void 0;
exports.buildRoutingFromModules = buildRoutingFromModules;
exports.loadRouting = loadRouting;
exports.incrementTagScore = incrementTagScore;
exports.updateSymbolDescription = updateSymbolDescription;
exports.addSymbolTag = addSymbolTag;
exports.removeSymbolTag = removeSymbolTag;
exports.updateSymbolTags = updateSymbolTags;
exports.saveRouting = saveRouting;
const path_1 = __importDefault(require("path"));
const promises_1 = require("fs/promises");
exports.ROUTING_SCHEMA_VERSION = 2;
function buildRoutingFromModules(moduleEntries, existingTagIndex) {
    const routing = {
        schemaVersion: exports.ROUTING_SCHEMA_VERSION,
        modules: {},
        tagIndex: {},
        symbols: {}
    };
    const tagCounts = new Map();
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
function rebuildTagIndex(routing) {
    const tagCounts = new Map();
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
    const nextIndex = {};
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
function normalizeRouting(routing) {
    let migrated = false;
    const currentVersion = routing.schemaVersion ?? 1;
    if (currentVersion > exports.ROUTING_SCHEMA_VERSION) {
        throw new Error(`Unsupported routing schema version: ${currentVersion}`);
    }
    if (!routing.tagIndex) {
        routing.tagIndex = {};
        migrated = true;
    }
    if (currentVersion < exports.ROUTING_SCHEMA_VERSION) {
        routing.tagIndex = rebuildTagIndex(routing);
        routing.schemaVersion = exports.ROUTING_SCHEMA_VERSION;
        migrated = true;
    }
    else if (routing.schemaVersion !== exports.ROUTING_SCHEMA_VERSION) {
        routing.schemaVersion = exports.ROUTING_SCHEMA_VERSION;
        migrated = true;
    }
    return { routing, migrated };
}
async function loadRouting(indexRoot) {
    const routingPath = path_1.default.join(indexRoot, "routing.json");
    try {
        const content = await (0, promises_1.readFile)(routingPath, "utf8");
        const data = JSON.parse(content);
        const normalized = normalizeRouting(data);
        if (normalized.migrated) {
            await saveRouting(indexRoot, normalized.routing);
        }
        return normalized.routing;
    }
    catch (error) {
        if (error?.code === "ENOENT") {
            return {
                schemaVersion: exports.ROUTING_SCHEMA_VERSION,
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
async function incrementTagScore(indexRoot, tag) {
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
async function updateSymbolDescription(indexRoot, symbolId, description) {
    const routing = await loadRouting(indexRoot);
    if (routing.symbols[symbolId]) {
        routing.symbols[symbolId].brief = description;
        await saveRouting(indexRoot, routing);
    }
}
/**
 * Add a semantic tag to a symbol
 */
async function addSymbolTag(indexRoot, symbolId, tag) {
    const routing = await loadRouting(indexRoot);
    const symbol = routing.symbols[symbolId];
    if (symbol) {
        const normalizedTag = tag.toLowerCase().trim();
        if (!normalizedTag)
            return;
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
async function removeSymbolTag(indexRoot, symbolId, tag) {
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
async function updateSymbolTags(indexRoot, symbolId, tagsToAdd, tagsToRemove) {
    const routing = await loadRouting(indexRoot);
    const symbol = routing.symbols[symbolId];
    if (!symbol) {
        return;
    }
    const tagIndex = routing.tagIndex || (routing.tagIndex = {});
    const normalizeTagChange = (change, fallbackType) => {
        const rawTag = typeof change === "string" ? change : change.tag;
        const tagType = typeof change === "string" ? fallbackType : change.tagType || fallbackType;
        const normalizedTag = rawTag?.toLowerCase().trim();
        if (!normalizedTag) {
            return null;
        }
        return { tag: normalizedTag, tagType };
    };
    const getTagList = (tagType, create) => {
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
    const removeTag = (tag, tagType) => {
        const types = tagType ? [tagType] : ["semantic", "base", "custom"];
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
    const addTag = (tag, tagType) => {
        const list = getTagList(tagType, true);
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
async function saveRouting(indexRoot, routing) {
    const routingPath = path_1.default.join(indexRoot, "routing.json");
    await (0, promises_1.mkdir)(indexRoot, { recursive: true });
    routing.schemaVersion = exports.ROUTING_SCHEMA_VERSION;
    const content = JSON.stringify(routing, null, 2);
    await (0, promises_1.writeFile)(routingPath, content, "utf8");
}
