import { scanSourceFiles } from "../scanFiles";
import { extractSymbolsFromCode } from "../symbolExtractor";
import {
  extractImplementationFromCode,
  extractImplementationForSymbol
} from "../extract/implementationExtractor";
import { inferPathModuleHint } from "../moduleGrouper";
import type { LanguageAdapter } from "./adapterRegistry";

export const cppAdapter: LanguageAdapter = {
  id: "cpp",
  displayName: "C/C++",
  scanSourceFiles,
  extractSymbolsFromCode,
  extractImplementationFromCode,
  extractImplementationForSymbol,
  inferPathModuleHint
};
