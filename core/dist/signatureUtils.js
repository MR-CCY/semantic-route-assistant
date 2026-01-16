"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.normalizeSignature = normalizeSignature;
exports.hashSignature = hashSignature;
const crypto_1 = require("crypto");
function normalizeSignature(signature) {
    return signature
        .replace(/\s+/g, " ")
        .replace(/\s*([(),*&<>:=])\s*/g, "$1")
        .trim();
}
function hashSignature(signature) {
    const normalized = normalizeSignature(signature);
    return (0, crypto_1.createHash)("sha1").update(normalized).digest("hex");
}
