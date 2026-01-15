/**
 * Summarize a single C++ source file into a Markdown Skill Block.
 * Current implementation is a stub placeholder; will be replaced by real LLM calls.
 */
export async function summarizeFile(code: string, filePath: string): Promise<string> {
  // TODO: Replace with actual LLM summarization using code and filePath context
  const role = "TODO: 模块职责";
  const exportsSection = "TODO: 对外接口";
  const usage = "TODO: 使用方式";
  const sideEffects = "TODO: 副作用";
  const threadSafety = "TODO: 线程安全";
  const fileMapping = "TODO: 文件结构";

  return [
    `# Skill Block`,
    ``,
    `Module: ${filePath}`,
    `Path: ${filePath}`,
    ``,
    `## Role`,
    role,
    ``,
    `## Exports`,
    exportsSection,
    ``,
    `## Usage`,
    usage,
    ``,
    `## Side Effects`,
    sideEffects,
    ``,
    `## Thread Safety`,
    threadSafety,
    ``,
    `## File Mapping`,
    fileMapping,
    ``
  ].join("\n");
}

export async function generateBriefForSymbol(input: {
  moduleName: string;
  signature: string;
  filePath: string;
}): Promise<string> {
  const { moduleName, signature } = input;
  return `TODO: ${moduleName} ${signature} brief`;
}
