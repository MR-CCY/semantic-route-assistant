"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.cppAdapter = void 0;
const scanFiles_1 = require("../scanFiles");
const implementationExtractor_1 = require("../extract/implementationExtractor");
const moduleGrouper_1 = require("../moduleGrouper");
const cppTags_1 = require("./cppTags");
exports.cppAdapter = {
    id: "cpp",
    displayName: "C/C++",
    fileExtensions: ["c", "cpp", "cc", "cxx", "h", "hpp", "hxx", "hh"],
    scanSourceFiles: scanFiles_1.scanSourceFiles,
    // C++ 使用 extractSymbolsFromCodeAsync，这里提供占位符以满足接口
    extractSymbolsFromCode: () => {
        throw new Error("C++ uses extractSymbolsFromCodeAsync, not extractSymbolsFromCode");
    },
    extractImplementationFromCode: implementationExtractor_1.extractImplementationFromCode,
    extractImplementationForSymbol: implementationExtractor_1.extractImplementationForSymbol,
    inferPathModuleHint: moduleGrouper_1.inferPathModuleHint,
    inferBaseTags: cppTags_1.inferCppBaseTags
};
