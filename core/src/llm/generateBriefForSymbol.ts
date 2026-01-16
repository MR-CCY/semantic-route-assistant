import { callOpenAICompatible, OpenAICompatPayload, resolveBaseUrl } from "./openaiCompat";

export interface BriefInput {
  moduleName: string;
  signature: string;
  implementation?: string;
  filePath?: string;
}

export type BriefResult = {
  brief: string;
  tags: string[];
};

function extractJson(text: string): string | null {
  const start = text.indexOf("{");
  const end = text.lastIndexOf("}");
  if (start === -1 || end === -1 || end <= start) {
    return null;
  }
  return text.slice(start, end + 1);
}

function normalizeTags(tags: string[]): string[] {
  const unique = new Set<string>();
  for (const tag of tags) {
    const normalized = tag.trim().toLowerCase();
    if (!normalized) {
      continue;
    }
    unique.add(normalized);
    if (unique.size >= 5) {
      break;
    }
  }
  return Array.from(unique);
}

const DEFAULT_SYSTEM_PROMPT =
  "你是一个 C++ 项目的代码审查助手。根据给定的函数签名和实现，返回 JSON：{brief, tags}。" +
  "brief 为一句话功能描述（不超过 50 个字），准确、不幻想；tags 为 1-5 个短标签，" +
  "全小写字母/数字/下划线。tags 必须是“高信息量语义标签”，避免文件路径/模块名/类名/函数名拆词，" +
  "避免 src/server/core/add 等低信息词。优先关注副作用、并发语义、错误/重试、资源管理、" +
  "缓存、协议/业务域、模式/生命周期等。只返回 JSON，不要额外文本。";

const DEFAULT_USER_PROMPT = [
  "moduleName: {{moduleName}}",
  "signature: {{signature}}",
  "implementation:",
  "```cpp",
  "{{implementation}}",
  "```"
].join("\n");

function renderUserPrompt(input: BriefInput, implNote: string): string {
  const template = process.env.SRCA_LLM_USER_PROMPT || "";
  const raw = template.trim() ? template : DEFAULT_USER_PROMPT;
  return raw
    .split("{{moduleName}}")
    .join(input.moduleName)
    .split("{{signature}}")
    .join(input.signature)
    .split("{{implementation}}")
    .join(implNote);
}

export async function generateBriefAndTagsForSymbol(input: BriefInput): Promise<BriefResult> {
  const provider = process.env.SRCA_LLM_PROVIDER;
  const apiKey = process.env.SRCA_LLM_API_KEY;
  const model = process.env.SRCA_LLM_MODEL || "gpt-4o-mini";
  const baseUrl = process.env.SRCA_LLM_BASE_URL || "";
  const systemPrompt = process.env.SRCA_LLM_SYSTEM_PROMPT?.trim() || DEFAULT_SYSTEM_PROMPT;

  if (!provider) {
    return { brief: `自动生成描述: ${input.signature}`, tags: [] };
  }

  if (!apiKey) {
    return { brief: `自动生成描述: ${input.signature}`, tags: [] };
  }

  const hasImpl = Boolean(input.implementation && input.implementation.trim());
  const implNote = hasImpl ? input.implementation! : "未提供实现，仅根据签名尽量推测。";

  const payload: OpenAICompatPayload = {
    model,
    temperature: 0.2,
    max_tokens: 96,
    messages: [
      {
        role: "system",
        content: systemPrompt
      },
      {
        role: "user",
        content: renderUserPrompt(input, implNote)
      }
    ]
  };

  try {
    const resolvedBaseUrl = resolveBaseUrl(provider, baseUrl);
    if (!resolvedBaseUrl) {
      console.warn(
        `[generateBriefForSymbol] 未配置 SRCA_LLM_BASE_URL，无法调用 ${provider}。`
      );
      return { brief: `自动生成描述: ${input.signature}`, tags: [] };
    }

    const text = await callOpenAICompatible({
      apiKey,
      baseUrl: resolvedBaseUrl,
      payload
    });
    if (text) {
      const jsonText = extractJson(text);
      if (jsonText) {
        try {
          const parsed = JSON.parse(jsonText) as { brief?: string; tags?: string[] };
          if (parsed?.brief) {
            return {
              brief: parsed.brief.trim(),
              tags: normalizeTags(parsed.tags || [])
            };
          }
        } catch {
          // fall through to plain text
        }
      }
      return { brief: text, tags: [] };
    }
  } catch (error) {
    console.warn(
      `[generateBriefForSymbol] 调用失败: ${provider} ${input.moduleName} ${input.signature}`,
      error
    );
  }

  return { brief: `自动生成描述: ${input.signature}`, tags: [] };
}

export async function generateBriefForSymbol(input: BriefInput): Promise<string> {
  const result = await generateBriefAndTagsForSymbol(input);
  return result.brief;
}
