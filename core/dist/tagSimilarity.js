"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.resolveSimilarTags = resolveSimilarTags;
const path_1 = __importDefault(require("path"));
const promises_1 = require("fs/promises");
const routingStore_1 = require("./routingStore");
const openaiCompat_1 = require("./llm/openaiCompat");
const TAG_VECTOR_FILE = "tag_vectors.json";
const DEFAULT_EMBEDDING_MODEL = "text-embedding-3-small";
const QWEN_DEFAULT_EMBEDDING_MODEL = "text-embedding-v2";
const DEFAULT_MIN_SCORE = 0.75;
const DEFAULT_TOP_K = 3;
const DEFAULT_BATCH_SIZE = 64;
const QWEN_MAX_BATCH_SIZE = 25;
function resolveEmbeddingModel(provider) {
    const configured = process.env.SRCA_LLM_EMBEDDING_MODEL || "";
    if (configured) {
        return configured;
    }
    if (provider === "qwen") {
        return QWEN_DEFAULT_EMBEDDING_MODEL;
    }
    return DEFAULT_EMBEDDING_MODEL;
}
function resolveBatchSize(provider) {
    if (provider === "qwen") {
        return QWEN_MAX_BATCH_SIZE;
    }
    return DEFAULT_BATCH_SIZE;
}
function normalizeTag(tag) {
    return tag.trim().toLowerCase();
}
function normalizeVector(vector) {
    let sum = 0;
    for (const value of vector) {
        sum += value * value;
    }
    if (sum <= 0) {
        return vector;
    }
    const inv = 1 / Math.sqrt(sum);
    return vector.map((value) => value * inv);
}
function cosineSimilarity(a, b) {
    const len = Math.min(a.length, b.length);
    let dot = 0;
    for (let i = 0; i < len; i += 1) {
        dot += a[i] * b[i];
    }
    return dot;
}
async function loadTagVectors(indexRoot) {
    const filePath = path_1.default.join(indexRoot, TAG_VECTOR_FILE);
    try {
        const content = await (0, promises_1.readFile)(filePath, "utf8");
        return JSON.parse(content);
    }
    catch {
        return null;
    }
}
async function saveTagVectors(indexRoot, data) {
    await (0, promises_1.mkdir)(indexRoot, { recursive: true });
    const filePath = path_1.default.join(indexRoot, TAG_VECTOR_FILE);
    await (0, promises_1.writeFile)(filePath, JSON.stringify(data, null, 2), "utf8");
}
async function embedTexts(texts) {
    const provider = process.env.SRCA_LLM_PROVIDER || "";
    const apiKey = process.env.SRCA_LLM_API_KEY || "";
    const baseUrl = process.env.SRCA_LLM_BASE_URL || "";
    const model = resolveEmbeddingModel(provider);
    if (!provider || !apiKey) {
        return null;
    }
    const resolvedBaseUrl = (0, openaiCompat_1.resolveBaseUrl)(provider, baseUrl);
    if (!resolvedBaseUrl) {
        return null;
    }
    try {
        return await (0, openaiCompat_1.callOpenAIEmbedding)({
            apiKey,
            baseUrl: resolvedBaseUrl,
            model,
            input: texts
        });
    }
    catch (error) {
        console.warn("[tagSimilarity] embedding failed", error);
        return null;
    }
}
async function ensureTagVectors(indexRoot, tags) {
    const normalizedTags = tags.map(normalizeTag).filter(Boolean);
    if (!normalizedTags.length) {
        return null;
    }
    const provider = process.env.SRCA_LLM_PROVIDER || "";
    const model = resolveEmbeddingModel(provider);
    const batchSize = resolveBatchSize(provider);
    let store = await loadTagVectors(indexRoot);
    if (!store || store.model !== model) {
        store = {
            model,
            dimension: 0,
            updatedAt: new Date().toISOString(),
            tags: {}
        };
    }
    const missing = normalizedTags.filter((tag) => !store.tags[tag]);
    if (!missing.length) {
        return store;
    }
    const batches = [];
    for (let i = 0; i < missing.length; i += batchSize) {
        batches.push(missing.slice(i, i + batchSize));
    }
    for (const batch of batches) {
        const vectors = await embedTexts(batch);
        if (!vectors || vectors.length !== batch.length) {
            return store;
        }
        vectors.forEach((vector, index) => {
            const normalized = normalizeVector(vector);
            store.tags[batch[index]] = normalized;
            if (!store.dimension) {
                store.dimension = normalized.length;
            }
        });
    }
    store.updatedAt = new Date().toISOString();
    await saveTagVectors(indexRoot, store);
    return store;
}
async function resolveSimilarTags(indexRoot, queryTags, options) {
    const routing = await (0, routingStore_1.loadRouting)(indexRoot);
    const tagIndex = routing.tagIndex || { base: {}, semantic: {}, custom: {} };
    const allTags = new Set([
        ...Object.keys(tagIndex.base || {}),
        ...Object.keys(tagIndex.semantic || {}),
        ...Object.keys(tagIndex.custom || {})
    ]);
    const normalizedQueries = queryTags.map(normalizeTag).filter(Boolean);
    if (!normalizedQueries.length || allTags.size === 0) {
        return { resolvedTags: normalizedQueries, matches: [] };
    }
    const store = await ensureTagVectors(indexRoot, Array.from(allTags));
    if (!store) {
        return { resolvedTags: normalizedQueries, matches: [] };
    }
    const queryVectors = await embedTexts(normalizedQueries);
    if (!queryVectors || queryVectors.length !== normalizedQueries.length) {
        return { resolvedTags: normalizedQueries, matches: [] };
    }
    const normalizedQueriesVec = queryVectors.map(normalizeVector);
    const tagEntries = Object.entries(store.tags);
    const topK = Math.max(1, Math.floor(options?.topK ?? DEFAULT_TOP_K));
    const minScore = options?.minScore ?? DEFAULT_MIN_SCORE;
    const resolvedTags = [];
    const matches = [];
    normalizedQueriesVec.forEach((vector, index) => {
        const query = normalizedQueries[index];
        if (allTags.has(query)) {
            resolvedTags.push(query);
            return;
        }
        const scored = tagEntries
            .map(([tag, vec]) => ({ tag, score: cosineSimilarity(vector, vec) }))
            .sort((a, b) => b.score - a.score)
            .slice(0, topK);
        const best = scored[0];
        if (best && best.score >= minScore) {
            resolvedTags.push(best.tag);
            matches.push({
                query,
                resolved: best.tag,
                score: best.score,
                candidates: scored
            });
        }
        else {
            resolvedTags.push(query);
        }
    });
    const deduped = Array.from(new Set(resolvedTags));
    return { resolvedTags: deduped, matches };
}
