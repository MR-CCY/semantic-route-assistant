import type { ExtractedSymbol } from "../symbolExtractor";
import type {
  ImplementationInput,
  ImplementationResult
} from "../extract/implementationExtractor";

export type LanguageAdapter = {
  id: string;
  displayName: string;
  scanSourceFiles: (projectRoot: string) => Promise<string[]>;
  extractSymbolsFromCode: (code: string, filePath: string) => ExtractedSymbol[];
  extractImplementationFromCode: (code: string, signature: string) => string | null;
  extractImplementationForSymbol: (
    input: ImplementationInput
  ) => Promise<ImplementationResult>;
  inferPathModuleHint: (filePath: string) => string;
};

const registry = new Map<string, LanguageAdapter>();

export function registerLanguageAdapter(adapter: LanguageAdapter): void {
  registry.set(adapter.id, adapter);
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
