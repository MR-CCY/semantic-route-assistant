"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.registerLanguageAdapter = registerLanguageAdapter;
exports.getLanguageAdapter = getLanguageAdapter;
const registry = new Map();
function registerLanguageAdapter(adapter) {
    registry.set(adapter.id, adapter);
}
function getLanguageAdapter(id) {
    if (id && registry.has(id)) {
        return registry.get(id);
    }
    if (registry.has("cpp")) {
        return registry.get("cpp");
    }
    const first = registry.values().next();
    if (first.done || !first.value) {
        throw new Error("No language adapters registered.");
    }
    return first.value;
}
