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
  // C++ 使用 extractSymbolsFromCodeAsync，这里提供占位符以满足接口
  extractSymbolsFromCode: () => {
    throw new Error("C++ uses extractSymbolsFromCodeAsync, not extractSymbolsFromCode");
  },
  extractImplementationFromCode,
  extractImplementationForSymbol,
  inferPathModuleHint,
  inferBaseTags: inferCppBaseTags
};
