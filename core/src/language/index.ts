import { registerLanguageAdapter, getLanguageAdapter } from "./adapterRegistry";
import { cppAdapter } from "./cppAdapter";

registerLanguageAdapter(cppAdapter);

export { getLanguageAdapter, registerLanguageAdapter };
export type { LanguageAdapter } from "./adapterRegistry";
