import type { ExtractedSymbol } from "../symbolExtractor";
import type {
  ImplementationInput,
  ImplementationResult
} from "../extract/implementationExtractor";

export type BaseTagsInput = {
  symbolId: string;
  signature: string;
  filePath: string;
  kind?: "function" | "class";
  pathModuleHint?: string;
};

export type LanguageAdapter = {
  id: string;
  displayName: string;
  /**
   * File extensions this adapter handles (without leading dot).
   * Example: ["js", "jsx", "ts", "tsx"]
   */
  fileExtensions: string[];
  scanSourceFiles: (projectRoot: string) => Promise<string[]>;
  extractSymbolsFromCode: (code: string, filePath: string) => ExtractedSymbol[];
  extractImplementationFromCode: (code: string, signature: string) => string | null;
  extractImplementationForSymbol: (
    input: ImplementationInput
  ) => Promise<ImplementationResult>;
  inferPathModuleHint: (filePath: string) => string;
  /**
   * Infer base tags from symbol information.
   * Each language adapter can implement language-specific tag inference.
   */
  inferBaseTags: (input: BaseTagsInput) => string[];
};

const registry = new Map<string, LanguageAdapter>();
const extensionMap = new Map<string, LanguageAdapter>();

export function registerLanguageAdapter(adapter: LanguageAdapter): void {
  registry.set(adapter.id, adapter);
  // Register file extensions
  for (const ext of adapter.fileExtensions) {
    extensionMap.set(ext.toLowerCase(), adapter);
  }
}

export function getLanguageAdapter(id?: string): LanguageAdapter {
  if (id && registry.has(id)) {
    return registry.get(id)!;
  }
  if (registry.has("cpp")) {
    return registry.get("cpp")!;
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
export function getAdapterForFile(filePath: string): LanguageAdapter | null {
  const ext = filePath.split(".").pop()?.toLowerCase();
  if (!ext) {
    return null;
  }
  return extensionMap.get(ext) || null;
}

/**
 * Get all registered language adapters.
 */
export function getAllAdapters(): LanguageAdapter[] {
  return Array.from(registry.values());
}

/**
 * Get all file extensions that have registered adapters.
 */
export function getSupportedExtensions(): string[] {
  return Array.from(extensionMap.keys());
}

