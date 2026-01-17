import { scanSourceFiles } from "../scanFiles";
import { extractSymbolsFromCode } from "../symbolExtractor";
import {
  extractImplementationFromCode,
  extractImplementationForSymbol
} from "../extract/implementationExtractor";
import { inferPathModuleHint } from "../moduleGrouper";
import { inferCppBaseTags } from "./cppTags";
import type { LanguageAdapter } from "./adapterRegistry";

export const cppAdapter: LanguageAdapter = {
  id: "cpp",
  displayName: "C/C++",
  fileExtensions: ["c", "cpp", "cc", "cxx", "h", "hpp", "hxx", "hh"],
  scanSourceFiles,
  extractSymbolsFromCode,
  extractImplementationFromCode,
  extractImplementationForSymbol,
  inferPathModuleHint,
  inferBaseTags: inferCppBaseTags
};
