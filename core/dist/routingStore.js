"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.buildRoutingFromModules = buildRoutingFromModules;
exports.loadRouting = loadRouting;
exports.saveRouting = saveRouting;
const path_1 = __importDefault(require("path"));
const promises_1 = require("fs/promises");
function buildRoutingFromModules(moduleEntries) {
    const routing = { modules: {}, symbols: {} };
    for (const [moduleName, entries] of Object.entries(moduleEntries)) {
        routing.modules[moduleName] = `./modules/${moduleName}.md`;
        for (const entry of entries) {
            routing.symbols[entry.id] = {
                module: moduleName,
                declHash: entry.declHash,
                declLine: entry.declLine,
                implLine: entry.implLine
            };
        }
    }
    return routing;
}
async function loadRouting(indexRoot) {
    const routingPath = path_1.default.join(indexRoot, "routing.json");
    try {
        const content = await (0, promises_1.readFile)(routingPath, "utf8");
        return JSON.parse(content);
    }
    catch (error) {
        if (error?.code === "ENOENT") {
            return { modules: {}, symbols: {} };
        }
        throw error;
    }
}
async function saveRouting(indexRoot, routing) {
    const routingPath = path_1.default.join(indexRoot, "routing.json");
    await (0, promises_1.mkdir)(indexRoot, { recursive: true });
    const content = JSON.stringify(routing, null, 2);
    await (0, promises_1.writeFile)(routingPath, content, "utf8");
}
