"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.cppAdapter = void 0;
const scanFiles_1 = require("../scanFiles");
const symbolExtractor_1 = require("../symbolExtractor");
const implementationExtractor_1 = require("../extract/implementationExtractor");
const moduleGrouper_1 = require("../moduleGrouper");
exports.cppAdapter = {
    id: "cpp",
    displayName: "C/C++",
    scanSourceFiles: scanFiles_1.scanSourceFiles,
    extractSymbolsFromCode: symbolExtractor_1.extractSymbolsFromCode,
    extractImplementationFromCode: implementationExtractor_1.extractImplementationFromCode,
    extractImplementationForSymbol: implementationExtractor_1.extractImplementationForSymbol,
    inferPathModuleHint: moduleGrouper_1.inferPathModuleHint
};
