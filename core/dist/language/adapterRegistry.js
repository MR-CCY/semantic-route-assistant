"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.registerLanguageAdapter = registerLanguageAdapter;
exports.getLanguageAdapter = getLanguageAdapter;
exports.getAdapterForFile = getAdapterForFile;
exports.getAllAdapters = getAllAdapters;
exports.getSupportedExtensions = getSupportedExtensions;
const registry = new Map();
const extensionMap = new Map();
function registerLanguageAdapter(adapter) {
    registry.set(adapter.id, adapter);
    // Register file extensions
    for (const ext of adapter.fileExtensions) {
        extensionMap.set(ext.toLowerCase(), adapter);
    }
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
/**
 * Get the appropriate language adapter for a file based on its extension.
 * @param filePath - The file path (absolute or relative)
 * @returns The matching adapter, or null if no adapter handles this file type
 */
function getAdapterForFile(filePath) {
    const ext = filePath.split(".").pop()?.toLowerCase();
    if (!ext) {
        return null;
    }
    return extensionMap.get(ext) || null;
}
/**
 * Get all registered language adapters.
 */
function getAllAdapters() {
    return Array.from(registry.values());
}
/**
 * Get all file extensions that have registered adapters.
 */
function getSupportedExtensions() {
    return Array.from(extensionMap.keys());
}
