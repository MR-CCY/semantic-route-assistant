"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.searchSkills = searchSkills;
const path_1 = __importDefault(require("path"));
const fast_glob_1 = __importDefault(require("fast-glob"));
const promises_1 = require("fs/promises");
function countOccurrences(haystack, needle) {
    if (!needle)
        return 0;
    let count = 0;
    let index = 0;
    while (index !== -1) {
        index = haystack.indexOf(needle, index);
        if (index !== -1) {
            count += 1;
            index += needle.length || 1;
        }
    }
    return count;
}
function extractTitle(firstLine, fallback) {
    const trimmed = firstLine.trim();
    if (trimmed.startsWith("# ")) {
        return trimmed.slice(2).trim();
    }
    return fallback;
}
async function searchSkills(indexRoot, query) {
    const lowerQuery = query.toLowerCase();
    const entries = await (0, fast_glob_1.default)("**/*.md", {
        cwd: indexRoot,
        absolute: true,
        dot: false,
        ignore: [".meta.json"]
    });
    const results = [];
    for (const absolutePath of entries) {
        const content = await (0, promises_1.readFile)(absolutePath, "utf8");
        const relativePath = path_1.default.relative(indexRoot, absolutePath);
        const [firstLine = ""] = content.split("\n");
        const title = extractTitle(firstLine, relativePath);
        let score = 0;
        if (lowerQuery && title.toLowerCase().includes(lowerQuery)) {
            score += 3;
        }
        if (lowerQuery) {
            const occurrences = countOccurrences(content.toLowerCase(), lowerQuery);
            score += occurrences;
        }
        const preview = content.slice(0, 240);
        results.push({
            path: relativePath,
            score,
            title,
            preview
        });
    }
    results.sort((a, b) => b.score - a.score);
    return results;
}
