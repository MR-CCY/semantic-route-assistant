"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.extractImplementationFromCode = extractImplementationFromCode;
exports.extractImplementationForSymbol = extractImplementationForSymbol;
const path_1 = __importDefault(require("path"));
const promises_1 = require("fs/promises");
const MAX_LINES = 200;
const MAX_CHARS = 12000;
const TRUNCATION_MARKER = "// ... truncated ...";
function extractFunctionName(signature) {
    const matches = signature.match(/([~A-Za-z_][\w:]*)\s*\(/g);
    if (!matches || matches.length === 0) {
        return null;
    }
    const last = matches[matches.length - 1];
    return last.replace(/\s*\(/, "").trim();
}
function findImplementationBlock(code, name) {
    let index = 0;
    while (index < code.length) {
        const found = code.indexOf(name, index);
        if (found === -1) {
            return null;
        }
        const before = code[found - 1];
        const after = code[found + name.length];
        if ((before && /\w/.test(before)) || (after && /\w/.test(after))) {
            index = found + name.length;
            continue;
        }
        const openParen = code.indexOf("(", found + name.length);
        if (openParen === -1) {
            return null;
        }
        let parenDepth = 0;
        let cursor = openParen;
        for (; cursor < code.length; cursor += 1) {
            const ch = code[cursor];
            if (ch === "(")
                parenDepth += 1;
            if (ch === ")") {
                parenDepth -= 1;
                if (parenDepth === 0) {
                    cursor += 1;
                    break;
                }
            }
        }
        if (parenDepth !== 0) {
            return null;
        }
        while (cursor < code.length && /\s/.test(code[cursor])) {
            cursor += 1;
        }
        if (code[cursor] === "c") {
            const maybeConst = code.slice(cursor, cursor + 5);
            if (maybeConst === "const") {
                cursor += 5;
                while (cursor < code.length && /\s/.test(code[cursor])) {
                    cursor += 1;
                }
            }
        }
        if (code[cursor] === "n") {
            const maybeNoexcept = code.slice(cursor, cursor + 8);
            if (maybeNoexcept === "noexcept") {
                cursor += 8;
                while (cursor < code.length && /\s/.test(code[cursor])) {
                    cursor += 1;
                }
            }
        }
        if (code[cursor] !== "{") {
            index = found + name.length;
            continue;
        }
        const blockStart = code.lastIndexOf("\n", found);
        let braceDepth = 0;
        let end = cursor;
        for (; end < code.length; end += 1) {
            const ch = code[end];
            if (ch === "{")
                braceDepth += 1;
            if (ch === "}") {
                braceDepth -= 1;
                if (braceDepth === 0) {
                    end += 1;
                    break;
                }
            }
        }
        if (braceDepth !== 0) {
            return null;
        }
        return code.slice(blockStart + 1, end).trim();
    }
    return null;
}
function sampleLines(lines) {
    const markerLines = 2;
    const budget = Math.max(1, MAX_LINES - markerLines);
    const headCount = Math.max(1, Math.floor(budget * 0.4));
    const midCount = Math.max(1, Math.floor(budget * 0.2));
    const tailCount = Math.max(1, budget - headCount - midCount);
    const headEnd = headCount;
    const tailStart = Math.max(headEnd + midCount, lines.length - tailCount);
    let midStart = Math.floor((lines.length - midCount) / 2);
    if (midStart < headEnd) {
        midStart = headEnd;
    }
    if (midStart + midCount > tailStart) {
        midStart = Math.max(headEnd, tailStart - midCount);
    }
    const head = lines.slice(0, headEnd);
    const mid = lines.slice(midStart, midStart + midCount);
    const tail = lines.slice(tailStart);
    return [
        ...head,
        TRUNCATION_MARKER,
        ...mid,
        TRUNCATION_MARKER,
        ...tail
    ].join("\n");
}
function sampleChars(text) {
    const marker = `\n${TRUNCATION_MARKER}\n`;
    const budget = Math.max(1, MAX_CHARS - marker.length * 2);
    const headCount = Math.max(1, Math.floor(budget * 0.4));
    const midCount = Math.max(1, Math.floor(budget * 0.2));
    const tailCount = Math.max(1, budget - headCount - midCount);
    let midStart = Math.floor((text.length - midCount) / 2);
    if (midStart < headCount) {
        midStart = headCount;
    }
    const tailStart = Math.max(midStart + midCount, text.length - tailCount);
    const head = text.slice(0, headCount);
    const mid = text.slice(midStart, midStart + midCount);
    const tail = text.slice(tailStart);
    return `${head}${marker}${mid}${marker}${tail}`;
}
function truncateImplementation(implementation) {
    if (!implementation) {
        return implementation;
    }
    const lines = implementation.split("\n");
    const withinLineLimit = lines.length <= MAX_LINES;
    const withinCharLimit = implementation.length <= MAX_CHARS;
    if (withinLineLimit && withinCharLimit) {
        return implementation;
    }
    let sampled = implementation;
    if (!withinLineLimit) {
        sampled = sampleLines(lines);
    }
    if (sampled.length > MAX_CHARS) {
        sampled = sampleChars(sampled);
    }
    return sampled;
}
function extractImplementationFromCode(code, signature) {
    const name = extractFunctionName(signature);
    if (!name) {
        return null;
    }
    const implementation = findImplementationBlock(code, name);
    if (!implementation) {
        return null;
    }
    return truncateImplementation(implementation);
}
async function extractImplementationForSymbol(input) {
    const fullPath = path_1.default.join(input.projectRoot, input.filePath);
    let code = "";
    try {
        code = await (0, promises_1.readFile)(fullPath, "utf8");
    }
    catch {
        return { implementation: null };
    }
    const implementation = extractImplementationFromCode(code, input.signature);
    return { implementation };
}
