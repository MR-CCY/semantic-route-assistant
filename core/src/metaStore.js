"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.loadMeta = loadMeta;
exports.saveMeta = saveMeta;
const path_1 = __importDefault(require("path"));
const promises_1 = require("fs/promises");
const META_FILENAME = ".meta.json";
async function loadMeta(indexRoot) {
    const metaPath = path_1.default.join(indexRoot, META_FILENAME);
    try {
        const content = await (0, promises_1.readFile)(metaPath, "utf8");
        return JSON.parse(content);
    }
    catch (error) {
        if (error?.code === "ENOENT") {
            return {};
        }
        throw error;
    }
}
async function saveMeta(indexRoot, meta) {
    const metaPath = path_1.default.join(indexRoot, META_FILENAME);
    await (0, promises_1.mkdir)(indexRoot, { recursive: true });
    const content = JSON.stringify(meta, null, 2);
    await (0, promises_1.writeFile)(metaPath, content, "utf8");
}
//# sourceMappingURL=metaStore.js.map