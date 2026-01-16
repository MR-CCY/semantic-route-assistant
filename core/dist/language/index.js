"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.registerLanguageAdapter = exports.getLanguageAdapter = void 0;
const adapterRegistry_1 = require("./adapterRegistry");
Object.defineProperty(exports, "registerLanguageAdapter", { enumerable: true, get: function () { return adapterRegistry_1.registerLanguageAdapter; } });
Object.defineProperty(exports, "getLanguageAdapter", { enumerable: true, get: function () { return adapterRegistry_1.getLanguageAdapter; } });
const cppAdapter_1 = require("./cppAdapter");
(0, adapterRegistry_1.registerLanguageAdapter)(cppAdapter_1.cppAdapter);
