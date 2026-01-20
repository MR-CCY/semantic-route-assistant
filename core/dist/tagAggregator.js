"use strict";
/**
 * Tag Aggregator - LLM-based semantic tag clustering
 *
 * This module handles incremental tag aggregation using LLM:
 * - Detects unknown tags (not in existing alias map)
 * - Batches unknown tags for LLM processing (100 per batch)
 * - Updates alias map and categories
 * - Cleans up unused aliases
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.createEmptyTagMetadata = void 0;
exports.findUnknownTags = findUnknownTags;
exports.aggregateTagsBatch = aggregateTagsBatch;
exports.aggregateAllUnknownTags = aggregateAllUnknownTags;
exports.ensureCategoriesForTags = ensureCategoriesForTags;
exports.updateCategoryCounts = updateCategoryCounts;
exports.cleanupUnusedAliases = cleanupUnusedAliases;
exports.mergeTagMetadata = mergeTagMetadata;
const openaiCompat_1 = require("./llm/openaiCompat");
const tagNormalizer_1 = require("./tagNormalizer");
var routingStore_1 = require("./routingStore");
Object.defineProperty(exports, "createEmptyTagMetadata", { enumerable: true, get: function () { return routingStore_1.createEmptyTagMetadata; } });
/**
 * Default batch size for LLM aggregation
 */
const AGGREGATION_BATCH_SIZE = 100;
const MAX_CATEGORY_CONTEXT = 50;
const AGGREGATION_CONCURRENCY_DEFAULT = 4;
function isAggregationEnabled() {
    const raw = process.env.SRCA_LLM_AGGREGATION_ENABLED;
    if (!raw) {
        return true;
    }
    const value = raw.trim().toLowerCase();
    return !["0", "false", "off", "no"].includes(value);
}
function pickRandomCategories(categories, limit) {
    if (categories.length <= limit) {
        return categories;
    }
    const shuffled = [...categories];
    for (let i = shuffled.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
    }
    return shuffled.slice(0, limit);
}
async function runWithConcurrency(items, limit, worker) {
    let nextIndex = 0;
    async function runNext() {
        const current = nextIndex;
        if (current >= items.length) {
            return;
        }
        nextIndex += 1;
        await worker(items[current], current);
        await runNext();
    }
    const runners = Array.from({ length: Math.min(limit, items.length) }, () => runNext());
    await Promise.all(runners);
}
/**
 * Find tags that are not in the known alias map
 *
 * @param tags - Array of normalized tags
 * @param knownAliases - Existing alias mappings
 * @param knownCategories - Existing canonical categories
 * @returns Array of unknown tags
 */
function findUnknownTags(tags, knownAliases, knownCategories) {
    const unknown = [];
    const knownKeys = new Set(Object.keys(knownAliases));
    const knownValues = new Set(Object.values(knownAliases));
    const knownCanonicals = new Set(Object.keys(knownCategories || {}));
    for (const tag of tags) {
        if (!tag) {
            continue;
        }
        const isKnownKey = knownKeys.has(tag);
        const isKnownValue = knownValues.has(tag);
        const isKnownCanonical = knownCanonicals.has(tag);
        if (!isKnownKey && !isKnownValue && !isKnownCanonical) {
            unknown.push(tag);
        }
    }
    return [...new Set(unknown)];
}
/**
 * Build the prompt for LLM tag aggregation
 */
function buildAggregationPrompt(unknownTags, existingCategories) {
    const categoriesForPrompt = pickRandomCategories(existingCategories, MAX_CATEGORY_CONTEXT);
    const categoriesSection = existingCategories.length > 0
        ? `现有:${categoriesForPrompt.join(", ")}\n`
        : "";
    return `${categoriesSection}新:${unknownTags.join(", ")}
返回 JSON:{ "category": ["tag1","tag2"] }`;
}
/**
 * Parse LLM response for aggregation result
 */
function parseAggregationResponse(text) {
    // Extract JSON from response
    const start = text.indexOf("{");
    const end = text.lastIndexOf("}");
    if (start === -1 || end === -1 || end <= start) {
        return null;
    }
    const normalizeGroups = (raw) => {
        const groups = {};
        for (const [category, tags] of Object.entries(raw)) {
            const name = category.trim();
            if (!name) {
                continue;
            }
            const list = Array.isArray(tags) ? tags : [];
            const normalized = list
                .map((tag) => (typeof tag === "string" ? tag.trim() : ""))
                .filter(Boolean);
            if (normalized.length > 0) {
                groups[name] = [...new Set(normalized)];
            }
        }
        return groups;
    };
    const groupsFromMappings = (raw) => {
        const groups = {};
        for (const [tag, canonical] of Object.entries(raw)) {
            if (typeof tag !== "string" || typeof canonical !== "string") {
                continue;
            }
            const canonicalName = canonical.trim();
            const tagName = tag.trim();
            if (!canonicalName || !tagName) {
                continue;
            }
            if (!groups[canonicalName]) {
                groups[canonicalName] = [];
            }
            groups[canonicalName].push(tagName);
        }
        for (const [category, tags] of Object.entries(groups)) {
            groups[category] = [...new Set(tags)];
        }
        return groups;
    };
    try {
        const jsonText = text.slice(start, end + 1);
        const parsed = JSON.parse(jsonText);
        if (!parsed || typeof parsed !== "object") {
            return null;
        }
        let groups = {};
        if ("groups" in parsed && parsed.groups && typeof parsed.groups === "object") {
            groups = normalizeGroups(parsed.groups);
        }
        else if ("mappings" in parsed && parsed.mappings && typeof parsed.mappings === "object") {
            groups = groupsFromMappings(parsed.mappings);
        }
        else {
            groups = normalizeGroups(parsed);
        }
        if (Object.keys(groups).length === 0) {
            return null;
        }
        return { groups };
    }
    catch {
        return null;
    }
}
/**
 * Aggregate a batch of unknown tags using LLM
 *
 * @param unknownTags - Array of unknown tags (max 100)
 * @param existingCategories - List of existing canonical categories
 * @returns Aggregation result with category groups
 */
async function aggregateTagsBatch(unknownTags, existingCategories) {
    const provider = process.env.SRCA_LLM_PROVIDER;
    const apiKey = process.env.SRCA_LLM_API_KEY;
    const model = process.env.SRCA_LLM_MODEL || "gpt-4o-mini";
    const baseUrl = process.env.SRCA_LLM_BASE_URL || "";
    const buildIdentityGroups = (tags) => {
        const groups = {};
        for (const tag of tags) {
            if (!tag) {
                continue;
            }
            groups[tag] = [tag];
        }
        return groups;
    };
    const placeholderCategories = new Set(["category", "categories", "other", "misc"]);
    const isPlaceholderOnly = (groups) => {
        const keys = Object.keys(groups);
        if (keys.length === 0) {
            return false;
        }
        return keys.every((key) => placeholderCategories.has(key.trim().toLowerCase()));
    };
    if (!isAggregationEnabled()) {
        return { groups: buildIdentityGroups(unknownTags) };
    }
    // If LLM is not configured, return identity mapping
    if (!provider || !apiKey) {
        return { groups: buildIdentityGroups(unknownTags) };
    }
    const resolvedBaseUrl = (0, openaiCompat_1.resolveBaseUrl)(provider, baseUrl);
    if (!resolvedBaseUrl) {
        return { groups: buildIdentityGroups(unknownTags) };
    }
    const prompt = buildAggregationPrompt(unknownTags, existingCategories);
    const systemPrompt = "你是代码标签聚类助手。仅同义/翻译/格式变体合并(中英同义可合并);其他保留或新建;不泛化;不得丢标签;类别名可中文或 snake_case 英文;禁用占位名 category/other/misc;只输出 JSON;偏好中文。";
    const payload = {
        model,
        temperature: 0,
        max_tokens: 2048,
        messages: [
            {
                role: "system",
                content: systemPrompt
            },
            {
                role: "user",
                content: prompt
            }
        ]
    };
    try {
        console.log(`[tagAggregator] LLM prompt system=${systemPrompt}`);
        console.log(`[tagAggregator] LLM prompt user=${prompt}`);
        const text = await (0, openaiCompat_1.callOpenAICompatible)({
            apiKey,
            baseUrl: resolvedBaseUrl,
            payload
        });
        if (text) {
            console.log(`[tagAggregator] LLM raw response tags=${unknownTags.length} text=${text}`);
            const result = parseAggregationResponse(text);
            if (result) {
                if (isPlaceholderOnly(result.groups)) {
                    console.warn("[tagAggregator] LLM returned placeholder categories, falling back to identity mapping.");
                }
                else {
                    return result;
                }
            }
        }
    }
    catch (error) {
        console.warn("[tagAggregator] LLM call failed:", error);
    }
    // Fallback: identity mapping
    return { groups: buildIdentityGroups(unknownTags) };
}
/**
 * Aggregate all unknown tags with batching
 *
 * @param unknownTags - All unknown tags to process
 * @param metadata - Existing tag metadata
 * @param onProgress - Optional progress callback
 * @returns Updated tag metadata
 */
async function aggregateAllUnknownTags(unknownTags, metadata, onProgress) {
    if (unknownTags.length === 0) {
        return metadata;
    }
    if (!isAggregationEnabled()) {
        const categories = { ...metadata.categories };
        for (const tag of unknownTags) {
            if (!tag || categories[tag]) {
                continue;
            }
            categories[tag] = { count: 0 };
        }
        return {
            aliases: { ...metadata.aliases },
            categories,
            version: metadata.version
        };
    }
    // Create a mutable copy of metadata
    const updatedMetadata = {
        aliases: { ...metadata.aliases },
        categories: { ...metadata.categories },
        version: metadata.version
    };
    // Freeze existing categories for all batches
    const existingCategories = [...new Set(Object.keys(updatedMetadata.categories))];
    // Process in batches
    const totalBatches = Math.ceil(unknownTags.length / AGGREGATION_BATCH_SIZE);
    const concurrencyEnv = Number(process.env.SRCA_LLM_AGGREGATION_CONCURRENCY ?? "");
    const concurrency = Number.isFinite(concurrencyEnv)
        ? Math.max(1, Math.floor(concurrencyEnv))
        : AGGREGATION_CONCURRENCY_DEFAULT;
    const batches = [];
    for (let i = 0; i < totalBatches; i++) {
        const start = i * AGGREGATION_BATCH_SIZE;
        const end = Math.min(start + AGGREGATION_BATCH_SIZE, unknownTags.length);
        const batch = unknownTags.slice(start, end);
        batches.push({ batch, batchIndex: i + 1 });
    }
    let completed = 0;
    let applyChain = Promise.resolve();
    await runWithConcurrency(batches, Math.min(concurrency, totalBatches), async (item) => {
        const { batch, batchIndex } = item;
        const isFirst = batchIndex === 1;
        const isSecond = batchIndex === 2;
        if (isFirst) {
            console.log(`[tagAggregation] 开始第一次聚合 batch=${batchIndex}/${totalBatches} tags=${batch.length} totalTags=${unknownTags.length}`);
        }
        else if (isSecond) {
            console.log(`[tagAggregation] 开始第二次聚合 batch=${batchIndex}/${totalBatches} tags=${batch.length} totalTags=${unknownTags.length}`);
        }
        const result = await aggregateTagsBatch(batch, existingCategories);
        completed += 1;
        if (onProgress) {
            onProgress({ current: completed, total: totalBatches });
        }
        else {
            console.log(`[tagAggregation] 进度 ${completed}/${totalBatches}`);
        }
        applyChain = applyChain.then(() => {
            const mappedTags = new Set();
            const batchSet = new Set(batch);
            const groupCount = Object.keys(result.groups).length;
            console.log(`[tagAggregation] 聚合结果 batch=${batchIndex}/${totalBatches} groups=${groupCount} detail=${JSON.stringify(result.groups)}`);
            for (const [canonicalRaw, tags] of Object.entries(result.groups)) {
                const canonical = (0, tagNormalizer_1.localNormalize)(canonicalRaw) ?? canonicalRaw.trim().toLowerCase();
                if (!canonical) {
                    continue;
                }
                if (!updatedMetadata.categories[canonical]) {
                    updatedMetadata.categories[canonical] = {
                        count: 0
                    };
                }
                const list = Array.isArray(tags) ? tags : [];
                for (const rawTag of list) {
                    if (typeof rawTag !== "string") {
                        continue;
                    }
                    const normalizedTag = (0, tagNormalizer_1.localNormalize)(rawTag) ?? rawTag.trim().toLowerCase();
                    if (!normalizedTag || !batchSet.has(normalizedTag)) {
                        continue;
                    }
                    mappedTags.add(normalizedTag);
                    if (normalizedTag !== canonical) {
                        updatedMetadata.aliases[normalizedTag] = canonical;
                    }
                }
            }
            for (const tag of batch) {
                const normalizedTag = tag.trim().toLowerCase();
                if (!normalizedTag || mappedTags.has(normalizedTag)) {
                    continue;
                }
                if (!updatedMetadata.categories[normalizedTag]) {
                    updatedMetadata.categories[normalizedTag] = {
                        count: 0
                    };
                }
            }
            if (isFirst) {
                console.log(`[tagAggregation] 结束第一次聚合 batch=${batchIndex}/${totalBatches} groups=${groupCount} aliases=${Object.keys(updatedMetadata.aliases).length}`);
            }
            else if (isSecond) {
                console.log(`[tagAggregation] 结束第二次聚合 batch=${batchIndex}/${totalBatches} groups=${groupCount} aliases=${Object.keys(updatedMetadata.aliases).length}`);
            }
        });
    });
    await applyChain;
    return updatedMetadata;
}
/**
 * Ensure every canonical tag has a category entry
 *
 * @param metadata - Tag metadata to update
 * @param canonicalTags - Array of canonical tags to ensure
 * @returns Updated metadata with missing categories added
 */
function ensureCategoriesForTags(metadata, canonicalTags) {
    let changed = false;
    const categories = { ...metadata.categories };
    for (const tag of canonicalTags) {
        if (!tag) {
            continue;
        }
        if (!categories[tag]) {
            categories[tag] = {
                count: 0
            };
            changed = true;
        }
    }
    if (!changed) {
        return metadata;
    }
    return {
        aliases: metadata.aliases,
        categories,
        version: metadata.version
    };
}
/**
 * Update category counts based on current symbol tags
 *
 * @param metadata - Tag metadata to update
 * @param allCanonicalTags - Array of all canonical tags from all symbols
 * @returns Updated metadata with correct counts
 */
function updateCategoryCounts(metadata, allCanonicalTags) {
    // Reset all counts
    for (const cat of Object.values(metadata.categories)) {
        cat.count = 0;
    }
    // Count occurrences
    for (const tag of allCanonicalTags) {
        if (metadata.categories[tag]) {
            metadata.categories[tag].count++;
        }
    }
    return metadata;
}
/**
 * Remove unused aliases (those pointing to categories with count=0)
 *
 * @param metadata - Tag metadata to clean
 * @returns Cleaned metadata
 */
function cleanupUnusedAliases(metadata) {
    const cleanedAliases = {};
    const cleanedCategories = {};
    // Keep categories with count > 0
    for (const [name, cat] of Object.entries(metadata.categories)) {
        if (cat.count > 0) {
            cleanedCategories[name] = cat;
        }
    }
    // Keep aliases that point to valid categories
    for (const [tag, canonical] of Object.entries(metadata.aliases)) {
        if (cleanedCategories[canonical]) {
            cleanedAliases[tag] = canonical;
        }
    }
    return {
        aliases: cleanedAliases,
        categories: cleanedCategories,
        version: metadata.version
    };
}
/**
 * Merge new metadata into existing metadata
 *
 * @param existing - Existing tag metadata
 * @param incoming - New tag metadata to merge
 * @returns Merged metadata
 */
function mergeTagMetadata(existing, incoming) {
    return {
        aliases: { ...existing.aliases, ...incoming.aliases },
        categories: { ...existing.categories, ...incoming.categories },
        version: Math.max(existing.version, incoming.version)
    };
}
