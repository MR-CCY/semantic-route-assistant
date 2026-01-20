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

function normalizeTags(tags: unknown): string[] {
  const unique = new Set<string>();
  const pushTag = (tag: string) => {
    const normalized = tag.trim().toLowerCase();
    if (normalized) {
      unique.add(normalized);
    }
  };

  if (Array.isArray(tags)) {
    for (const tag of tags) {
      if (typeof tag === "string") {
        pushTag(tag);
      }
    }
    return Array.from(unique);
  }

  if (typeof tags === "string") {
    const raw = tags.trim();
    if (!raw) {
      return [];
    }
    const containsCjk = /[\u4e00-\u9fff]/.test(raw);
    const hasSeparator = /[,\n\r，;；|、]/.test(raw);
    if (hasSeparator) {
      const parts = raw.split(/[,\n\r，;；|、]+/);
      for (const part of parts) {
        const tokens = part.split(/\s+/).filter(Boolean);
        if (tokens.length === 0) {
          continue;
        }
        for (const token of tokens) {
          pushTag(token);
        }
      }
    } else {
      if (containsCjk && raw.includes("_")) {
        const parts = raw.split(/_+/).map((part) => part.trim()).filter(Boolean);
        if (parts.length > 0) {
          for (const part of parts) {
            pushTag(part);
          }
        } else {
          pushTag(raw);
        }
      } else {
        const tokens = raw.split(/\s+/).filter(Boolean);
        if (tokens.length > 1) {
          for (const token of tokens) {
            pushTag(token);
          }
        } else {
          pushTag(raw);
        }
      }
    }
  }

  return Array.from(unique);
}

const DEFAULT_SYSTEM_PROMPT =
  "你是一个代码审查助手，支持多种语言。" +
  "根据给定的函数签名和实现，生成 brief 与 tags。" +
  "brief 为一句话功能描述（不超过 50 个字），准确、不幻想；tags 数量不限制，尽量覆盖算法/意图/技巧/副作用/特性/能力，" +
  "标签可中英混合（中文或 snake_case 英文均可）。标签尽量使用名词或名词短语，动作用名词化表达。" +
  "只基于签名/实现中的明确证据生成标签，避免抽象推断或臆测；无明确证据则不输出。" +
  "避免只描述语言机制/控制流/通用实现细节（如异步/返回/异常捕获/解析等），优先领域或功能语义。" +
  "只保留高信息量语义标签，避免文件路径/模块名/类名/函数名拆词，低质量通用词会在后处理过滤。" ;

const DEFAULT_USER_PROMPT = [
  "返回 JSON：{brief, tags}",
  "只返回 JSON，不要额外文本。",
  "moduleName: {{moduleName}}",
  "signature: {{signature}}",
  "implementation:",
  "```",
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
  const temperatureEnv = Number(process.env.SRCA_LLM_TEMPERATURE ?? "0");
  const temperature = Number.isFinite(temperatureEnv)
    ? Math.min(1, Math.max(0, temperatureEnv))
    : 0;

  if (!provider) {
    return { brief: `自动生成描述: ${input.signature}`, tags: [] };
  }

  if (!apiKey) {
    return { brief: `自动生成描述: ${input.signature}`, tags: [] };
  }

  const hasImpl = Boolean(input.implementation && input.implementation.trim());
  const implNote = hasImpl ? input.implementation! : "未提供实现，仅根据签名尽量推测。";

  const userPrompt = renderUserPrompt(input, implNote);
  const payload: OpenAICompatPayload = {
    model,
    temperature,
    max_tokens: 96,
    messages: [
      {
        role: "system",
        content: systemPrompt
      },
      {
        role: "user",
        content: userPrompt
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

    console.log(
      `[generateBriefForSymbol] LLM prompt file=${input.filePath ?? "unknown"} signature=${input.signature}`
    );
    console.log(`[generateBriefForSymbol] LLM prompt system=${systemPrompt}`);
    console.log(`[generateBriefForSymbol] LLM prompt user=${userPrompt}`);
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
