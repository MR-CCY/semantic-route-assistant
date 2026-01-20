import { registerLanguageAdapter, getLanguageAdapter, getAdapterForFile, getAllAdapters, getSupportedExtensions } from "./adapterRegistry";
import { cppAdapter } from "./cppAdapter";
import { javaAdapter } from "./javaAdapter";
import { jsAdapter } from "./jsAdapter";
import { pythonAdapter } from "./pythonAdapter";
import { goAdapter } from "./goAdapter";
import { bashAdapter } from "./bashAdapter";
import { rustAdapter } from "./rustAdapter";
import { csharpAdapter } from "./csharpAdapter";
import { phpAdapter } from "./phpAdapter";
import { rubyAdapter } from "./rubyAdapter";

// Register all language adapters
registerLanguageAdapter(cppAdapter);
registerLanguageAdapter(javaAdapter);
registerLanguageAdapter(jsAdapter);
registerLanguageAdapter(pythonAdapter);
registerLanguageAdapter(goAdapter);
registerLanguageAdapter(bashAdapter);
registerLanguageAdapter(rustAdapter);
registerLanguageAdapter(csharpAdapter);
registerLanguageAdapter(phpAdapter);
registerLanguageAdapter(rubyAdapter);

export { getLanguageAdapter, getAdapterForFile, getAllAdapters, getSupportedExtensions, registerLanguageAdapter };
export type { LanguageAdapter, BaseTagsInput } from "./adapterRegistry";

