import { registerLanguageAdapter, getLanguageAdapter, getAdapterForFile, getAllAdapters, getSupportedExtensions } from "./adapterRegistry";
import { cppAdapter } from "./cppAdapter";
import { javaAdapter } from "./javaAdapter";
import { jsAdapter } from "./jsAdapter";
import { pythonAdapter } from "./pythonAdapter";
import { goAdapter } from "./goAdapter";

// Register all language adapters
registerLanguageAdapter(cppAdapter);
registerLanguageAdapter(javaAdapter);
registerLanguageAdapter(jsAdapter);
registerLanguageAdapter(pythonAdapter);
registerLanguageAdapter(goAdapter);

export { getLanguageAdapter, getAdapterForFile, getAllAdapters, getSupportedExtensions, registerLanguageAdapter };
export type { LanguageAdapter, BaseTagsInput } from "./adapterRegistry";
