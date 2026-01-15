"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.mapModuleName = mapModuleName;
const path_1 = __importDefault(require("path"));
function mapModuleName(relativePath) {
    const base = path_1.default.basename(relativePath);
    const ext = path_1.default.extname(base);
    const name = ext ? base.slice(0, -ext.length) : base;
    return name || "core";
}
